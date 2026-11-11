import type { DriveStep } from 'driver.js';
import type { TourBuilder } from './types.ts';
import { present, tip } from './shell.ts';

/** /courses */
export const coursesTour: TourBuilder = ({ role }) => {
  const canCreate = role === 'admin' || role === 'teacher';
  const steps: DriveStep[] = [
    tip(
      'courses-header',
      'Your courses',
      canCreate
        ? 'Create and manage courses and their modules from here.'
        : 'Only the courses you are enrolled in appear here. Your teacher or an administrator adds you to them.',
    ),
  ];
  if (canCreate && present('courses-new')) {
    steps.push(
      tip('courses-new', 'New course', 'Creates a course. Administrators also pick which teacher is in charge of it.'),
    );
  }
  if (present('courses-card')) {
    steps.push(
      tip(
        'courses-card',
        'Course card',
        canCreate
          ? 'Each card shows the course code, credits, teacher and a short description. A green \u201cYour course\u201d badge marks courses you teach. Click a card to open it.'
          : 'Each card shows the course code, credits, teacher and a short description. Click a card to open the course.',
      ),
    );
  } else if (present('courses-empty')) {
    steps.push(
      tip(
        'courses-empty',
        'Nothing here yet',
        canCreate ? 'Use \u201cNew Course\u201d to create the first course.' : 'Courses appear here once you are enrolled in them.',
      ),
    );
  }
  return steps;
};

/** /courses/:id */
export const courseDetailTour: TourBuilder = () => {
  const canEdit = present('cd-edit');
  const steps: DriveStep[] = [
    tip('cd-header', 'About this course', 'The course code, teacher, credits and description.'),
    tip('cd-discussions', 'Discussions', 'Opens the discussion board for this course.'),
  ];
  if (canEdit) {
    steps.push(
      tip('cd-edit', 'Edit or delete', 'Edit changes the course details. Delete is permanent, so it asks you to confirm first.'),
    );
  }
  steps.push(
    tip(
      'cd-modules',
      'Modules',
      canEdit
        ? 'The course is built from modules, shown in order. Use the arrows to reorder them and the Edit button to fill one with content.'
        : 'The lessons of the course, in order. Open or close a module to read it, or use Expand all / Collapse all.',
      'top',
    ),
  );
  if (canEdit && present('cd-add-module')) {
    steps.push(
      tip('cd-add-module', 'Add module', 'Adds a module. Then press Edit on it to add text, video, images, files and links.'),
    );
  }
  steps.push(
    tip(
      'cd-quizzes',
      'Quizzes',
      canEdit
        ? 'Create online or in-person quizzes here. Open one to build its questions and publish it.'
        : 'Online quizzes you can take, and in-person quizzes with their date and room.',
      'top',
    ),
    tip(
      'cd-exams',
      'Exams',
      canEdit
        ? 'Announce exams here. Scores are entered manually after you check the work in person.'
        : 'Exams your teacher announced, with date and room. They are scored after your teacher checks your work in person.',
      'top',
    ),
    tip(
      'cd-assignments',
      'Assignments',
      canEdit
        ? 'Create assignments, then open one to see hand-ins and grade them.'
        : 'Open an assignment to read the instructions and hand in your work before the deadline.',
      'top',
    ),
  );
  if (canEdit && present('cd-students')) {
    steps.push(
      tip(
        'cd-students',
        'Students in this course',
        'Only the students listed here can see this course, its work and its quizzes. Use \u201cAdd students\u201d to enroll more.',
        'top',
      ),
    );
  }
  return steps;
};

/** /courses/:courseId/modules/:moduleId/edit (admin and teacher only) */
export const moduleEditTour: TourBuilder = () => {
  const steps: DriveStep[] = [
    tip('me-header', 'Editing a module', 'A module is one unit of the course: lesson notes plus content blocks for students to study.'),
    tip(
      'me-details',
      'Title and lesson notes',
      'Change the title or notes, then press Save changes. Cancel leaves without saving. Blocks below save by themselves.',
    ),
    tip('me-blocks', 'Content blocks', 'The blocks students see, in order. Every change to a block is saved instantly.', 'top'),
    tip(
      'me-add-block',
      'Add a block',
      'Pick a type: text (with a small formatting toolbar), video, image, file or PDF, or a web link.',
      'top',
    ),
  ];
  if (present('me-block-actions')) {
    steps.push(
      tip(
        'me-block-actions',
        'Move, edit or delete',
        'The arrows reorder blocks. The pencil edits one, and for a file you can replace it. The bin deletes it after asking you to confirm.',
        'left',
      ),
    );
  }
  return steps;
};
