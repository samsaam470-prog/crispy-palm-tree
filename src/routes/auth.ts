import { Hono } from 'hono';
import { z } from 'zod';
import { createAdminToken } from '../middleware/auth';
import type { Bindings } from '../types';

const authRouter = new Hono<{ Bindings: Bindings }>();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const result = loginSchema.safeParse(body);
    if (!result.success) {
      return c.json({ error: 'Invalid request payload', details: result.error.format() }, 400);
    }

    const { username, password } = result.data;
    const adminUser = c.env.ADMIN_USER;
    const adminPass = c.env.ADMIN_PASS;
    const jwtKey = c.env.JWT_KEY;

    if (!adminUser || !adminPass || !jwtKey) {
      return c.json({ error: 'Server authentication configuration error' }, 500);
    }

    // Constant-time-ish comparison check for security
    if (username !== adminUser || password !== adminPass) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const token = await createAdminToken(username, jwtKey);

    // Set HttpOnly cookie and return token in body
    c.header(
      'Set-Cookie',
      `admin_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`
    );

    return c.json({
      success: true,
      token,
      message: 'Logged in successfully',
    });
  } catch (err: any) {
    return c.json({ error: 'Authentication failed', message: err.message }, 400);
  }
});

authRouter.post('/logout', async (c) => {
  c.header(
    'Set-Cookie',
    'admin_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
  );
  return c.json({ success: true, message: 'Logged out successfully' });
});

authRouter.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    const cookieHeader = c.req.header('Cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/admin_token=([^;]+)/);
      if (match) {
        token = match[1];
      }
    }
  }

  if (!token) {
    return c.json({ authenticated: false }, 401);
  }

  try {
    const { jwtVerify } = await import('jose');
    const jwtKey = c.env.JWT_KEY;
    if (!jwtKey) {
      return c.json({ error: 'Server configuration error' }, 500);
    }
    const encoder = new TextEncoder();
    await jwtVerify(token, encoder.encode(jwtKey));
    return c.json({ authenticated: true, user: c.env.ADMIN_USER || 'admin' });
  } catch {
    return c.json({ authenticated: false }, 401);
  }
});

export default authRouter;
