/** Shapes returned by GET /api/dashboard/admin. A section is null when it could not be loaded (see `errors`). */
export interface ActivityDay {
  date: string;
  events: number;
}

export interface AdminMetrics {
  active_students: number;
  active_teachers: number;
  courses: number;
  activity: {
    days: ActivityDay[];
    events: number;
    logins: number;
    failed_logins: number;
    handins: number;
  };
}

export interface AuditStreamEntry {
  id: string;
  action: string;
  entity_type: string;
  created_at: string;
  actor_name: string;
}

export interface SchoolYear {
  term: string;
  start_year: number;
  end_year: number;
  courses: number;
  timetable_entries: number;
  enrollments: number;
  students_enrolled: number;
  teachers_teaching: number;
}

export type AlertKey =
  | 'courses_no_timetable'
  | 'courses_no_students'
  | 'courses_no_modules'
  | 'teachers_no_courses'
  | 'students_not_enrolled';

export interface AlertGroup {
  key: AlertKey;
  total: number;
  items: Array<{ id: string; label: string; link: string }>;
}

export type AdminSection = 'metrics' | 'audit_stream' | 'school_year' | 'alerts';

export interface AdminDashboardData {
  generated_at: string;
  metrics: AdminMetrics | null;
  audit_stream: AuditStreamEntry[] | null;
  school_year: SchoolYear | null;
  alerts: { total: number; groups: AlertGroup[] } | null;
  errors: Partial<Record<AdminSection, string>>;
}

export const ALERT_TITLE: Record<AlertKey, string> = {
  courses_no_timetable: 'Courses with no timetable entry',
  courses_no_students: 'Courses with no active students',
  courses_no_modules: 'Courses with no modules',
  teachers_no_courses: 'Teachers with no courses',
  students_not_enrolled: 'Students not enrolled in any course',
};

/** Plain-English names for the audit actions the server records. */
const ACTION_LABELS: Record<string, string> = {
  'announcement.create': 'Announcement posted',
  'announcement.update': 'Announcement edited',
  'announcement.delete': 'Announcement deleted',
  'assignment.create': 'Assignment created',
  'assignment.update': 'Assignment edited',
  'assignment.delete': 'Assignment deleted',
  'attendance.override': 'Attendance overridden',
  'course.create': 'Course created',
  'course.update': 'Course edited',
  'course.delete': 'Course deleted',
  'discussion.reply.delete': 'Discussion reply removed',
  'discussion.report': 'Discussion post reported',
  'discussion.thread.delete': 'Discussion thread removed',
  'enrollment.add': 'Student enrolled',
  'enrollment.remove': 'Student removed from a course',
  'exam.create': 'Exam created',
  'exam.update': 'Exam edited',
  'exam.delete': 'Exam deleted',
  'grade.override': 'Grade adjusted',
  'mention.create': 'Note sent to a student',
  'mention.update': 'Note to a student edited',
  'mention.delete': 'Note to a student deleted',
  'notification.send': 'Notification sent',
  'password.change': 'Password changed',
  'profile.update': 'Profile updated',
  'quiz.create': 'Quiz created',
  'quiz.update': 'Quiz edited',
  'quiz.delete': 'Quiz deleted',
  'score.enter': 'Scores entered',
  'submission.grade': 'Submission graded',
  'timetable.create': 'Timetable entry added',
  'timetable.delete': 'Timetable entry removed',
  'user.create': 'Account created',
  'user.update': 'Account edited',
  'user.deactivate': 'Account deactivated',
  'user.reactivate': 'Account reactivated',
  'user.reset_password': 'Password reset',
  'user.delete': 'Account deleted',
};

/** The friendly name of an audit action; an action added later still reads sensibly ("Foo bar" from "foo.bar"). */
export function actionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const plain = action.replace(/[._]+/g, ' ').trim();
  return plain ? plain.charAt(0).toUpperCase() + plain.slice(1) : 'Action';
}

/** "Mon" from the server's 'YYYY-MM-DD' school date (no timezone shifting). */
export function weekdayShort(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { weekday: 'short' });
}
