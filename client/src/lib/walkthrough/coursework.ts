import type { DriveStep } from 'driver.js';
import type { TourBuilder } from './types.ts';
import { present, sel } from './shell.ts';

type Side = 'top' | 'bottom' | 'left' | 'right';

function step(name: string, title: string, description: string, side: Side = 'bottom'): DriveStep {
  return { element: sel(name), popover: { title, description, side, align: 'center' } };
}

/** /coursework */
export const courseworkTour: TourBuilder = ({ role }) => {
  const student = role === 'student';
  const steps: DriveStep[] = [
    step(
      'cw-header',
      'Coursework',
      student
        ? 'Your assignments, quizzes and exams in one place.'
        : 'Assignments, quizzes and exams in one place. Some are done online; others are announced here and scored by hand.',
    ),
    step('cw-tabs', 'Kind of coursework', 'Switch between everything, assignments, quizzes and exams. The number is how many of each there are.'),
    step(
      'cw-filters',
      'Filters',
      student
        ? 'Filter by course, or by status: Needs attention, To do, Waiting for a score and Done.'
        : 'Filter by course, or by status: Drafts, Needs scoring and Open notes.',
    ),
  ];
  if (present('cw-new')) {
    steps.push(step('cw-new', 'New', 'Pick the kind and the course, then finish the details on that course\u2019s page.'));
  }
  if (present('cw-table')) {
    steps.push(
      step(
        'cw-table',
        'Your list',
        student
          ? 'Each row shows the item, its date and your status or score. \u201cOpen\u201d takes you to the item.'
          : 'Each row shows the item, its date and progress. A Draft badge means students cannot see it yet, and Needs scoring flags work waiting for you.',
        'top',
      ),
    );
  } else if (present('cw-empty')) {
    steps.push(
      step('cw-empty', 'Nothing here yet', student ? 'Items from your courses will appear here.' : 'Use \u201cNew\u201d to add an assignment, a quiz or an exam.', 'top'),
    );
  }
  return steps;
};

type Kind = 'assignment' | 'quiz' | 'exam';

const INFO_TEXT: Record<Kind, string> = {
  assignment: 'The course, due date, points and instructions. In-person assignments show the date and room instead.',
  quiz: 'The course, number of questions, points and time limit. In-person quizzes show the date and room instead.',
  exam: 'The course and title. The exam date, room and points are shown right below.',
};

const PUBLISH_NOTE: Record<Kind, string> = {
  assignment: ' Once students have handed in work, it can no longer be unpublished.',
  quiz: '',
  exam: ' Once scores are recorded, it can no longer be unpublished.',
};

/** Parts shared by the assignment, quiz and exam detail pages. */
function itemTour(kind: Kind, specific: () => DriveStep[]): TourBuilder {
  return () => {
    const steps: DriveStep[] = [step('cwd-info', `About this ${kind}`, INFO_TEXT[kind])];
    if (present('cwd-draft')) {
      steps.push(
        step('cwd-draft', 'Still a draft', 'Students cannot see it, and are not notified, until you publish it.'),
      );
    }
    if (present('cwd-actions')) {
      steps.push(
        step(
          'cwd-actions',
          'Publish, edit or delete',
          `Publish makes it visible to students and notifies them. Edit changes the details. Delete asks you to confirm first.${PUBLISH_NOTE[kind]}`,
          'left',
        ),
      );
    }
    if (present('cwd-score')) {
      steps.push(
        step(
          'cwd-score',
          'Your score',
          'Your teacher enters your score and a comment after checking your work in person. You are notified when it appears.',
          'top',
        ),
      );
    }
    if (present('cwd-scores')) {
      steps.push(
        step(
          'cwd-scores',
          'Scores',
          'Enter each student\u2019s score after checking their work in person. Students see their own score and comment, and are notified.',
          'top',
        ),
      );
    }
    steps.push(...specific());
    return steps;
  };
}

export const assignmentDetailTour = itemTour('assignment', () => {
  const steps: DriveStep[] = [];
  if (present('ad-work')) {
    steps.push(
      step(
        'ad-work',
        'Your work',
        'Hand in a file or a link. Work handed in after the due date is marked late. You can replace it until it is graded; after grading it is locked.',
        'top',
      ),
    );
  }
  if (present('ad-submissions')) {
    steps.push(
      step(
        'ad-submissions',
        'Submissions',
        'See who handed in, who is missing and who is graded. Download a file, write a note to a student, or use Grade / Edit grade.',
        'top',
      ),
    );
  }
  return steps;
});

export const quizDetailTour = itemTour('quiz', () => {
  const steps: DriveStep[] = [];
  if (present('qd-attempt')) {
    steps.push(
      step(
        'qd-attempt',
        'Take the quiz',
        'You can take it once. With a time limit, the timer starts when you press Start and keeps running even if you close the page. Answers save as you go. Afterwards your score and a View result button appear here.',
        'top',
      ),
    );
  }
  if (present('qd-questions')) {
    steps.push(
      step(
        'qd-questions',
        'Questions',
        'Add questions here, then publish the quiz. Once students have taken it, the questions lock to keep results fair.',
        'top',
      ),
    );
  }
  if (present('qd-results')) {
    steps.push(step('qd-results', 'Results', 'Who took the quiz, who did not, and the class average.', 'top'));
  }
  return steps;
});

export const examDetailTour = itemTour('exam', () => []);
