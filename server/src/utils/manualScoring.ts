import { sql } from '../config/db.js';

/**
 * Items whose scores the teacher types in by hand after checking the work face to face: every exam,
 * and any assignment or quiz created as "in person". Online work is graded the usual way.
 */
export type ScoredType = 'assignment' | 'quiz' | 'exam';

export const SCORED_TYPES: readonly ScoredType[] = ['assignment', 'quiz', 'exam'];

export function isScoredType(value: string): value is ScoredType {
  return (SCORED_TYPES as readonly string[]).includes(value);
}

export interface ScoredItem {
  type: ScoredType;
  id: string;
  title: string;
  course_id: string;
  course_code: string;
  max_score: number;
  is_published: boolean;
  /** When it takes place: the exam time, the quiz date, or the assignment's due date. */
  when: string;
}

/** The item behind a score sheet, or null when it does not exist or is handed in online. */
export async function loadScoredItem(type: ScoredType, id: string): Promise<ScoredItem | null> {
  if (type === 'exam') {
    const [row] = await sql`
      SELECT e.id, e.title, e.course_id, c.code AS course_code, e.max_score::float8 AS max_score,
             e.is_published, e.exam_at AS "when"
      FROM exams e
      JOIN courses c ON c.id = e.course_id
      WHERE e.id = ${id}
    `;
    return row ? ({ type, ...row } as ScoredItem) : null;
  }
  if (type === 'quiz') {
    const [row] = await sql`
      SELECT q.id, q.title, q.course_id, c.code AS course_code, q.max_score::float8 AS max_score,
             q.is_published, q.scheduled_at AS "when"
      FROM quizzes q
      JOIN courses c ON c.id = q.course_id
      WHERE q.id = ${id} AND q.delivery = 'in_person'
    `;
    return row ? ({ type, ...row } as ScoredItem) : null;
  }
  const [row] = await sql`
    SELECT a.id, a.title, m.course_id, c.code AS course_code, a.max_score::float8 AS max_score,
           a.is_published, a.due_date AS "when"
    FROM assignments a
    JOIN modules m ON m.id = a.module_id
    JOIN courses c ON c.id = m.course_id
    WHERE a.id = ${id} AND a.delivery = 'in_person'
  `;
  return row ? ({ type, ...row } as ScoredItem) : null;
}

/** Where a student or teacher opens the item. */
export function itemLink(type: ScoredType, id: string): string {
  if (type === 'exam') return `/exams/${id}`;
  if (type === 'quiz') return `/quizzes/${id}`;
  return `/assignments/${id}`;
}

/**
 * Removes the typed-in scores of items that are being deleted, together with the grade rows those
 * scores created, so no nameless grades are left behind. Only pass in-person items (or exams):
 * an online item keeps its grades when it is deleted, as it always has.
 */
export async function deleteScoresOf(type: ScoredType, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await sql`DELETE FROM grades WHERE assessment_type = ${type} AND assessment_id = ANY(${itemIds}::uuid[])`;
  await sql`DELETE FROM manual_scores WHERE item_type = ${type} AND item_id = ANY(${itemIds}::uuid[])`;
}
