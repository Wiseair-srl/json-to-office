import { Hono } from 'hono';
import { config } from '../config/index.js';
import { getContainer } from '../container/index.js';
import { AppEnv } from '../types/hono.js';

export const healthRouter = new Hono<AppEnv>();

healthRouter.get('/', (c) => {
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();

  let cacheStats: any;
  try {
    const cacheService = getContainer().get('cacheService');
    cacheStats = cacheService.getStats();
  } catch {
    cacheStats = { enabled: false, hits: 0, misses: 0, hitRate: 0, evictions: 0, size: 0, itemCount: 0 };
  }

  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV,
    version: '1.0.0',
    framework: 'Hono',
    uptime: Math.floor(uptime),
    memory: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
    },
    cache: {
      enabled: cacheStats.enabled,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: `${(cacheStats.hitRate * 100).toFixed(1)}%`,
      itemCount: cacheStats.itemCount,
    },
  });
});

healthRouter.get('/ready', (c) => c.json({ status: 'ready' }));
healthRouter.get('/live', (c) => c.json({ status: 'alive' }));
