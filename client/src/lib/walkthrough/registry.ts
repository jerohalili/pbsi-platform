import { matchPath } from 'react-router-dom';
import type { PageTour } from './types.ts';
import { dashboardTour } from './dashboard.ts';

/** One entry per page that has its own walkthrough. Add new pages here. */
export const PAGE_TOURS: PageTour[] = [
  { key: 'dashboard', pattern: '/dashboard', build: dashboardTour },
];

/** Pages where the ? button must not appear (a timed quiz should never be interrupted). */
const HIDDEN_PATTERNS = ['/quizzes/:id/take'];

export function findPageTour(pathname: string): PageTour | undefined {
  return PAGE_TOURS.find((t) => matchPath({ path: t.pattern, end: true }, pathname));
}

export function isWalkthroughHidden(pathname: string): boolean {
  return HIDDEN_PATTERNS.some((p) => matchPath({ path: p, end: true }, pathname));
}
