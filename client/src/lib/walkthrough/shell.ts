import type { DriveStep } from 'driver.js';
import type { TourContext } from './types.ts';

/** Steps for the parts of the screen every page shares. All use data-tour attributes. */
export const sel = (name: string) => `[data-tour="${name}"]`;

export function navigationStep({ isMobile }: TourContext): DriveStep {
  return isMobile
    ? {
        element: sel('mobile-menu'),
        popover: {
          title: 'Menu',
          description: 'Tap here to open the menu and jump to any page. Your role decides which pages you see.',
          side: 'bottom',
          align: 'start',
        },
      }
    : {
        element: sel('sidebar-nav'),
        popover: {
          title: 'Navigation',
          description:
            'Every page lives here. Your role decides which ones you see, so you never have to dig through options you cannot use.',
          side: 'right',
          align: 'start',
        },
      };
}

export function notificationsStep({ isMobile }: TourContext): DriveStep[] {
  if (isMobile) return [];
  return [
    {
      element: sel('nav-notifications'),
      popover: {
        title: 'Notifications',
        description: 'A red badge means something new happened, like a grade, an announcement or a mention.',
        side: 'right',
        align: 'center',
      },
    },
  ];
}

export function profileStep({ isMobile }: TourContext): DriveStep[] {
  if (isMobile) return [];
  return [
    {
      element: sel('sidebar-profile'),
      popover: {
        title: 'Your profile',
        description: 'Click your picture to open Settings. Sign out is right below it.',
        side: 'right',
        align: 'end',
      },
    },
  ];
}

export function helpStep(): DriveStep {
  return {
    element: sel('help-button'),
    popover: {
      title: 'Need this again?',
      description: 'Press the ? button on any page to replay that page\u2019s walkthrough.',
      side: 'bottom',
      align: 'end',
    },
  };
}

/** Used on any page that has no walkthrough of its own yet. */
export function portalSteps(ctx: TourContext): DriveStep[] {
  return [navigationStep(ctx), ...notificationsStep(ctx), ...profileStep(ctx), helpStep()];
}
