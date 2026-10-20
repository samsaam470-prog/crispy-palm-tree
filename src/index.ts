import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './types';
import authRouter from './routes/auth';
import interviewsRouter from './routes/interviews';
import publicRouter from './routes/public';
import dashboardRouter from './routes/dashboard';

const app = new Hono<{ Bindings: Bindings }>();

// Global CORS middleware
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Length', 'X-Requested-With'],
  maxAge: 600,
}));

// Global error handler
app.onError((err, c) => {
  console.error('Unhandled application error:', err);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

// Mount route modules
app.route('/api/auth', authRouter);
app.route('/api/interviews', interviewsRouter);
app.route('/api/public/interviews', publicRouter);
app.route('/api/dashboard', dashboardRouter);
app.route('/api/submissions', dashboardRouter); // For /api/submissions/recent and details

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
