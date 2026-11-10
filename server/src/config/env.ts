/**
 * Looks over the server's settings before it starts. A missing secret or (in production) a missing
 * CORS_ORIGIN stops the server with a plain message instead of failing later in confusing ways;
 * weaker problems are only warned about, so an existing working setup is never taken down by this.
 */
export function checkServerEnv(env: NodeJS.ProcessEnv): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const access = env.JWT_ACCESS_SECRET;
  const refresh = env.JWT_REFRESH_SECRET;
  if (!access) errors.push('JWT_ACCESS_SECRET is not set');
  if (!refresh) errors.push('JWT_REFRESH_SECRET is not set');
  if (access && refresh && access === refresh) {
    warnings.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are the same value; use two different long random values');
  }
  for (const [name, value] of [['JWT_ACCESS_SECRET', access], ['JWT_REFRESH_SECRET', refresh]] as const) {
    if (value && value.length < 32) warnings.push(`${name} is shorter than 32 characters; use a long random value`);
  }

  if (env.NODE_ENV === 'production' && !env.CORS_ORIGIN) {
    errors.push('CORS_ORIGIN is not set (in production it must be the exact address of the website, e.g. https://pbsi-platform.vercel.app)');
  }
  if (env.CORS_ORIGIN && /\/\s*$/.test(env.CORS_ORIGIN)) {
    warnings.push('CORS_ORIGIN ends with "/"; it must be the exact address with no trailing slash');
  }
  return { errors, warnings };
}

export function assertServerEnv(env: NodeJS.ProcessEnv = process.env): void {
  const { errors, warnings } = checkServerEnv(env);
  for (const warning of warnings) console.warn(`[ENV] ${warning}`);
  if (errors.length > 0) throw new Error(`The server settings are not complete:\n - ${errors.join('\n - ')}`);
}
