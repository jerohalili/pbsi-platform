import { useEffect, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useWalkthrough } from '@/hooks/useWalkthrough.ts';
import { isPromptDue, muteAllPrompts, recordAnswer } from '@/lib/walkthrough/progress.ts';

/** Delay so the page can draw before we ask; asking at once feels like an interruption. */
const PROMPT_DELAY_MS = 900;

/** The "?" help icon for the top bar, plus the one-time "start or skip?" question for a page. */
export default function WalkthroughButton() {
  const { user } = useAuth();
  const { pageTour, hidden, start } = useWalkthrough();
  const [promptOpen, setPromptOpen] = useState(false);
  const userId = user?.id;
  const pageKey = pageTour?.key;

  useEffect(() => {
    setPromptOpen(false);
    if (!userId || !pageKey || hidden) return;
    if (!isPromptDue(userId, pageKey)) return;
    const timer = window.setTimeout(() => setPromptOpen(true), PROMPT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [userId, pageKey, hidden]);

  useEffect(() => {
    if (!promptOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && userId && pageKey) {
        recordAnswer(userId, pageKey, 'skipped');
        setPromptOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [promptOpen, userId, pageKey]);

  if (hidden) return null;

  const answer = (choice: 'started' | 'skipped') => {
    if (userId && pageKey) recordAnswer(userId, pageKey, choice);
    setPromptOpen(false);
    if (choice === 'started') start();
  };

  const skipEverywhere = () => {
    if (userId && pageKey) recordAnswer(userId, pageKey, 'skipped');
    if (userId) muteAllPrompts(userId);
    setPromptOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        data-tour="help-button"
        aria-label="Start page walkthrough"
        title="Page walkthrough"
        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleHelp className="h-5 w-5" />
      </button>

      {promptOpen && (
        <div
          role="dialog"
          aria-label="Page walkthrough"
          className="fixed right-3 top-[4.5rem] z-[60] w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-input bg-card p-4 text-card-foreground shadow-lg"
        >
          <p className="text-sm font-semibold">Want a quick tour of this page?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It takes about a minute. You can replay it any time with the ? button.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => answer('started')}
              className="min-h-10 flex-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Start walkthrough
            </button>
            <button
              type="button"
              onClick={() => answer('skipped')}
              className="min-h-10 rounded-md border border-input px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Skip
            </button>
          </div>
          <button
            type="button"
            onClick={skipEverywhere}
            className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Don&rsquo;t ask me on other pages
          </button>
        </div>
      )}
    </>
  );
}
