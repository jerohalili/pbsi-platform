import type { DriveStep } from 'driver.js';
import type { TourBuilder } from './types.ts';
import { present, tip } from './shell.ts';

/** /coursework */
export const courseworkTour: TourBuilder = ({ role }) => {
  const student = role === 'student';
  const steps: DriveStep[] = [
    tip(
      'cw-header',
      'Coursework',
      student
        ? 'Your assignments, quizzes and exams in one place.'
        : 'Assignments, quizzes and exams in one place. Some are done online; others are announced here and scored by hand.',
    ),
    tip('cw-tabs', 'Kind of coursework', 'Switch between everything, assignments, quizzes and exams. The number is how many of each there are.'),
    tip(
      'cw-filters',
      'Filters',
      student
        ? 'Filter by course, or by status: Needs attention, To do, Waiting for a score and Done.'
        : 'Filter by course, or by status: Drafts, Needs scoring and Open notes.',
    ),
  ];
  if (present('cw-new')) {
    steps.push(tip('cw-new', 'New', 'Pick the kind and the course, then finish the details on that course\u2019s page.'));
  }
  if (present('cw-table')) {
    steps.push(
      tip(
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
      tip('cw-empty', 'Nothing here yet', student ? 'Items from your courses will appear here.' : 'Use \u201cNew\u201d to add an assignment, a quiz or an exam.', 'top'),
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
  return ({ role }) => {
    const steps: DriveStep[] = [tip('cwd-info', `About this ${kind}`, INFO_TEXT[kind])];
    if (present('cwd-draft')) {
      steps.push(
        tip('cwd-draft', 'Still a draft', 'Students cannot see it, and are not notified, until you publish it.'),
      );
    }
    if (present('cwd-actions')) {
      steps.push(
        tip(
          'cwd-actions',
          'Publish, edit or delete',
          `Publish makes it visible to students and notifies them. Edit changes the details. Delete asks you to confirm first.${PUBLISH_NOTE[kind]}`,
          'left',
        ),
      );
    }
    if (present('cwd-score')) {
      steps.push(
        tip(
          'cwd-score',
          'Your score',
          'Your teacher enters your score and a comment after checking your work in person. You are notified when it appears.',
          'top',
        ),
      );
    }
    if (present('cwd-scores')) {
      steps.push(
        tip(
          'cwd-scores',
          'Scores',
          'Enter each student\u2019s score after checking their work in person. Students see their own score and comment, and are notified.',
          'top',
        ),
      );
    }
    steps.push(...specific());
    // The notes panel sits at the bottom of the page and only exists for the course's teacher.
    if (role !== 'student' && present('mp-panel')) steps.push(...notesSteps());
    return steps;
  };
}

/** "Notes to students" panel on the assignment, quiz and exam detail pages. */
function notesSteps(): DriveStep[] {
  const steps: DriveStep[] = [
    tip(
      'mp-panel',
      'Notes to students',
      'Comment on a student\u2019s work, remind them of a missed deadline, or ask for a correction. The count shows how many notes are open and how many are resolved.',
      'top',
    ),
    tip(
      'mp-write',
      'Write a note',
      'Choose what it is about (a comment, a missed deadline or a correction), pick one or more students, then write your note. Each student you choose is notified, and only they can read it. The button stays off until the item is published, because students can only be mentioned on what they can see.',
      'left',
    ),
  ];
  if (present('mp-list')) {
    steps.push(
      tip('mp-list', 'Who has seen it', 'Each note shows the student, the reason, and a badge: Not seen yet, Seen, or Resolved.', 'top'),
    );
  }
  if (present('mp-actions')) {
    steps.push(
      tip(
        'mp-actions',
        'Resolve or delete',
        'Mark resolved closes the matter, and Reopen undoes it. The bin deletes a note for good after asking you to confirm, so use it only for a note written by mistake.',
        'left',
      ),
    );
  }
  return steps;
}

export const assignmentDetailTour = itemTour('assignment', () => {
  const steps: DriveStep[] = [];
  if (present('ad-work')) {
    steps.push(
      tip(
        'ad-work',
        'Your work',
        'Hand in a file or a link. Work handed in after the due date is marked late. You can replace it until it is graded; after grading it is locked.',
        'top',
      ),
    );
  }
  if (present('ad-submissions')) {
    steps.push(
      tip(
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
      tip(
        'qd-attempt',
        'Take the quiz',
        'You can take it once. With a time limit, the timer starts when you press Start and keeps running even if you close the page. Answers save as you go. Afterwards your score and a View result button appear here.',
        'top',
      ),
    );
  }
  if (present('qd-questions')) {
    steps.push(
      tip(
        'qd-questions',
        'Questions',
        'Add questions here, then publish the quiz. Once students have taken it, the questions lock to keep results fair.',
        'top',
      ),
    );
  }
  if (present('qd-results')) {
    steps.push(tip('qd-results', 'Results', 'Who took the quiz, who did not, and the class average.', 'top'));
  }
  return steps;
});

export const examDetailTour = itemTour('exam', () => []);

/** /quiz-results/:attemptId (students see their own attempt; admins and teachers see a student's) */
export const quizResultTour: TourBuilder = () => {
  const steps: DriveStep[] = [
    tip('qr-header', 'Quiz result', 'The quiz, its course and when it was submitted. If a teacher or admin is viewing, the student\u2019s name is shown too.'),
  ];
  if (present('qr-auto')) {
    steps.push(
      tip(
        'qr-auto',
        'Submitted automatically',
        'The time limit ended, so the quiz was submitted at the deadline. Only answers saved by then were graded, and unanswered questions scored zero.',
      ),
    );
  }
  steps.push(
    tip('qr-score', 'Score', 'The percentage, the points earned out of the total, and how many questions were correct.'),
  );
  if (present('qr-first')) {
    steps.push(
      tip(
        'qr-first',
        'Each question',
        'A green check means correct and a red cross means incorrect. Each question shows its points, the answer given, and the correct answer when it was wrong.',
        'top',
      ),
    );
  }
  return steps;
};
