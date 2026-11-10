import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import type { AppError } from '../middleware/errorHandler.js';
import { getOwnStudentId, parseUuid } from '../utils/access.js';
import { CSV_BOM, csvCell } from '../utils/csv.js';

export async function listStudents(_req: Request, res: Response): Promise<void> {
  const { search, subject } = _req.query as {
    search?: string;
    subject?: string;
  };

  const searchParam = search ?? '';
  const subjectParam = subject ?? '';

  // Admins can delete any student; a teacher only the students they added themselves.
  const isAdmin = _req.user?.role === 'admin';
  const actorId = _req.user?.id ?? null;

  const students = await sql`
    SELECT s.id, s.student_id, s.enrollment_date,
           (SELECT ROUND(AVG(g.score)::numeric, 2)::float8 FROM grades g WHERE g.student_id = s.id) AS average_grade,
           s.subjects_assigned,
           u.id as user_id, u.email, u.is_active,
           COALESCE(${isAdmin}::boolean OR u.created_by = ${actorId}::uuid, FALSE) AS can_delete,
           p.first_name, p.last_name, p.phone, p.date_of_birth,
           p.gender, p.address, p.avatar_url
    FROM students s
    JOIN users u ON u.id = s.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE (${searchParam} = ''
           OR p.first_name ILIKE ${`%${searchParam}%`}
           OR p.last_name ILIKE ${`%${searchParam}%`}
           OR s.student_id ILIKE ${`%${searchParam}%`})
      AND (${subjectParam} = '' OR ${subjectParam} = ANY(s.subjects_assigned))
    ORDER BY p.last_name ASC, p.first_name ASC
  `;
  res.json({ students });
}

export async function getStudent(_req: Request, res: Response): Promise<void> {
  // A malformed id is a 400 here instead of a Postgres "invalid input syntax for type uuid" 500.
  const id = parseUuid(_req.params.id, 'student id');

  // The record holds an email, phone, date of birth and address: staff may open any student's,
  // a student only their own. Anyone else gets the same answer as for an id that does not exist.
  if (_req.user?.role === 'student' && (await getOwnStudentId(_req.user.id)) !== id) {
    const err = new Error('Student not found') as AppError;
    err.statusCode = 404;
    throw err;
  }

  const [student] = await sql`
    SELECT s.id, s.student_id, s.enrollment_date,
           (SELECT ROUND(AVG(g.score)::numeric, 2)::float8 FROM grades g WHERE g.student_id = s.id) AS average_grade,
           s.subjects_assigned,
           u.id as user_id, u.email, u.is_active,
           p.first_name, p.last_name, p.phone, p.date_of_birth,
           p.gender, p.address, p.avatar_url
    FROM students s
    JOIN users u ON u.id = s.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE s.id = ${id}
  `;
  if (!student) {
    const err = new Error('Student not found') as AppError;
    err.statusCode = 404;
    throw err;
  }
  res.json({ student });
}

export async function exportStudents(_req: Request, res: Response): Promise<void> {
  const students = await sql`
    SELECT s.student_id, p.first_name, p.last_name, u.email,
           p.phone, p.date_of_birth, s.enrollment_date,
           (SELECT ROUND(AVG(g.score)::numeric, 2)::float8 FROM grades g WHERE g.student_id = s.id) AS average_grade, s.subjects_assigned
    FROM students s
    JOIN users u ON u.id = s.user_id
    JOIN profiles p ON p.user_id = u.id
    ORDER BY s.student_id
  `;

  const headers = [
    'student_id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'date_of_birth',
    'enrollment_date',
    'average_grade',
    'subjects_assigned',
  ];

  const csv = [
    headers.join(','),
    ...students.map((row) =>
      headers.map((h) => csvCell(row[h])).join(','),
    ),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="students_export.csv"',
  );
  res.send(CSV_BOM + csv);
}
