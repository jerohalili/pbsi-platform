import type { DriveStep } from 'driver.js';
import type { TourBuilder, WalkthroughRole } from './types.ts';
import { navigationStep, present, sel } from './shell.ts';

const STAT_TEXT: Record<WalkthroughRole, string> = {
  admin:
    'School-wide numbers: students, courses, today\u2019s attendance and submissions still waiting for a score.',
  teacher:
    'Your numbers: your courses, your students, today\u2019s attendance and submissions waiting for your score.',
  student:
    'Your numbers: average grade, attendance, how many items were graded and unread notifications.',
};

type Side = 'top' | 'bottom';

function step(name: string, title: string, description: string, side: Side = 'top'): DriveStep {
  return { element: sel(name), popover: { title, description, side, align: 'center' } };
}

const statsStep = (role: WalkthroughRole): DriveStep => step('dash-stats', 'Quick numbers', STAT_TEXT[role], 'bottom');

const announcementsStep = (canPost: boolean): DriveStep =>
  step(
    'dash-announcements',
    'Announcements',
    canPost
      ? 'School news appears here, urgent items first. \u201cManage\u201d opens the page where you post announcements.'
      : 'School news appears here, urgent items first. Urgent ones also show as a banner at the top of every page.',
  );

const activityStep = (): DriveStep =>
  step('dash-activity', 'Recent activity', 'Your latest notifications appear here. \u201cView all\u201d opens the full list.');

function studentSteps(): DriveStep[] {
  const steps: DriveStep[] = [statsStep('student')];
  // This card only exists when a teacher left a note, so explain it only when it is on screen.
  if (present('dash-attention')) {
    steps.push(
      step(
        'dash-attention',
        'Needs your attention',
        'Notes from teachers about a comment, a missed deadline or a correction. Open one to fix it quickly.',
        'bottom',
      ),
    );
  }
  steps.push(
    announcementsStep(false),
    step('dash-today', 'Today', 'Your classes for today with start and end times. A badge shows if you were marked present, late, absent or excused.'),
    step('dash-todo', 'To-do', 'What to do next: assignments to hand in, in-person items and exams, and online quizzes. Click a row to open it.'),
    step('dash-courses', 'My courses', 'Your enrolled courses. A red \u201cnew\u201d badge means there are unread updates in that course.'),
    step('dash-grades', 'Recent grades', 'Your latest scores with any feedback. Green means you passed. \u201cView all\u201d opens every grade.'),
    step('dash-discussions', 'Discussion highlights', 'New posts and replies from your course discussions, so you can jump back in.'),
    activityStep(),
  );
  return steps;
}

function teacherSteps(): DriveStep[] {
  return [
    statsStep('teacher'),
    step('dash-pending', 'Pending scores', 'Work waiting for your score: assignments, quizzes and exams, oldest first. Click a row to start grading.', 'bottom'),
    step('dash-today', 'Today', 'Your classes today. Click one to take attendance; the badge shows whether it was already marked.', 'bottom'),
    announcementsStep(true),
    step('dash-notes', 'Open notes', 'Notes you left for students about a comment, a missed deadline or a correction. \u201cSeen\u201d shows who has read them.'),
    step('dash-drafts', 'Drafts to publish', 'Coursework you created but have not published yet. Students cannot see a draft until you publish it.'),
    step('dash-courses', 'My courses', 'Your courses with their student counts. Click one to open it.'),
    step('dash-student-activity', 'Student activity', 'What students did lately: hand-ins, quiz attempts and discussion posts. Click a row to open it.'),
    activityStep(),
  ];
}

function adminSteps(): DriveStep[] {
  return [
    statsStep('admin'),
    step('dash-alerts', 'Needs attention', 'Set-up problems to fix, grouped by type, such as a course with no timetable entry. It says \u201cEverything is set up\u201d when there is nothing to fix.', 'bottom'),
    step('dash-glance', 'The school at a glance', 'Active students, teachers and courses, plus a 7-day chart of recorded events, sign-ins and failed sign-ins.', 'bottom'),
    step('dash-year', 'School year', 'Totals for the current school year. Philippine school years start in June.', 'bottom'),
    announcementsStep(true),
    step('dash-changes', 'Recent changes', 'The latest audit events in plain English. \u201cView all\u201d opens the Audit Logs page.'),
    activityStep(),
  ];
}

export const dashboardTour: TourBuilder = (ctx) => {
  const pageSteps = ctx.role === 'admin' ? adminSteps() : ctx.role === 'teacher' ? teacherSteps() : studentSteps();
  // The dashboard is the home page, so it is where the shared menu is explained once.
  return [...pageSteps, navigationStep(ctx)];
};
