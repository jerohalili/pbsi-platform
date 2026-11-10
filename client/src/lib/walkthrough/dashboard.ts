import type { DriveStep } from 'driver.js';
import type { TourBuilder, WalkthroughRole } from './types.ts';
import { helpStep, navigationStep, notificationsStep, sel } from './shell.ts';

const STAT_TEXT: Record<WalkthroughRole, string> = {
  admin:
    'School-wide numbers: students, courses, today\u2019s attendance and submissions still waiting for a score.',
  teacher:
    'Your numbers: your courses, your students, today\u2019s attendance and submissions waiting for your score.',
  student:
    'Your numbers: average grade, attendance, how many items were graded and unread notifications.',
};

export const dashboardTour: TourBuilder = (ctx) => {
  const steps: DriveStep[] = [
    {
      element: sel('dash-header'),
      popover: {
        title: 'Your dashboard',
        description: 'This is your home screen. It opens first after you sign in and shows what needs attention today.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: sel('dash-stats'),
      popover: {
        title: 'Quick numbers',
        description: STAT_TEXT[ctx.role],
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: sel('dash-activity'),
      popover: {
        title: 'Recent activity',
        description: 'Your latest notifications appear here. \u201cView all\u201d opens the full list.',
        side: 'top',
        align: 'center',
      },
    },
    navigationStep(ctx),
    ...notificationsStep(ctx),
    helpStep(),
  ];
  return steps;
};
