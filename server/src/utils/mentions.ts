import { sql } from '../config/db.js';
import type { ScoredType } from './manualScoring.js';

/** Notes can be written on any assignment, quiz or exam, online or in person. */
export type MentionItemType = ScoredType;

export interface MentionItem {
  type: MentionItemType;
  id: string;
  title: string;
  course_id: string;
  course_code: string;
  is_published: boolean;
}

/** The item a note is about, or null when it does not exist. */
export async function loadMentionItem(type: MentionItemType, id: string): Promise<MentionItem | null> {
  if (type === 'exam') {
    const [row] = await sql`
      SELECT e.id, e.title, e.course_id, c.code AS course_code, e.is_published
      FROM exams e JOIN courses c ON c.id = e.course_id
      WHERE e.id = ${id}
    `;
    return row ? ({ type, ...row } as MentionItem) : null;
  }
  if (type === 'quiz') {
    const [row] = await sql`
      SELECT q.id, q.title, q.course_id, c.code AS course_code, q.is_published
      FROM quizzes q JOIN courses c ON c.id = q.course_id
      WHERE q.id = ${id}
    `;
    return row ? ({ type, ...row } as MentionItem) : null;
  }
  const [row] = await sql`
    SELECT a.id, a.title, m.course_id, c.code AS course_code, a.is_published
    FROM assignments a
    JOIN modules m ON m.id = a.module_id
    JOIN courses c ON c.id = m.course_id
    WHERE a.id = ${id}
  `;
  return row ? ({ type, ...row } as MentionItem) : null;
}

/** Removes the notes of items that are being deleted. */
export async function deleteMentionsOf(type: MentionItemType, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await sql`DELETE FROM coursework_mentions WHERE item_type = ${type} AND item_id = ANY(${itemIds}::uuid[])`;
}

/** Where a student or teacher opens the item. */
export function mentionLink(type: MentionItemType, id: string): string {
  if (type === 'exam') return `/exams/${id}`;
  if (type === 'quiz') return `/quizzes/${id}`;
  return `/assignments/${id}`;
}
