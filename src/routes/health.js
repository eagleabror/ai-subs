import { Router } from 'express';
export function healthRouter(getReadiness) {
  const router = Router();
  router.get('/health', (_req, res) => {
    const { database, bot } = getReadiness();
    const ready = database && bot;
    res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'not_ready',
      database: database ? 'connected' : 'unavailable',
      bot: bot ? 'initialized' : 'unavailable',
      autoPurchaseEnabled: false,
    });
  });
  return router;
}
