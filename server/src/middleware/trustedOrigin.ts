import { Request, Response, NextFunction } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The one website allowed to call this API (the same value CORS uses), without a trailing slash. */
function trustedOrigins(): string[] {
  return (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * CSRF defense for cookie sessions. The refresh cookie is SameSite=None (the site and the API live on
 * different domains), so the browser also sends it with requests made by OTHER websites. Browsers
 * always say which site a state-changing request comes from in the Origin header, and a page cannot
 * forge it, so anything that is not our own site is refused.
 *
 * Reads (GET/HEAD/OPTIONS) change nothing and are not checked. A request with no Origin header at
 * all did not come from a web page's script (curl, a server-to-server call), so it cannot be the
 * cross-site forgery this guards against.
 */
export function requireTrustedOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  if (trustedOrigins().includes(origin.replace(/\/+$/, ''))) return next();

  console.warn(`[security] refused ${req.method} ${req.originalUrl} from untrusted origin ${origin}`);
  res.status(403).json({ error: 'Request blocked: it did not come from this app.' });
}
