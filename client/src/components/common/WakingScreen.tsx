import { GraduationCap, WifiOff } from 'lucide-react';

interface WakingScreenProps {
  /** "waking": the server is starting up. "offline": this device has no connection. */
  variant?: 'waking' | 'offline';
  /** Cover whatever page is open (true), or be a page of its own (false). */
  overlay?: boolean;
  /** Seconds since the trouble began; shown once it is long enough to be worth saying. */
  elapsedSeconds?: number;
  onRetry?: () => void;
}

const formatWait = (seconds: number): string =>
  seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;

/**
 * "PBSI is waking up": shown whenever the server cannot answer yet. The free hosting lets it sleep
 * after a period of inactivity and it takes up to about a minute to start again. Used on the home
 * page while the app starts, and as an overlay on any page when the server stops answering.
 */
export function WakingScreen({ variant = 'waking', overlay = false, elapsedSeconds }: WakingScreenProps) {
  const offline = variant === 'offline';
  const seconds = elapsedSeconds ?? 0;

  const container = overlay
    ? 'fixed inset-0 z-[90] bg-site-bg/95 backdrop-blur-sm flex items-center justify-center px-4'
    : 'min-h-screen w-full bg-site-bg flex items-center justify-center px-4';

  return (
    <div
      className={container}
      role={overlay ? 'alertdialog' : 'status'}
      aria-modal={overlay ? true : undefined}
      aria-labelledby="waking-title"
      aria-describedby="waking-text"
    >
      <div className="flex flex-col items-center gap-6 text-center max-w-md">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 border-4 border-primary/10 rounded-full"></div>
          {!offline && <div className="absolute inset-0 border-4 border-t-primary rounded-full animate-spin"></div>}
          <div className="absolute inset-0 flex items-center justify-center">
            {offline ? <WifiOff className="w-8 h-8 text-primary" /> : <GraduationCap className="w-8 h-8 text-primary" />}
          </div>
        </div>

        <h2 id="waking-title" className="text-xl font-bold text-site-text">
          {offline ? 'You’re offline' : 'PBSI is waking up'}
        </h2>
        <p id="waking-text" className="text-site-muted text-sm">
          {offline
            ? 'Check your internet connection. This page continues by itself as soon as you’re back online.'
            : 'Our school management system was resting after a period of inactivity and is starting up again. This usually takes under a minute, and this page continues by itself.'}
        </p>

        <p className="text-site-muted text-xs" aria-hidden="true">
          Waiting {formatWait(seconds)}
        </p>
      </div>
    </div>
  );
}
