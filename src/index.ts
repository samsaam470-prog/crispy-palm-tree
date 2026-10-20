import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './types';
import authRouter from './routes/auth';
import interviewsRouter from './routes/interviews';
import publicRouter from './routes/public';
import dashboardRouter from './routes/dashboard';

const app = new Hono<{ Bindings: Bindings }>();

// Configurable CORS based on environment or default secure fallback
app.use('*', async (c, next) => {
  const frontendOrigin = c.env.FRONTEND_ORIGIN || '*';
  const corsMiddleware = cors({
    origin: frontendOrigin,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Length', 'X-Requested-With', 'Content-Disposition'],
    credentials: true,
    maxAge: 600,
  });
  return corsMiddleware(c, next);
});

// Global error handler preventing stack trace exposure
app.onError((err, c) => {
  console.error('Unhandled application error:', err);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

// Mount routes
app.route('/api/auth', authRouter);
app.route('/api/interviews', interviewsRouter);
app.route('/api/public/interviews', publicRouter);
app.route('/api/dashboard', dashboardRouter);
app.route('/api/submissions', dashboardRouter);

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
