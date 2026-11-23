import express from 'express';
import { healthRouter } from './routes/health.js';
export function createApp({ getReadiness = () => ({ database: false, bot: false }) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(healthRouter(getReadiness));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}
