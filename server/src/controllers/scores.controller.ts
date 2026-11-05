import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { saveScoresSchema } from '../utils/validation.js';
import { assertCanManageCourse, httpError, parseUuid } from '../utils/access.js';
import { recordAudit } from '../utils/audit.js';
import { schoolYearTerm, toPercent } from '../utils/gradeTerm.js';
import { isScoredType, itemLink, loadScoredItem, type ScoredType } from '../utils/manualScoring.js';
import type { AuthUser } from '../types/index.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

function parseType(value: string): ScoredType {
  if (!isScoredType(value)) throw httpError(400, 'Unknown kind of item');
  return value;
}

/** The item and the right to score it, or an error that does not reveal anything to others. */
async function loadForScoring(user: AuthUser, req: Request) {
  const type = parseType(req.params.item_type);
  const id = parseUuid(req.params.id, 'item id');
  const item = await loadScoredItem(type, id);
  if (!item) throw httpError(404, 'There is nothing to score here: it does not exist, or it is handed in online.');
  await assertCanManageCourse(user, item.course_id);
  return item;
}

/**
 * GET /api/scores/:item_type/:id: the score sheet of an exam or an in-person assignment / quiz:
 * every active student enrolled in the course with the score typed in so far. Someone who has a
 * score and has since left the course (or been deactivated) still shows, so it is never hidden.
 */
export async function getScoreSheet(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const item = await loadForScoring(user, req);

  const rows = await sql`
    SELECT st.id AS student_id, st.student_id AS student_number, p.first_name, p.last_name, u.is_active,
           ms.score::float8 AS score, ms.feedback, ms.graded_at
    FROM students st
    JOIN users u ON u.id = st.user_id
    JOIN profiles p ON p.user_id = u.id
    LEFT JOIN manual_scores ms
           ON ms.item_type = ${item.type} AND ms.item_id = ${item.id} AND ms.student_id = st.id
    WHERE (
            u.is_active = TRUE
            AND EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = st.id AND e.course_id = ${item.course_id})
          )
       OR ms.student_id IS NOT NULL
    ORDER BY p.last_name ASC, p.first_name ASC
  `;
  res.json({ item, rows });
}

/**
 * PUT /api/scores/:item_type/:id { scores: [{ student_id, score | null, feedback? }] }
 *
 * Saves the sheet. A number records or changes that student's score; null clears it. Students not
 * in the list are left alone. Each score is also written to `grades` as a percentage, exactly as
 * graded online work is, so the Grades pages and averages include it. A student is notified when
 * their score appears or changes (not when only the comment changes).
 */
