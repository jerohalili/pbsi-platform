import type { Delivery, ManualStatus } from '@/components/assignments/types.ts';

export type QuestionType = 'mcq' | 'true_false' | 'short_answer';

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'Multiple choice',
  true_false: 'True / false',
  short_answer: 'Short answer',
};

/** A quiz as returned by GET /quizzes and GET /quizzes/:id. */
export interface QuizItem {
  id: string;
  course_id: string;
  title: string;
  time_limit_minutes: number | null;
  is_published: boolean;
  created_at: string;
  /** 'in_person': announced only (no online questions); the teacher types in each score. */
  delivery: Delivery;
  scheduled_at: string | null;
  room: string | null;
  details: string | null;
  max_score: number;
  course_code: string;
  course_name: string;
  is_mine: boolean;
  can_manage: boolean;
  question_count: number;
  total_points: number;
  /** Only people who manage the quiz get class-wide numbers. */
  attempt_count: number | null;
  average_score: number | null;
  /** In-person quizzes: typed-in scores, out of the students enrolled. */
  scored_count: number | null;
  enrolled_count: number | null;
  manual_score: number | null;
  manual_percent?: number | null;
  manual_feedback: string | null;
  manual_graded_at: string | null;
  /** Only students get their own attempt and a status. */
  attempt_id: string | null;
  my_score: number | null;
  my_submitted_at: string | null;
  status: 'completed' | 'not_taken' | ManualStatus | null;
}

export interface QuizQuestion {
  id: string;
  quiz_id: string;
  question_text: string;
  type: QuestionType;
  options: string[] | null;
  points: number;
  /** Optional picture shown with the question. */
  image_url?: string | null;
  /** Only present for people who manage the quiz. */
  correct_answer?: string;
}

export function formatTimeLimit(minutes: number | null): string {
  return minutes ? `${minutes} min` : 'No time limit';
}

/** "true" -> "True"; short answers list their accepted spellings. */
export function formatCorrectAnswer(type: QuestionType, answer: string): string {
  if (type === 'true_false') return answer.charAt(0).toUpperCase() + answer.slice(1);
  if (type === 'short_answer') return answer.split('|').join(' · ');
  return answer;
}
