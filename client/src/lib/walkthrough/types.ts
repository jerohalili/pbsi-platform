import type { DriveStep } from 'driver.js';

export type WalkthroughRole = 'admin' | 'teacher' | 'student';

export interface TourContext {
  role: WalkthroughRole;
  /** True below the md breakpoint, where the sidebar is a slide-in drawer. */
  isMobile: boolean;
}

export type TourBuilder = (ctx: TourContext) => DriveStep[];

export interface PageTour {
  /** Stable id used to remember that the page already asked. Never rename once shipped. */
  key: string;
  /** react-router path pattern, e.g. '/courses/:id'. */
  pattern: string;
  build: TourBuilder;
  /** Roles that can use this page. When set, other roles get the general tour and no prompt. */
  roles?: WalkthroughRole[];
}
