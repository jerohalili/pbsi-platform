import type { ManualStatus } from '@/components/assignments/types.ts';

/** An exam as returned by GET /exams and GET /exams/:id. Always in person; the teacher types in the scores. */
export interface ExamItem {
  id: string;
  course_id: string;
  title: string;
  /** Coverage, what to bring, reminders. */
  details: string | null;
  exam_at: string;
  duration_minutes: number | null;
  room: string | null;
  max_score: number;
  /** Drafts are visible only to the course's teacher and admins. */
  is_published: boolean;
  created_at: string;
  course_code: string;
  course_name: string;
  is_mine: boolean;
  can_manage: boolean;
  /** Only people who manage the exam get these. */
  scored_count: number | null;
  enrolled_count: number | null;
  /** Only students get their own score and status. */
  my_score: number | null;
  my_percent?: number | null;
  my_feedback: string | null;
  my_graded_at: string | null;
  /** Notes from the teacher: a student's unseen ones; for the course's teacher, the unresolved ones. */
  mention_count: number | null;
  status: ManualStatus | null;
}
