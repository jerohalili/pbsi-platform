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
}
