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
