import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../config/db.js';
import type { AppError } from '../middleware/errorHandler.js';
import { hashPassword } from '../utils/password.js';
import { deleteFromCloudinary, deleteManyFromCloudinary } from '../utils/upload.js';
import { recordAudit } from '../utils/audit.js';
import { avatarPublicId } from './avatar.controller.js';
import {
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema,
} from '../utils/validation.js';
import type { AuthUser, UserRole } from '../types/index.js';

const ROLES: UserRole[] = ['admin', 'teacher', 'student'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpError(statusCode: number, message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  return err;
}

function requireActor(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

function parseId(raw: string | undefined): string {
  const result = z.string().uuid().safeParse(raw);
  if (!result.success) throw httpError(400, 'Invalid user id');
  return result.data;
}

/** Admins manage every account; teachers manage student accounts only. */
function assertCanManageRole(actor: AuthUser, targetRole: UserRole): void {
  if (actor.role === 'admin') return;
  if (actor.role === 'teacher' && targetRole === 'student') return;
  throw httpError(403, 'Forbidden: you are not allowed to manage this account');
}

interface TargetUser {
  id: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_by: string | null;
}

async function findTarget(id: string): Promise<TargetUser> {
  const [target] = await sql`
    SELECT id, email, role::text AS role, is_active, created_by FROM users WHERE id = ${id}
  `;
  if (!target) throw httpError(404, 'User not found');
  return target as TargetUser;
}

async function assertAnotherActiveAdminExists(excludeId: string): Promise<void> {
  const [row] = await sql`
    SELECT COUNT(*)::int AS n
    FROM users
    WHERE role::text = 'admin' AND is_active = TRUE AND id <> ${excludeId}
  `;
  if (!row || row.n < 1) {
    throw httpError(409, 'There must always be at least one active administrator');
  }
}

/** Translates common database constraint errors into friendly 409 responses. */
function rethrowDbError(err: unknown, foreignKeyMessage?: string): never {
  const code = (err as { code?: string } | null)?.code;
  if (code === '23505') {
    throw httpError(409, 'That email or ID number is already in use');
  }
  if (code === '23503' && foreignKeyMessage) {
    throw httpError(409, foreignKeyMessage);
  }
  throw err;
}

/** Audit entry for an account change (the shared helper, with the entity type fixed to 'user'). */
function writeAudit(
  req: Request,
  action: string,
  entityId: string,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown> | null,
): Promise<void> {
  return recordAudit(req, action, 'user', entityId, oldValues, newValues);
}

async function nextStudentNumber(year: number): Promise<string> {
  const pattern = `^PBSI-${year}-(\\d+)$`;
  const [row] = await sql`
    SELECT COALESCE(MAX(SUBSTRING(student_id FROM ${pattern}::text)::int), 0) + 1 AS next
    FROM students
  `;
  return `PBSI-${year}-${String(row?.next ?? 1).padStart(4, '0')}`;
}

async function nextEmployeeNumber(year: number): Promise<string> {
  const pattern = `^EMP-${year}-(\\d+)$`;
  const [row] = await sql`
    SELECT COALESCE(MAX(SUBSTRING(employee_id FROM ${pattern}::text)::int), 0) + 1 AS next
    FROM teachers
  `;
  return `EMP-${year}-${String(row?.next ?? 1).padStart(4, '0')}`;
}

async function fetchUserDetail(id: string) {
  const [user] = await sql`
    SELECT u.id, u.email, u.role::text AS role, u.is_active, u.created_at,
           p.first_name, p.last_name, p.phone, p.date_of_birth,
           p.gender, p.address, p.avatar_url,
           s.student_id, t.employee_id
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN students s ON s.user_id = u.id
    LEFT JOIN teachers t ON t.user_id = u.id
    WHERE u.id = ${id}
  `;
  return user;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function listUsers(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const query = req.query as { role?: string; status?: string; search?: string };

  // Teachers can only ever see student accounts.
  const requestedRole = ROLES.includes(query.role as UserRole) ? (query.role as string) : '';
  const roleParam = actor.role === 'teacher' ? 'student' : requestedRole;
  const statusParam = query.status === 'active' || query.status === 'inactive' ? query.status : '';
  const searchParam = (query.search ?? '').trim();
  const like = `%${searchParam}%`;

  const users = await sql`
    SELECT u.id, u.email, u.role::text AS role, u.is_active, u.created_at,
           p.first_name, p.last_name, p.avatar_url, p.phone,
           s.student_id, t.employee_id
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN students s ON s.user_id = u.id
    LEFT JOIN teachers t ON t.user_id = u.id
    WHERE (${roleParam}::text = '' OR u.role::text = ${roleParam}::text)
      AND (${statusParam}::text = ''
           OR (${statusParam}::text = 'active' AND u.is_active = TRUE)
           OR (${statusParam}::text = 'inactive' AND u.is_active = FALSE))
      AND (${searchParam}::text = ''
           OR p.first_name ILIKE ${like}
           OR p.last_name ILIKE ${like}
           OR u.email ILIKE ${like}
           OR s.student_id ILIKE ${like}
           OR t.employee_id ILIKE ${like})
    ORDER BY u.created_at DESC
    LIMIT 500
  `;
  res.json({ users });
}

export async function getUser(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const id = parseId(req.params.id);

  const user = await fetchUserDetail(id);
  if (!user) throw httpError(404, 'User not found');

  const allowed =
    actor.role === 'admin' ||
    actor.id === id ||
    (actor.role === 'teacher' && user.role === 'student');
  if (!allowed) throw httpError(403, 'Forbidden: insufficient permissions');

  res.json({ user });
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const input = createUserSchema.parse(req.body);
  assertCanManageRole(actor, input.role);

  const [existing] = await sql`
    SELECT id FROM users WHERE lower(email) = lower(${input.email}) LIMIT 1
  `;
  if (existing) throw httpError(409, 'Email already registered');

  const id = randomUUID();
  const passwordHash = await hashPassword(input.password);
  const year = new Date().getFullYear();
  const phone = input.phone || null;
  const dateOfBirth = input.date_of_birth || null;
  const address = input.address || null;

  const statements = [
    sql`
      INSERT INTO users (id, email, password_hash, role, created_by)
      VALUES (${id}, ${input.email}, ${passwordHash}, ${input.role}, ${actor.id})
    `,
    sql`
      INSERT INTO profiles (user_id, first_name, last_name, phone, date_of_birth, address)
      VALUES (${id}, ${input.first_name}, ${input.last_name}, ${phone}, ${dateOfBirth}, ${address})
    `,
  ];

  if (input.role === 'student') {
    const studentNumber = input.student_id || (await nextStudentNumber(year));
    statements.push(sql`
      INSERT INTO students (user_id, student_id) VALUES (${id}, ${studentNumber})
    `);
  } else if (input.role === 'teacher') {
    const employeeNumber = input.employee_id || (await nextEmployeeNumber(year));
    statements.push(sql`
      INSERT INTO teachers (user_id, employee_id) VALUES (${id}, ${employeeNumber})
    `);
  }

  try {
    // One transaction: either the whole account exists, or none of it does.
    await sql.transaction(statements);
  } catch (err) {
    rethrowDbError(err);
  }

  await writeAudit(req, 'user.create', id, null, {
    email: input.email,
    role: input.role,
    first_name: input.first_name,
    last_name: input.last_name,
  });

  res.status(201).json({ user: await fetchUserDetail(id) });
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const id = parseId(req.params.id);
  const input = updateUserSchema.parse(req.body);

  const target = await findTarget(id);
  assertCanManageRole(actor, target.role);

  if (input.email && input.email.toLowerCase() !== target.email.toLowerCase()) {
    const [taken] = await sql`
      SELECT id FROM users WHERE lower(email) = lower(${input.email}) AND id <> ${id} LIMIT 1
    `;
    if (taken) throw httpError(409, 'Email already registered');
  }

  const before = await fetchUserDetail(id);

  // Optional text fields: undefined = leave unchanged, '' = clear.
  const phoneProvided = input.phone !== undefined;
  const dobProvided = input.date_of_birth !== undefined;
  const addressProvided = input.address !== undefined;

  const statements = [
    sql`
      UPDATE users SET email = COALESCE(${input.email ?? null}, email) WHERE id = ${id}
    `,
    sql`
      UPDATE profiles
      SET first_name = COALESCE(${input.first_name ?? null}, first_name),
          last_name = COALESCE(${input.last_name ?? null}, last_name),
          phone = CASE WHEN ${phoneProvided}::boolean THEN ${input.phone || null} ELSE phone END,
          date_of_birth = CASE WHEN ${dobProvided}::boolean THEN ${input.date_of_birth || null} ELSE date_of_birth END,
          address = CASE WHEN ${addressProvided}::boolean THEN ${input.address || null} ELSE address END
      WHERE user_id = ${id}
    `,
  ];

  if (target.role === 'student' && input.student_id) {
    statements.push(sql`UPDATE students SET student_id = ${input.student_id} WHERE user_id = ${id}`);
  }
  if (target.role === 'teacher' && input.employee_id) {
    statements.push(sql`UPDATE teachers SET employee_id = ${input.employee_id} WHERE user_id = ${id}`);
  }

  try {
    await sql.transaction(statements);
  } catch (err) {
    rethrowDbError(err);
  }

  const after = await fetchUserDetail(id);
  await writeAudit(
    req,
    'user.update',
    id,
    before ? { email: before.email, first_name: before.first_name, last_name: before.last_name } : null,
    after ? { email: after.email, first_name: after.first_name, last_name: after.last_name } : null,
  );

  res.json({ user: after });
}

async function setActive(req: Request, res: Response, active: boolean): Promise<void> {
  const actor = requireActor(req);
  const id = parseId(req.params.id);

  const target = await findTarget(id);
  assertCanManageRole(actor, target.role);

  if (!active) {
    if (actor.id === id) throw httpError(403, 'You cannot deactivate your own account');
    if (target.role === 'admin') await assertAnotherActiveAdminExists(id);
  }

  // Deactivating also ends the person's current sessions, immediately.
  const [user] = await sql`
    UPDATE users
    SET is_active = ${active},
        tokens_valid_after = CASE WHEN ${active}::boolean THEN tokens_valid_after ELSE now() END
    WHERE id = ${id}
    RETURNING id, email, is_active
  `;

  await writeAudit(
    req,
    active ? 'user.reactivate' : 'user.deactivate',
    id,
    { is_active: target.is_active },
    { is_active: active },
  );

  res.json({ user });
}

export async function deactivateUser(req: Request, res: Response): Promise<void> {
  await setActive(req, res, false);
}

export async function reactivateUser(req: Request, res: Response): Promise<void> {
  await setActive(req, res, true);
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const id = parseId(req.params.id);
  const { password } = resetPasswordSchema.parse(req.body);

  const target = await findTarget(id);
  assertCanManageRole(actor, target.role);

  const passwordHash = await hashPassword(password);
  // A reset also signs the person out everywhere (anyone holding the old password loses access).
  await sql`UPDATE users SET password_hash = ${passwordHash}, tokens_valid_after = now() WHERE id = ${id}`;

  await writeAudit(req, 'user.reset_password', id, null, null);

  res.json({ message: 'Password updated' });
}

// ---------------------------------------------------------------------------
// Permanent deletion
// ---------------------------------------------------------------------------

interface RecordCount {
  key: string;
  label: string;
  count: number;
}

/** An account's own history. An admin may delete it together with the account. */
const OWN_RECORD_LABELS: Record<string, string> = {
  grades: 'grades',
  attendance: 'attendance records',
  submissions: 'assignment submissions',
  quiz_attempts: 'quiz attempts',
  discussion_posts: 'discussion posts',
};

/** Records other people's data depends on. Nobody can delete the account while these exist. */
const PROTECTED_RECORD_LABELS: Record<string, string> = {
  audit_entries: 'audit log entries',
  marked_attendance: 'attendance they recorded',
  graded_submissions: 'submissions they graded',
  courses: 'courses',
  shared_threads: 'discussion threads other people replied to',
};

function toRecordCounts(row: Record<string, unknown>, labels: Record<string, string>): RecordCount[] {
  return Object.entries(labels)
    .map(([key, label]) => ({ key, label, count: Number(row[key] ?? 0) }))
    .filter((record) => record.count > 0);
}

function describeRecords(records: RecordCount[]): string {
  return records.map((record) => `${record.count} ${record.label}`).join(', ');
}

async function buildDeletePlan(id: string): Promise<{ own: RecordCount[]; blocked: RecordCount[] }> {
  const [row] = await sql`
    SELECT
      (SELECT COUNT(*) FROM grades WHERE student_id IN (SELECT id FROM students WHERE user_id = ${id}))::int AS grades,
      (SELECT COUNT(*) FROM attendance WHERE student_id IN (SELECT id FROM students WHERE user_id = ${id}))::int AS attendance,
      (SELECT COUNT(*) FROM submissions WHERE student_id IN (SELECT id FROM students WHERE user_id = ${id}))::int AS submissions,
      (SELECT COUNT(*) FROM quiz_attempts WHERE student_id IN (SELECT id FROM students WHERE user_id = ${id}))::int AS quiz_attempts,
      ((SELECT COUNT(*) FROM discussion_replies WHERE author_id = ${id})
        + (SELECT COUNT(*) FROM discussion_threads WHERE author_id = ${id}))::int AS discussion_posts,
      (SELECT COUNT(*) FROM audit_logs WHERE actor_id = ${id})::int AS audit_entries,
      (SELECT COUNT(*) FROM attendance WHERE marked_by = ${id})::int AS marked_attendance,
      (SELECT COUNT(*) FROM submissions WHERE graded_by = ${id})::int AS graded_submissions,
      (SELECT COUNT(*) FROM courses WHERE teacher_id IN (SELECT id FROM teachers WHERE user_id = ${id}))::int AS courses,
      (SELECT COUNT(*) FROM discussion_threads t
        WHERE t.author_id = ${id}
          AND EXISTS (SELECT 1 FROM discussion_replies r WHERE r.thread_id = t.id AND r.author_id <> ${id}))::int AS shared_threads
  `;
  const counts = (row ?? {}) as Record<string, unknown>;
  return {
    own: toRecordCounts(counts, OWN_RECORD_LABELS),
    blocked: toRecordCounts(counts, PROTECTED_RECORD_LABELS),
  };
}

/**
 * Who may delete whom. Admins: anyone (except themselves and the last active admin).
 * Teachers: only the student accounts they created themselves.
 */
async function assertCanDelete(actor: AuthUser, target: TargetUser): Promise<void> {
  assertCanManageRole(actor, target.role);
  if (actor.id === target.id) throw httpError(403, 'You cannot delete your own account');
  if (actor.role === 'teacher' && target.created_by !== actor.id) {
    throw httpError(403, 'You can only delete students you added');
  }
  if (target.role === 'admin') await assertAnotherActiveAdminExists(target.id);
}

/**
 * Tells the client what deleting this account would involve, so the confirmation can show
 * real numbers. Applies the same permission rules as the delete itself.
 */
export async function previewDeleteUser(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const id = parseId(req.params.id);

  const target = await findTarget(id);
  await assertCanDelete(actor, target);

  const plan = await buildDeletePlan(id);
  res.json({
    can_delete: plan.blocked.length === 0 && (plan.own.length === 0 || actor.role === 'admin'),
    needs_cascade: plan.own.length > 0,
    own_records: plan.own,
    blocking_records: plan.blocked,
  });
}

/**
 * Permanent deletion. Admins can delete any account; teachers only the students they added.
 * An account whose own history (grades, attendance, submissions, quiz attempts, discussion
 * posts) exists is refused for teachers; an admin can delete it together with that history by
 * confirming with `?cascade=true`. Records that other people's data depends on (audit entries,
 * courses, attendance or grades someone recorded) always block deletion: deactivate instead.
 */
export async function deleteUser(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const id = parseId(req.params.id);
  const cascade = req.query.cascade === 'true';

  const target = await findTarget(id);
  await assertCanDelete(actor, target);

  const plan = await buildDeletePlan(id);
  if (plan.blocked.length > 0) {
    throw httpError(
      409,
      `This account can't be permanently deleted because it has ${describeRecords(plan.blocked)}. Deactivate it instead to keep those records.`,
    );
  }
  if (plan.own.length > 0) {
    if (actor.role !== 'admin') {
      throw httpError(
        409,
        `This account can't be deleted because it has ${describeRecords(plan.own)}. Deactivate it instead, or ask an administrator to delete it.`,
      );
    }
    if (!cascade) {
      throw httpError(
        409,
        `This account has ${describeRecords(plan.own)}. Confirm that these records should be deleted too, then try again.`,
      );
    }
  }

  const before = await fetchUserDetail(id);
  // Collected now because the rows (and their file references) are gone after the delete.
  const submittedFiles = await sql`
    SELECT file_public_id FROM submissions
    WHERE file_public_id IS NOT NULL
      AND student_id IN (SELECT id FROM students WHERE user_id = ${id})
  `;

  try {
    // One transaction: the account and its own records go together, or nothing changes.
    await sql.transaction([
      sql`DELETE FROM grades WHERE student_id IN (SELECT id FROM students WHERE user_id = ${id})`,
      sql`DELETE FROM attendance WHERE student_id IN (SELECT id FROM students WHERE user_id = ${id})`,
      sql`DELETE FROM submissions WHERE student_id IN (SELECT id FROM students WHERE user_id = ${id})`,
      sql`DELETE FROM quiz_attempts WHERE student_id IN (SELECT id FROM students WHERE user_id = ${id})`,
      sql`DELETE FROM enrollments WHERE student_id IN (SELECT id FROM students WHERE user_id = ${id})`,
      // Other people's replies to this account's replies stay, as top-level replies.
      sql`UPDATE discussion_replies SET parent_reply_id = NULL
          WHERE parent_reply_id IN (SELECT id FROM discussion_replies WHERE author_id = ${id})`,
      sql`DELETE FROM discussion_replies WHERE author_id = ${id}`,
      sql`DELETE FROM discussion_threads WHERE author_id = ${id}`,
      sql`DELETE FROM notifications WHERE user_id = ${id}`,
      sql`DELETE FROM students WHERE user_id = ${id}`,
      sql`DELETE FROM teachers WHERE user_id = ${id}`,
      sql`DELETE FROM profiles WHERE user_id = ${id}`,
      sql`DELETE FROM users WHERE id = ${id}`,
    ]);
  } catch (err) {
    rethrowDbError(
      err,
      "This account can't be permanently deleted because other records still reference it. Deactivate it instead.",
    );
  }

  // Best-effort Cloudinary cleanup; a failure here must never undo the deletion.
  await Promise.allSettled([
    deleteFromCloudinary(avatarPublicId(id), 'image'),
    deleteManyFromCloudinary(
      submittedFiles.map((row) => row.file_public_id as string),
      'raw',
      'authenticated',
    ),
  ]);

  await writeAudit(
    req,
    'user.delete',
    id,
    before
      ? {
          email: before.email,
          role: before.role,
          first_name: before.first_name,
          last_name: before.last_name,
          ...(plan.own.length > 0
            ? { records_deleted: Object.fromEntries(plan.own.map((record) => [record.key, record.count])) }
            : {}),
        }
      : null,
    null,
  );

  res.json({ message: 'User deleted' });
}
