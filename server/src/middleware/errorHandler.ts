import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const statusCode = err instanceof ZodError ? 400 : (err.statusCode ?? 500);

  // An unexpected failure is written to the server log (Render's Logs tab) for the developer, and
  // the browser gets a plain sentence: a database or library message can reveal table and column
  // names. Expected errors (400, 401, 403, 404, 409 ...) keep their own message.
  const unexpected = statusCode >= 500;
  if (unexpected) console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  const hideDetails = unexpected && process.env.NODE_ENV !== 'development';

  const response: Record<string, unknown> = {
    error: hideDetails ? 'Something went wrong on our side. Please try again.' : err.message || 'Internal server error',
  };

  if (err instanceof ZodError) {
    response.error = 'Validation failed';
    response.details = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
  }

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
