/** Shapes returned by GET /api/dashboard/teacher. A section is null when it could not be loaded (see `errors`). */
export interface TeacherClass {
  id: string;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string | null;
  course_id: string;
  course_code: string;
  course_name: string;
  student_count: number;
  attendance_marked: number;
}

export interface PendingScoreItem {
  kind: 'assignment' | 'quiz' | 'exam';
  /** 'submissions': handed-in work to grade. 'scores': in-person work with students who have no score yet. */
  source: 'submissions' | 'scores';
  id: string;
  title: string;
  course_id: string;
  course_code: string;
  pending_count: number;
  since: string;
  link: string;
}

export interface DraftItem {
  kind: 'assignment' | 'quiz' | 'exam';
  id: string;
  title: string;
  created_at: string;
  course_id: string;
  course_code: string;
  link: string;
}

export interface TeacherCourse {
  course_id: string;
  code: string;
  name: string;
  student_count: number;
  unread: number;
}

export interface ActivityEntry {
  kind: 'submission' | 'quiz_attempt' | 'discussion' | 'reply';
  id: string;
  at: string;
  actor_name: string;
  title: string;
  course_code: string;
  score?: number | null;
  link: string;
}

export interface OpenMention {
  id: string;
  reason: 'comment' | 'missed_deadline' | 'correction';
  message: string;
  created_at: string;
  acknowledged: boolean;
  item_type: string;
  item_id: string;
  course_code: string;
  item_title: string | null;
  student_name: string;
  link: string;
}

export type TeacherSection = 'today' | 'pending_scores' | 'drafts' | 'courses' | 'recent_activity' | 'open_mentions';

export interface TeacherDashboardData {
  generated_at: string;
  today: { date: string; day_of_week: number; classes: TeacherClass[] } | null;
  pending_scores: { items: PendingScoreItem[]; total_items: number; total_students: number } | null;
  drafts: { total: number; items: DraftItem[] } | null;
  courses: TeacherCourse[] | null;
  recent_activity: ActivityEntry[] | null;
  open_mentions: { count: number; notes: OpenMention[] } | null;
  errors: Partial<Record<TeacherSection, string>>;
}
