import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins/username';
import { D1Dialect } from 'kysely-d1';

export interface PublicEnv {
  DB: D1Database;
  AUTH_SECRET: string;
  APP_ORIGIN: string;
}

export function accountOptions(env: PublicEnv) {
  return {
    appName: 'Longview Planner',
    telemetry: { enabled: false },
    baseURL: env.APP_ORIGIN,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    database: { dialect: new D1Dialect({ database: env.DB }), type: 'sqlite' as const, transaction: false },
    trustedOrigins: [env.APP_ORIGIN],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: {
      cookiePrefix: 'longview',
      useSecureCookies: env.APP_ORIGIN.startsWith('https:'),
      defaultCookieAttributes: { sameSite: 'strict' as const, httpOnly: true },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    // The public router applies atomic D1 limits to every account endpoint.
    rateLimit: { enabled: false },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
        usernameValidator: (v: string) => /^[a-z0-9_]+$/.test(v),
      }),
    ],
  };
}

export function createAccounts(env: PublicEnv) {
  return betterAuth(accountOptions(env));
}
