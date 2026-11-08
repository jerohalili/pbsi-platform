/** Shapes returned by GET /api/dashboard/student. A section is null when it could not be loaded (see `errors`). */
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';

export interface TodayClass {
  id: string;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string | null;
  course_id: string;
  course_code: string;
  course_name: string;
  teacher_name: string;
  attendance_status: AttendanceStatus | null;
}

export interface TodoItem {
  group: 'assignment' | 'scheduled' | 'quiz';
  kind: 'assignment' | 'quiz' | 'exam';
  id: string;
  title: string;
  course_id: string;
  course_code: string;
  at?: string;
  is_overdue?: boolean;
  room?: string | null;
  time_limit_minutes?: number | null;
  link: string;
}

export interface CourseCard {
  course_id: string;
  code: string;
  name: string;
  teacher_name: string;
  unread: number;
}

export interface RecentGrade {
  id: string;
  assessment_type: string;
  assessment_id: string;
  score: number;
  feedback: string | null;
  created_at: string;
  title: string | null;
  course_code: string;
}

export interface AttentionNote {
  id: string;
  item_type: string;
  item_id: string;
  reason: 'comment' | 'missed_deadline' | 'correction';
  message: string;
  created_at: string;
  course_code: string;
  item_title: string | null;
  link: string;
}

export interface DiscussionHighlight {
  id: string;
  title: string;
  message: string;
  link: string | null;
  created_at: string;
  course_code: string | null;
}

export type StudentSection = 'today' | 'todo' | 'courses' | 'recent_grades' | 'attention' | 'discussion_highlights';

export interface StudentDashboardData {
  generated_at: string;
  today: { date: string; day_of_week: number; classes: TodayClass[] } | null;
  todo: { items: TodoItem[]; truncated: boolean } | null;
  courses: CourseCard[] | null;
  recent_grades: RecentGrade[] | null;
  attention: { count: number; notes: AttentionNote[] } | null;
  discussion_highlights: DiscussionHighlight[] | null;
  errors: Partial<Record<StudentSection, string>>;
}

/** Grade (percent) at or above which a student passes (same mark as the server uses). */
export const PASSING_GRADE = 75;

export { formatManila, formatSchoolDay } from '@/lib/dashboardFormat.ts';
