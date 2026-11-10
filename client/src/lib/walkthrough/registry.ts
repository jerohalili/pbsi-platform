import { matchPath } from 'react-router-dom';
import type { PageTour, WalkthroughRole } from './types.ts';
import { dashboardTour } from './dashboard.ts';
import { courseDetailTour, coursesTour, moduleEditTour } from './courses.ts';

/** One entry per page that has its own walkthrough. Add new pages here. */
export const PAGE_TOURS: PageTour[] = [
  { key: 'dashboard', pattern: '/dashboard', build: dashboardTour },
  { key: 'courses', pattern: '/courses', build: coursesTour },
  { key: 'course-detail', pattern: '/courses/:id', build: courseDetailTour },
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