export async function saveScores(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const input = saveScoresSchema.parse(req.body);
  const item = await loadForScoring(user, req);

  if (!item.is_published) {
    throw httpError(409, 'Publish this first: students can only see scores of items they can see.');
  }

  // Last entry per student wins; scores keep two decimals.
  const byStudent = new Map<string, { score: number | null; feedback: string }>();
  for (const row of input.scores) {
    const score = row.score === null ? null : Math.round(row.score * 100) / 100;
    if (score !== null && score > item.max_score) {
      throw httpError(400, `A score can’t be higher than the maximum of ${item.max_score}.`);
    }
    byStudent.set(row.student_id, { score, feedback: row.feedback ?? '' });
  }
  const studentIds = [...byStudent.keys()];

  // Only students of this course (or ones who already have a score here) can be scored.
  const strangers = await sql`
    SELECT s AS id
    FROM unnest(${studentIds}::uuid[]) AS s
    WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = ${item.course_id} AND e.student_id = s)
      AND NOT EXISTS (
        SELECT 1 FROM manual_scores m WHERE m.item_type = ${item.type} AND m.item_id = ${item.id} AND m.student_id = s
      )
  `;
  if (strangers.length > 0) {
    throw httpError(409, 'Some of these students are not in this course. Refresh the page and try again.');
  }

  const previous = await sql`
    SELECT student_id, score::float8 AS score FROM manual_scores WHERE item_type = ${item.type} AND item_id = ${item.id}
  `;
  const previousScore = new Map(previous.map((r) => [r.student_id as string, r.score as number]));

  const setIds: string[] = [];
  const setScores: number[] = [];
  const setPercents: number[] = [];
  const setFeedback: string[] = [];
  const clearIds: string[] = [];
  for (const [studentId, row] of byStudent) {
    if (row.score === null) {
      clearIds.push(studentId);
    } else {
      setIds.push(studentId);
      setScores.push(row.score);
      setPercents.push(toPercent(row.score, item.max_score));
      setFeedback.push(row.feedback);
    }
  }

  // One transaction, under a lock for this item. Two saves for the same student already queue up on
  // the primary key of manual_scores, so that alone prevents duplicates; the lock additionally keeps
  // two whole-sheet saves (one setting scores, one clearing them) from interleaving, so the grades
  // rows always stay in step with the typed-in scores.
  const lockKey = `${item.type}:${item.id}`;
  const statements = [sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))`];
  if (clearIds.length > 0) {
    statements.push(sql`
      DELETE FROM manual_scores
      WHERE item_type = ${item.type} AND item_id = ${item.id} AND student_id = ANY(${clearIds}::uuid[])
    `);
    statements.push(sql`
      DELETE FROM grades
      WHERE assessment_type = ${item.type} AND assessment_id = ${item.id} AND student_id = ANY(${clearIds}::uuid[])
    `);
  }
  if (setIds.length > 0) {
    statements.push(sql`
      INSERT INTO manual_scores (item_type, item_id, student_id, course_id, score, feedback, graded_by, graded_at)
      SELECT ${item.type}::text, ${item.id}::uuid, v.student_id, ${item.course_id}::uuid, v.score,
             NULLIF(v.feedback, ''), ${user.id}::uuid, now()
      FROM unnest(${setIds}::uuid[], ${setScores}::numeric[], ${setFeedback}::text[]) AS v(student_id, score, feedback)
      ON CONFLICT (item_type, item_id, student_id) DO UPDATE
        SET score = EXCLUDED.score, feedback = EXCLUDED.feedback, graded_by = EXCLUDED.graded_by, graded_at = now()
        WHERE manual_scores.score IS DISTINCT FROM EXCLUDED.score
           OR manual_scores.feedback IS DISTINCT FROM EXCLUDED.feedback
    `);
    statements.push(sql`
      UPDATE grades g
      SET score = v.percent, feedback = NULLIF(v.feedback, '')
      FROM unnest(${setIds}::uuid[], ${setPercents}::numeric[], ${setFeedback}::text[]) AS v(student_id, percent, feedback)
      WHERE g.student_id = v.student_id AND g.assessment_type = ${item.type} AND g.assessment_id = ${item.id}
    `);
    statements.push(sql`
      INSERT INTO grades (student_id, course_id, assessment_type, assessment_id, score, feedback, term)
      SELECT v.student_id, ${item.course_id}::uuid, ${item.type}::text, ${item.id}::uuid, v.percent,
             NULLIF(v.feedback, ''), ${schoolYearTerm()}::text
      FROM unnest(${setIds}::uuid[], ${setPercents}::numeric[], ${setFeedback}::text[]) AS v(student_id, percent, feedback)
      WHERE NOT EXISTS (
        SELECT 1 FROM grades g
        WHERE g.student_id = v.student_id AND g.assessment_type = ${item.type} AND g.assessment_id = ${item.id}
      )
    `);
  }
  await sql.transaction(statements);

  const cleared = clearIds.filter((id) => previousScore.has(id)).length;
  const changedIds = setIds.filter((id, i) => previousScore.get(id) !== setScores[i]);

  await recordAudit(req, 'score.enter', item.type, item.id, null, {
    course_id: item.course_id,
    title: item.title,
    saved: changedIds.length,
    cleared,
  });

  // Best effort: a failed notification never undoes saved scores.
  if (changedIds.length > 0) {
    try {
      const messages = changedIds.map((id) => {
        const score = setScores[setIds.indexOf(id)];
        return `${item.title} (${item.course_code}): ${score}/${item.max_score} (${toPercent(score, item.max_score)}%)`;
      });
      await sql`
        INSERT INTO notifications (user_id, type, title, message, link)
        SELECT st.user_id, 'grade', 'Score posted', v.message, ${itemLink(item.type, item.id)}::text
        FROM unnest(${changedIds}::uuid[], ${messages}::text[]) AS v(student_id, message)
        JOIN students st ON st.id = v.student_id
      `;
    } catch (err) {
      console.error('[scores] could not notify students:', err);
    }
  }

  res.json({ saved: changedIds.length, cleared });
}
