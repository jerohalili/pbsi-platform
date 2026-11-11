import type { DriveStep } from 'driver.js';
import type { TourBuilder } from './types.ts';
import { present, tip } from './shell.ts';

/** /users (admin only) */
export const usersTour: TourBuilder = () => {
  const steps: DriveStep[] = [
    tip('us-header', 'User management', 'Create, edit and manage every account in the system.'),
    tip(
      'us-add',
      'Add user',
      'Opens a form for the role, name, email and an initial password (at least 8 characters). Student and employee ID numbers are generated for you if you leave them blank, and you can copy the login details once the account is created.',
      'left',
    ),
    tip('us-filters', 'Find an account', 'Search by name, email or ID number, then filter by role and by status (active or inactive).'),
  ];
  if (present('us-table')) {
    steps.push(
      tip('us-table', 'Accounts', 'One row per account with its role, ID number and status. Inactive accounts look faded.', 'top'),
    );
  }
  if (present('us-actions')) {
    steps.push(
      tip(
        'us-actions',
        'Row actions',
        'The pencil edits the account and the key sets a new password. The person icon deactivates it: they can no longer sign in, but their records are kept and you can reactivate it any time. The bin deletes permanently, after checking the account\u2019s records, and may tell you to deactivate instead. You cannot deactivate or delete your own account.',
        'left',
      ),
    );
  }
  return steps;
};

/** /students (admin and teacher) */
export const studentsTour: TourBuilder = ({ role }) => {
  const steps: DriveStep[] = [
    tip('stu-header', 'Student directory', 'Manage and view student records.'),
    tip('stu-search', 'Search', 'Type a name or student ID to narrow the list.'),
    tip(
      'stu-add',
      'Add student',
      'Opens a form to create a student account. The student ID is generated for you if you leave it blank, and you can copy the login details once it is created.',
      'left',
    ),
  ];
  if (present('stu-table')) {
    steps.push(
      tip(
        'stu-table',
        'Students',
        'Each row shows the ID, name, email, average grade and subjects. A green grade means the student is at or above the passing mark. Inactive students look faded and carry an Inactive badge.',
        'top',
      ),
    );
  }
  if (present('stu-actions')) {
    steps.push(
      tip(
        'stu-actions',
        'Row actions',
        role === 'admin'
          ? 'View opens the student\u2019s profile. The pencil edits details and the key sets a new password. The person icon deactivates or reactivates (a confirmation explains the effect first). The bin deletes permanently and appears only when you are allowed to delete that account.'
          : 'View opens the student\u2019s profile. The pencil edits details and the key sets a new password. The person icon deactivates or reactivates (a confirmation explains the effect first). The bin appears only for accounts you are allowed to delete.',
        'left',
      ),
    );
  }
  return steps;
};

/** /students/:id (admin and teacher) */
export const studentDetailTour: TourBuilder = () => {
  const steps: DriveStep[] = [
    tip('sd-header', 'Student profile', 'One student\u2019s record, with their student ID under the title.'),
    tip('sd-profile', 'Details', 'Contact details, address, date of birth and enrollment date. To change them, use the pencil on the Students list.'),
  ];
  if (present('sd-subjects')) {
    steps.push(tip('sd-subjects', 'Subjects assigned', 'The subjects assigned to this student.', 'top'));
  }
  steps.push(
    tip('sd-average', 'Average grade', 'The average of all graded assignments and quizzes.', 'left'),
  );
  return steps;
};

/** /announcements (admin and teacher; students are redirected to the dashboard) */
export const announcementsTour: TourBuilder = ({ role }) => {
  const admin = role === 'admin';
  const steps: DriveStep[] = [
    tip(
      'an-header',
      'Announcements',
      admin
        ? 'Post to everyone, to teachers, to students, or to one course.'
        : 'Post to the students of your courses. Admins can see everything you post.',
    ),
    tip(
      'an-new',
      'New announcement',
      admin
        ? 'Choose the audience (everyone, teachers, students or one course), then write a title and a message. Everyone in the audience is notified when you post. You can also set a time to hide it automatically, and mark it Urgent to show a red banner on every page until it expires.'
        : 'Choose one of your courses, then write a title and a message. The students enrolled in it are notified when you post. You can also set a time to hide it automatically, and mark it Urgent to show a red banner on every page until it expires.',
      'left',
    ),
    tip(
      'an-tabs',
      'Live and Expired',
      'Live announcements are showing now. Expired ones have passed their hide-after time and no longer appear on dashboards or the banner. The number is how many are in each.',
    ),
  ];
  if (present('an-list')) {
    steps.push(
      tip('an-list', 'Your announcements', 'Badges show Urgent, Expired and the audience. Each one shows who posted it, when, and when it expires.', 'top'),
    );
  } else if (present('an-empty')) {
    steps.push(tip('an-empty', 'Nothing here yet', 'Use \u201cNew announcement\u201d to post the first one.', 'top'));
  }
  if (present('an-actions')) {
    steps.push(
      tip(
        'an-actions',
        'Edit or delete',
        'Edit changes an announcement, and editing does not notify anyone again. Delete asks you to confirm: it disappears for everyone, but people who were already notified keep their notification. These buttons appear only on announcements you can manage.',
        'left',
      ),
    );
  }
  return steps;
};

/** /audit-logs (admin only) */
export const auditLogsTour: TourBuilder = () => {
  const steps: DriveStep[] = [
    tip(
      'al-header',
      'Audit logs',
      'A permanent record of sensitive actions: who did what, to which record, and what changed. Times are shown in Philippine time.',
    ),
    tip('al-filters', 'Narrow it down', 'Filter by action, record type and a date range. \u201cClear filters\u201d appears once a filter is on.'),
  ];
  if (present('al-table')) {
    steps.push(
      tip(
        'al-table',
        'The log',
        'Each row shows when it happened, who did it (the actor), what they did, which record it touched and the IP address it came from.',
        'top',
      ),
    );
  }
  if (present('al-details')) {
    steps.push(tip('al-details', 'See what changed', 'The arrow opens that entry\u2019s details, including what changed.', 'right'));
  }
  if (present('al-record')) {
    steps.push(
      tip(
        'al-record',
        'History of one record',
        'Click a short record ID to show only the history of that record. \u201cShow all records\u201d brings the full log back.',
        'top',
      ),
    );
  }
  if (present('al-pager')) {
    steps.push(tip('al-pager', 'Pages', 'Move between pages of entries. \u201cShowing X\u2013Y of Z\u201d tells you where you are.', 'top'));
  }
  return steps;
};
