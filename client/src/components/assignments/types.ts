export type AssignmentStatus = 'not_submitted' | 'submitted' | 'graded' | 'overdue' | null;

/** An assignment as returned by GET /assignments and GET /assignments/:id. */
export interface AssignmentItem {
  id: string;
  module_id: string;
  title: string;
  instructions: string | null;
  due_date: string;
  /** Drafts are visible only to the course's teacher and admins. */
  is_published: boolean;
  max_score: number;
  attachment_url: string | null;
  /** A private material file uploaded by the teacher (separate from the link above). */
  attachment_name: string | null;
  has_attachment_file: boolean;
  created_at: string;
  module_title: string;
  course_id: string;
  course_code: string;
  course_name: string;
  is_mine: boolean;
  can_manage: boolean;
  /** Only teachers/admins get class-wide counts. */
  submitted_count: number | null;
  graded_count: number | null;
  /** Only students get their own submission and status. */
  submission_id: string | null;
  submission_url: string | null;
  /** True when the student handed in an uploaded file instead of a link. */
  submission_is_file: boolean;
  submission_file_name: string | null;
  submitted_at: string | null;
  grade: number | null;
  feedback: string | null;
  graded_at: string | null;
  is_late: boolean;
  status: AssignmentStatus;
}

// Links come from users, so only ever render real web links.
export const isWebUrl = (value: string | null | undefined): value is string =>
  !!value && /^https?:\/\//i.test(value);
