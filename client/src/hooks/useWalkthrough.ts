import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import useAuth from '@/hooks/useAuth.ts';
import { findPageTour, isWalkthroughHidden } from '@/lib/walkthrough/registry.ts';
import { portalSteps } from '@/lib/walkthrough/shell.ts';
import type { PageTour, TourContext, WalkthroughRole } from '@/lib/walkthrough/types.ts';

const ROLES: WalkthroughRole[] = ['admin', 'teacher', 'student'];

export interface WalkthroughApi {
  /** The page's own tour, or undefined when the page only has the general tour. */
  pageTour: PageTour | undefined;
  hidden: boolean;
  start: () => void;
}

export function useWalkthrough(): WalkthroughApi {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const driverRef = useRef<Driver | null>(null);

  const hidden = isWalkthroughHidden(pathname);
  const role = ROLES.includes(user?.role as WalkthroughRole) ? (user?.role as WalkthroughRole) : 'student';
  const pageTour = useMemo(() => findPageTour(pathname, role), [pathname, role]);

  // Leaving the page ends its tour, so highlights never point at elements that are gone.
  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, [pathname]);

  const start = useCallback(() => {
    driverRef.current?.destroy();
    const ctx: TourContext = {
      role,
      isMobile: !window.matchMedia('(min-width: 768px)').matches,
    };
    // A page tour that finds nothing to show falls back to the general tour instead of an empty one.
    const built = pageTour ? pageTour.build(ctx) : [];
    const steps = built.length > 0 ? built : portalSteps(ctx);
    const tour = driver({
      steps,
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      popoverClass: 'pbsi-tour',
      allowClose: true,
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 8,
      // Data may still be loading; wait briefly for a target before showing the centered tip.
      waitForElement: 1200,
      onDestroyed: () => {
        if (driverRef.current === tour) driverRef.current = null;
      },
    });
    driverRef.current = tour;
    tour.drive();
  }, [pageTour, role]);

  return { pageTour, hidden, start };
}
