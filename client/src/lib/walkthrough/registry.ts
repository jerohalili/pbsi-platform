import { matchPath } from 'react-router-dom';
import type { PageTour, WalkthroughRole } from './types.ts';
import { dashboardTour } from './dashboard.ts';
import { courseDetailTour, coursesTour, moduleEditTour } from './courses.ts';
import { announcementsTour, auditLogsTour, studentDetailTour, studentsTour, usersTour } from './admin.ts';
import { discussionsTour, discussionThreadTour, notificationsTour, settingsTour } from './community.ts';
import { attendanceTour, gradesTour, timetableTour } from './records.ts';
import { assignmentDetailTour, courseworkTour, examDetailTour, quizDetailTour, quizResultTour } from './coursework.ts';

/** One entry per page that has its own walkthrough. Add new pages here. */
export const PAGE_TOURS: PageTour[] = [
  { key: 'dashboard', pattern: '/dashboard', build: dashboardTour },
  { key: 'courses', pattern: '/courses', build: coursesTour },
  { key: 'course-detail', pattern: '/courses/:id', build: courseDetailTour },
  { key: 'coursework', pattern: '/coursework', build: courseworkTour },
  { key: 'assignment-detail', pattern: '/assignments/:id', build: assignmentDetailTour },
  { key: 'quiz-detail', pattern: '/quizzes/:id', build: quizDetailTour },
  { key: 'exam-detail', pattern: '/exams/:id', build: examDetailTour },
  { key: 'grades', pattern: '/grades', build: gradesTour },
  { key: 'attendance', pattern: '/attendance', build: attendanceTour },
  { key: 'timetable', pattern: '/timetable', build: timetableTour },
  { key: 'discussions', pattern: '/discussions', build: discussionsTour },
  { key: 'discussion-thread', pattern: '/discussions/:id', build: discussionThreadTour },
  { key: 'notifications', pattern: '/notifications', build: notificationsTour },
  { key: 'settings', pattern: '/settings', build: settingsTour },
  { key: 'users', pattern: '/users', build: usersTour, roles: ['admin'] },
  { key: 'students', pattern: '/students', build: studentsTour, roles: ['admin', 'teacher'] },
  { key: 'student-detail', pattern: '/students/:id', build: studentDetailTour, roles: ['admin', 'teacher'] },
  { key: 'announcements', pattern: '/announcements', build: announcementsTour, roles: ['admin', 'teacher'] },
  { key: 'audit-logs', pattern: '/audit-logs', build: auditLogsTour, roles: ['admin'] },
  { key: 'quiz-result', pattern: '/quiz-results/:attemptId', build: quizResultTour },
  { key: 'module-edit', pattern: '/courses/:courseId/modules/:moduleId/edit', build: moduleEditTour, roles: ['admin', 'teacher'] },
];

/** Pages where the ? button must not appear (a timed quiz should never be interrupted). */
const HIDDEN_PATTERNS = ['/quizzes/:id/take'];

export function findPageTour(pathname: string, role?: WalkthroughRole): PageTour | undefined {
  return PAGE_TOURS.find(
    (t) => matchPath({ path: t.pattern, end: true }, pathname) && (!t.roles || (role !== undefined && t.roles.includes(role))),
  );
}

export function isWalkthroughHidden(pathname: string): boolean {
  return HIDDEN_PATTERNS.some((p) => matchPath({ path: p, end: true }, pathname));
}
