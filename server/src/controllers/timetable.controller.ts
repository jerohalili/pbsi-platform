import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import {
  assertCanManageCourse,
  assertCanManageTimetableEntry,
  getOwnTeacherId,
  httpError,
  optionalInt,
  optionalUuid,
  parseUuid,
  rethrowDbError,
} from '../utils/access.js';
import { recordAudit } from '../utils/audit.js';
import type { AuthUser } from '../types/index.js';
import type { TimetableInput, TimetableUpdateInput } from '../utils/validation.js';

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SLOT_TAKEN = 'That period is already taken for this teacher, room or course.';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

interface Slot {
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string;
}

/**
 * Refuses an entry that would double-book the teacher, the room or the course. Two entries
 * clash when they are on the same day and share a period number or their times overlap
 * (back-to-back classes are fine). `excludeId` is the entry being edited, so it does not clash
 * with itself.
 */
async function assertNoClash(
  slot: Slot,
  who: { teacherId: string; courseId: string },
  excludeId = '',
): Promise<void> {
  const [clash] = await sql`
    SELECT t.period_number, t.room, t.teacher_id, t.course_id,
           to_char(t.start_time, 'HH24:MI') AS start_time, to_char(t.end_time, 'HH24:MI') AS end_time,
           c.code AS course_code, p.first_name, p.last_name
    FROM timetable t
    JOIN courses c ON c.id = t.course_id
    JOIN teachers te ON te.id = t.teacher_id
    JOIN profiles p ON p.user_id = te.user_id
    WHERE t.day_of_week = ${slot.day_of_week}
      AND (${excludeId}::text = '' OR t.id <> NULLIF(${excludeId}::text, '')::uuid)
      AND (t.period_number = ${slot.period_number}
           OR (t.start_time < ${slot.end_time}::time AND t.end_time > ${slot.start_time}::time))
      AND (t.teacher_id = ${who.teacherId}
           OR t.course_id = ${who.courseId}
           OR lower(btrim(t.room)) = lower(${slot.room}))
    ORDER BY (t.teacher_id = ${who.teacherId}) DESC, (t.course_id = ${who.courseId}) DESC
    LIMIT 1
  `;
  if (!clash) return;

  const when = `on ${DAY_NAMES[slot.day_of_week]} (period ${clash.period_number}, ${clash.start_time}-${clash.end_time})`;
  if (clash.teacher_id === who.teacherId) {
    throw httpError(
      409,
      `${clash.first_name} ${clash.last_name} already teaches ${clash.course_code} ${when}.`,
    );
  }
  if (clash.course_id === who.courseId) {
    throw httpError(409, `${clash.course_code} is already scheduled ${when}.`);
  }
  throw httpError(409, `Room ${clash.room} is already used by ${clash.course_code} ${when}.`);
}

export async function listTimetable(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { day_of_week, teacher_id, course_id, mine } = req.query as {
    day_of_week?: string;
    teacher_id?: string;
    course_id?: string;
    mine?: string;
  };

  const dayParam = optionalInt(day_of_week, 'day of week');
  let teacherParam = optionalUuid(teacher_id, 'teacher id');
  const courseParam = optionalUuid(course_id, 'course id');

  // ?mine=true narrows a teacher's view to the classes they teach.
  if (mine === 'true' && user.role === 'teacher') {
    const ownTeacherId = await getOwnTeacherId(user.id);
    if (!ownTeacherId) {
      res.json({ timetable: [] });
      return;
    }
    teacherParam = ownTeacherId;
  }

  const entries = await sql`
    SELECT t.id, t.day_of_week, t.period_number,
           to_char(t.start_time, 'HH24:MI') AS start_time, to_char(t.end_time, 'HH24:MI') AS end_time,
           t.room, t.course_id, t.teacher_id,
           c.code as course_code, c.name as course_name,
           p.first_name as teacher_first_name, p.last_name as teacher_last_name,
           (${user.role}::text = 'admin' OR te.user_id = ${user.id}) AS can_manage
    FROM timetable t
    JOIN courses c ON c.id = t.course_id
    JOIN teachers te ON te.id = t.teacher_id
    JOIN users u ON u.id = te.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE (${dayParam}::text = '' OR t.day_of_week = NULLIF(${dayParam}::text, '')::int)
      AND (${teacherParam}::text = '' OR t.teacher_id = NULLIF(${teacherParam}::text, '')::uuid)
      AND (${courseParam}::text = '' OR t.course_id = NULLIF(${courseParam}::text, '')::uuid)
      AND (${user.role !== 'student'}::boolean OR t.course_id IN (
            SELECT e.course_id
            FROM enrollments e
            JOIN students st ON st.id = e.student_id
            WHERE st.user_id = ${user.id}
          ))
    ORDER BY t.day_of_week ASC, t.period_number ASC, t.start_time ASC
  `;
  res.json({ timetable: entries });
}

