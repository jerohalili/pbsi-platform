import jwt, { SignOptions, Secret } from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET as Secret;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as Secret;

export function signAccessToken(payload: object): string {
  return jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN as string) ?? '15m',
  } as SignOptions);
}

export function signRefreshToken(payload: object): string {
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN as string) ?? '7d',
  } as SignOptions);
}

export function verifyAccessToken(token: string): any {
  return jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
}

export function verifyRefreshToken(token: string): any {
  return jwt.verify(token, REFRESH_SECRET, { algorithms: ['HS256'] });
}
