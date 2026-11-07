import type { Request } from 'express';
import { rateLimit } from 'express-rate-limit';

/**
 * Every announcement becomes one notification per recipient, so posting is limited per signed-in
 * user (10 an hour). Reading, editing and deleting are not limited.
 */
export const announcementPostLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonymous',
  message: { error: 'You are posting announcements too fast. Please wait a while and try again.' },
});
