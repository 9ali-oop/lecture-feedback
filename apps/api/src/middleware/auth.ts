import type { Context, Next } from 'hono';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import type { Role } from '@lecture-feedback/shared';

declare module 'hono' {
  interface ContextVariableMap {
    jwtPayload: JwtPayload;
  }
}

export function requireAuth(...allowedRoles: Role[]) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    let token: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else {
      // Fallback: accept token as query param (for img/resource requests)
      token = c.req.query('token') ?? undefined;
    }

    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    try {
      const payload = await verifyToken(token);
      if (allowedRoles.length > 0 && !allowedRoles.includes(payload.role)) {
        return c.json({ error: 'Forbidden' }, 403);
      }
      c.set('jwtPayload', payload);
      await next();
    } catch {
      return c.json({ error: 'Invalid token' }, 401);
    }
  };
}
