import type { InternalAxiosRequestConfig } from 'axios';

/**
 * Knows whether the server is reachable, so the app can say "waking up" instead of leaving a blank
 * or broken page.
 *
 * The free hosting puts the server to sleep after a period of inactivity. The first request then
 * either hangs for up to a minute while it starts, or is answered by the host's gateway with a
 * 502/503/504 (which the browser may report as a plain network error). Both look like "the server is
 * not there yet", and both are temporary. Anything else (a 401, a 404, a 500) means the server is
 * awake and answering, so it never triggers this.
 *
 * While the server is not reachable the store polls its health check, and goes back to "ok" as soon
 * as it answers.
 */
export type ServerStatus = 'ok' | 'waking' | 'offline';

export interface ServerState {
  status: ServerStatus;
  /** When the current trouble started (null when everything is fine). */
  since: number | null;
}

/** A request still waiting after this long means the server is probably starting up. */
export const SLOW_REQUEST_MS = 6000;
const POLL_EVERY_MS = 3000;
/** One health check may hang while the server starts; give it generous time before trying again. */
const HEALTH_TIMEOUT_MS = 25000;

let state: ServerState = { status: 'ok', since: null };
const listeners = new Set<() => void>();
let healthUrl = '/api/health';

export function configureServerStatus(options: { healthUrl: string }): void {
  healthUrl = options.healthUrl;
}

/** The same object until something changes (what useSyncExternalStore needs). */
export const getServerState = (): ServerState => state;

export function subscribeServerState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStatus(status: ServerStatus): void {
  if (state.status === status) return;
  // Moving between "waking" and "offline" keeps the original start time: it is one stretch of trouble.
  const since = status === 'ok' ? null : (state.since ?? Date.now());
  state = { status, since };
  listeners.forEach((listener) => listener());
}

// ---- Watching requests ---------------------------------------------------------------------------

interface Pending {
  started: number;
  /** A health check has shown the server is up, so this request is just slow (a big export). */
  vouched: boolean;
}

const pending = new Map<string, Pending>();
let counter = 0;
let watcher: ReturnType<typeof setInterval> | null = null;
const TRACK_KEY = '__serverStatusId';
type Tracked = InternalAxiosRequestConfig & { [TRACK_KEY]?: string };

/** An upload can legitimately take long, so it is not judged by how long it takes. */
const isUpload = (config: InternalAxiosRequestConfig): boolean =>
  typeof FormData !== 'undefined' && config.data instanceof FormData;

export function noteRequestStart(config: InternalAxiosRequestConfig): void {
  if (isUpload(config)) return;
  const id = String(++counter);
  (config as Tracked)[TRACK_KEY] = id;
  pending.set(id, { started: Date.now(), vouched: false });
  if (!watcher) watcher = setInterval(checkForSlowRequests, 1000);
}

/**
 * Called when a request finished, with the HTTP status (undefined when no answer came at all).
 * `cancelled` requests say nothing about the server.
 */
export function noteRequestEnd(
  config: InternalAxiosRequestConfig | undefined,
  status: number | undefined,
  cancelled = false,
): void {
  const id = config ? (config as Tracked)[TRACK_KEY] : undefined;
  if (config && id) {
    pending.delete(id);
    (config as Tracked)[TRACK_KEY] = undefined;
  }
  if (pending.size === 0 && watcher) {
    clearInterval(watcher);
    watcher = null;
  }
  if (cancelled) return;
  if (status === undefined || status === 502 || status === 503 || status === 504) markUnreachable();
  else markReachable();
}

function checkForSlowRequests(): void {
  const now = Date.now();
  for (const request of pending.values()) {
    if (!request.vouched && now - request.started > SLOW_REQUEST_MS) {
      markUnreachable();
      return;
    }
  }
}

function markReachable(): void {
  setStatus('ok');
}

function markUnreachable(): void {
  setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'waking');
  void startPolling();
}

// ---- Asking the server whether it is awake ---------------------------------------------------------

let polling = false;
let wakeUp: (() => void) | null = null;

async function pingHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(healthUrl, { cache: 'no-store', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function startPolling(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    while (state.status !== 'ok') {
      if (await pingHealth()) {
        // The server answers, so whatever is still waiting is merely slow, not a sleeping server.
        pending.forEach((request) => {
          request.vouched = true;
        });
        setStatus('ok');
        break;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, POLL_EVERY_MS);
        wakeUp = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wakeUp = null;
    }
  } finally {
    polling = false;
  }
}

/** "Check again now": skips the wait before the next health check. */
export function retryNow(): void {
  if (polling) wakeUp?.();
  else void startPolling();
}

// ---- The device itself losing or regaining its connection ------------------------------------------

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    setStatus('offline');
    void startPolling();
  });
  // Back online: the status stays until the server actually answers, so there is no flicker.
  window.addEventListener('online', () => retryNow());
  if (navigator.onLine === false) {
    setStatus('offline');
    void startPolling();
  }
}
