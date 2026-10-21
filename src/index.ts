import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './types';
import authRouter from './routes/auth';
import dashboardRouter from './routes/dashboard';
import interviewsRouter from './routes/interviews';
import publicRouter from './routes/public';

export const app = new Hono<{ Bindings: Bindings }>();

const defaultAllowedOrigins = ['http://localhost:5173', 'http://localhost:3000'];

app.use('*', async (c, next) => {
  const configured = (c.env.FRONTEND_ORIGIN ?? '').trim();
  const origins = configured ? configured.split(',').map((o) => o.trim()).filter(Boolean) : defaultAllowedOrigins;

  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin) return '*';
      return origins.includes(origin) ? origin : origins[0] ?? '*';
    },
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Length', 'X-Requested-With', 'Content-Disposition'],
    credentials: true,
    maxAge: 600,
  });

  return corsMiddleware(c, next);
});

app.onError((err, c) => {
  console.error('Unhandled application error', err);
  return c.json({ error: 'internal_server_error', message: 'Something went wrong.' }, 500);
});

app.route('/api/auth', authRouter);
app.route('/api/interviews', interviewsRouter);
app.route('/api/dashboard', dashboardRouter);
app.route('/api/public/interviews', publicRouter);
app.route('/api/submissions', dashboardRouter);

app.get('/api/health', (c) => {
  return c.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
});

export default app;