export async function createTimetableEntry(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const input = req.body as TimetableInput;
  const room = input.room.trim();

  // Admins may schedule any course; a teacher only their own (404 unknown course, 403 not theirs).
  await assertCanManageCourse(user, input.course_id);
  const [course] = await sql`SELECT teacher_id FROM courses WHERE id = ${input.course_id}`;
  const courseTeacherId = course?.teacher_id as string;

  const teacherId = input.teacher_id ?? courseTeacherId;
  if (teacherId !== courseTeacherId) {
    if (user.role !== 'admin') {
      throw httpError(403, 'Only an admin can schedule a course with a different teacher');
    }
    const [teacher] = await sql`SELECT id FROM teachers WHERE id = ${teacherId}`;
    if (!teacher) throw httpError(404, 'Teacher not found');
  }

  const slot = { ...input, room };
  await assertNoClash(slot, { teacherId, courseId: input.course_id });

  try {
    const [entry] = await sql`
      INSERT INTO timetable (day_of_week, period_number, start_time, end_time, course_id, teacher_id, room)
      VALUES (${slot.day_of_week}, ${slot.period_number}, ${slot.start_time}, ${slot.end_time},
              ${input.course_id}, ${teacherId}, ${room})
      RETURNING id, day_of_week, period_number,
                to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time,
                course_id, teacher_id, room
    `;
    await recordAudit(req, 'timetable.create', 'timetable', entry!.id as string, null, {
      course_id: input.course_id,
      day_of_week: slot.day_of_week,
      period_number: slot.period_number,
    });
    res.status(201).json({ entry });
  } catch (err) {
    rethrowDbError(err, { unique: SLOT_TAKEN });
  }
}

export async function updateTimetableEntry(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'timetable entry id');
  const input = req.body as TimetableUpdateInput;
  const room = input.room.trim();

  await assertCanManageTimetableEntry(user, id);
  const [current] = await sql`
    SELECT teacher_id, course_id, day_of_week, period_number, room FROM timetable WHERE id = ${id}
  `;
  if (!current) throw httpError(404, 'Timetable entry not found');

  const slot = { ...input, room };
  await assertNoClash(
    slot,
    { teacherId: current.teacher_id as string, courseId: current.course_id as string },
    id,
  );

  try {
    const [entry] = await sql`
      UPDATE timetable
      SET day_of_week = ${slot.day_of_week}, period_number = ${slot.period_number},
          start_time = ${slot.start_time}, end_time = ${slot.end_time}, room = ${room}
      WHERE id = ${id}
      RETURNING id, day_of_week, period_number,
                to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time,
                course_id, teacher_id, room
    `;
    if (!entry) throw httpError(404, 'Timetable entry not found');
    await recordAudit(
      req,
      'timetable.update',
      'timetable',
      id,
      {
        day_of_week: current.day_of_week,
        period_number: current.period_number,
        room: current.room,
      },
      { day_of_week: slot.day_of_week, period_number: slot.period_number, room },
    );
    res.json({ entry });
  } catch (err) {
    rethrowDbError(err, { unique: SLOT_TAKEN });
  }
}

export async function deleteTimetableEntry(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'timetable entry id');
  await assertCanManageTimetableEntry(user, id);

  const [entry] = await sql`
    DELETE FROM timetable WHERE id = ${id}
    RETURNING id, course_id, day_of_week, period_number
  `;
  if (!entry) throw httpError(404, 'Timetable entry not found');
  await recordAudit(req, 'timetable.delete', 'timetable', id, {
    course_id: entry.course_id,
    day_of_week: entry.day_of_week,
    period_number: entry.period_number,
  }, null);
  res.json({ message: 'Timetable entry deleted' });
}
