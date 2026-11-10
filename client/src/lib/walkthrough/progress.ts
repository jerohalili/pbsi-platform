/**
 * Remembers, per signed-in user and per browser, which pages already asked about a walkthrough.
 * Nothing is sent to the server: this is only a convenience flag kept in localStorage.
 */
export type PageAnswer = 'started' | 'skipped';

interface Progress {
  pages: Record<string, PageAnswer>;
  /** "Don't ask on other pages": the ? button still works, but no page asks by itself. */
  muted: boolean;
}

const keyFor = (userId: string) => `pbsi:walkthrough:v1:${userId}`;

function read(userId: string): Progress {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return { pages: {}, muted: false };
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      pages: parsed.pages && typeof parsed.pages === 'object' ? parsed.pages : {},
      muted: parsed.muted === true,
    };
  } catch {
    // Storage blocked or corrupt: behave as if nothing was saved.
    return { pages: {}, muted: false };
  }
}

function write(userId: string, progress: Progress): void {
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(progress));
  } catch {
    // Ignore: the prompt may show again next time, which is harmless.
  }
}

/** True when this page has never asked this user and the user has not muted all prompts. */
export function isPromptDue(userId: string, pageKey: string): boolean {
  const progress = read(userId);
  return !progress.muted && progress.pages[pageKey] === undefined;
}

export function recordAnswer(userId: string, pageKey: string, answer: PageAnswer): void {
  const progress = read(userId);
  progress.pages[pageKey] = answer;
  write(userId, progress);
}

export function muteAllPrompts(userId: string): void {
  const progress = read(userId);
  progress.muted = true;
  write(userId, progress);
}
