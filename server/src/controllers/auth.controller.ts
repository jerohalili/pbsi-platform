import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { loginSchema } from '../utils/validation.js';
import { isTokenRevoked } from '../utils/sessions.js';
import { recordAudit, recordAuditThrottled } from '../utils/audit.js';
import type { AppError } from '../middleware/errorHandler.js';

const COOKIE_OPTIONS: Record<string, unknown> = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// Checked against when the email is unknown, so a miss costs as much as a wrong password. Without
// it the faster answer would tell an attacker which emails have an account (a timing side channel).
const DUMMY_PASSWORD_HASH = hashPassword('this-is-not-a-real-password');

// At most one failed-login audit row per account per action in this window.
const FAILED_LOGIN_AUDIT_WINDOW_MINUTES = 5;

export async function login(req: Request, res: Response): Promise<void> {
  // The validation middleware only checks the body; parsing here gives the trimmed, lower-cased email.
  const { email, password } = loginSchema.parse(req.body);

  const [user] = await sql`
    SELECT id, email, password_hash, role, is_active
    FROM users WHERE lower(email) = lower(${email})
  `;

  const passwordMatches = await comparePassword(password, user ? user.password_hash : await DUMMY_PASSWORD_HASH);
  if (!user || !passwordMatches) {
    // Only existing accounts are audited: an unknown email is never stored, so an attacker cannot
    // flood the table with made-up addresses. The typed email and password are never recorded.
    if (user) {
      await recordAuditThrottled(req, user.id, 'login_failed', 'user', user.id, null, FAILED_LOGIN_AUDIT_WINDOW_MINUTES);
    }
    const err = new Error('Invalid email or password') as AppError;
    err.statusCode = 401;
    throw err;
  }

  if (!user.is_active) {
    // The password was right but the account is switched off.
    await recordAuditThrottled(req, user.id, 'login_blocked_inactive', 'user', user.id, null, FAILED_LOGIN_AUDIT_WINDOW_MINUTES);
    const err = new Error('Account is deactivated') as AppError;
    err.statusCode = 403;
    throw err;
  }

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });
  const refreshToken = signRefreshToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  res.cookie('access_token', accessToken, COOKIE_OPTIONS);
  res.cookie('refresh_token', refreshToken, COOKIE_OPTIONS);

  await recordAudit(req, 'login', 'user', user.id, null, { role: user.role }, user.id);

  res.json({
    user: { id: user.id, email: user.email, role: user.role },
    access_token: accessToken,
  });
}

const CLEAR_COOKIE_OPTIONS: Record<string, unknown> = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
};

export async function logout(_req: Request, res: Response): Promise<void> {
  res.clearCookie('access_token', CLEAR_COOKIE_OPTIONS);
  res.clearCookie('refresh_token', CLEAR_COOKIE_OPTIONS);
  res.json({ message: 'Logged out successfully' });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.refresh_token;
  if (!token) {
    const err = new Error('No refresh token') as AppError;
    err.statusCode = 401;
    throw err;
  }

  try {
    const decoded = verifyRefreshToken(token);
    const [account] = await sql`
      SELECT is_active, tokens_valid_after FROM users WHERE id = ${decoded.sub}
    `;
    if (!account || !account.is_active) {
      throw new Error('Account is not active');
    }
    if (isTokenRevoked(decoded.iat, account.tokens_valid_after)) {
      throw new Error('Session has ended');
    }
    const accessToken = signAccessToken({
      sub: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    });
    res.cookie('access_token', accessToken, COOKIE_OPTIONS);
    res.json({ access_token: accessToken });
  } catch {
    const err = new Error('Invalid or expired refresh token') as AppError;
    err.statusCode = 401;
    throw err;
  }
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    const err = new Error('Not authenticated') as AppError;
    err.statusCode = 401;
    throw err;
  }

  const [account] = await sql`
    SELECT is_active FROM users WHERE id = ${user.id}
  `;
  if (!account || !account.is_active) {
    const err = new Error('Account is not active') as AppError;
    err.statusCode = 401;
    throw err;
  }

  const [profile] = await sql`
    SELECT first_name, last_name, phone, date_of_birth, gender, address, avatar_url
    FROM profiles WHERE user_id = ${user.id}
  `;

  res.json({
    user: { ...user, ...profile },
  });
}
