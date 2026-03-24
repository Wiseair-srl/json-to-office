import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { compress } from 'hono/compress';
import { createAPIApp } from './app.js';
import type { Config } from '../config/schema.js';
import type { FormatAdapter } from '../format-adapter.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger as serverLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class UnifiedServer {
  private app: Hono;
  private config: Config;
  private adapter: FormatAdapter;
  private server: ReturnType<typeof serve> | null = null;
  private viteServer: any | null = null;

  constructor(adapter: FormatAdapter, config: Config) {
    this.adapter = adapter;
    this.config = config;
    this.app = new Hono();
  }

  async initialize() {
    await this.setupMiddleware();
    await this.setupRoutes();
  }

  private async setupMiddleware() {
    this.app.use('*', logger());
    this.app.use('*', compress());
  }

  private async setupRoutes() {
    // Health check (fast path)
    this.app.get('/health', (c) =>
      c.json({
        status: 'ok',
        timestamp: Date.now(),
        version: '1.0.0',
        mode: this.config.mode,
        format: this.adapter.name,
      })
    );

    // Mount API routes FIRST
    const apiApp = createAPIApp(this.adapter);

    this.app.get('/api', async (c) => {
      return await apiApp.fetch(c.req.raw);
    });

    this.app.use('*', async (c, next) => {
      const path = c.req.path;

      if (path.startsWith('/api')) {
        // Allow Vite module requests to fall through
        if (/\.(ts|tsx|js|jsx|css|map)$/.test(path)) {
          return next();
        }
        const response = await apiApp.fetch(c.req.raw);
        if (response.status !== 404) {
          return response;
        }
      }

      return next();
    });

    // Client serving
    if (this.config.mode === 'development') {
      await this.setupDevClient();
    } else {
      await this.setupProdClient();
    }
  }

  private async setupDevClient() {
    const { existsSync } = await import('fs');
    const format = this.adapter.name.replace(/[^a-zA-Z0-9]/g, '');

    const formatPlugin = {
      name: 'jto-format-inject',
      transformIndexHtml(html: string) {
        return html.replace(
          '</head>',
          `<script>window.__JTO_FORMAT__ = '${format}';</script>\n</head>`
        );
      },
    };

    const isBundled =
      __filename.endsWith('.cjs') ||
      __filename.endsWith('.mjs') ||
      __dirname.includes('node_modules') ||
      __dirname.endsWith('dist');

    let clientPath: string | null = null;

    // Check env var
    if (process.env.JTO_CLIENT_PATH) {
      const envClientPath = process.env.JTO_CLIENT_PATH;
      if (existsSync(envClientPath) && existsSync(resolve(envClientPath, 'index.html'))) {
        clientPath = envClientPath;
        serverLogger.debug('[Dev Server] Using client from JTO_CLIENT_PATH', { path: clientPath });
      }
    } else if (isBundled) {
      const bundledClientPath = resolve(__dirname, 'client');
      if (existsSync(bundledClientPath) && existsSync(resolve(bundledClientPath, 'index.html'))) {
        clientPath = bundledClientPath;
        serverLogger.debug('[Dev Server] Using bundled client at', { path: clientPath });
      }
    } else {
      const possiblePaths = [
        resolve(__dirname, '../client'),
        resolve(__dirname, '../../dist/client'),
      ];

      for (const p of possiblePaths) {
        if (existsSync(p)) {
          if (p.replace(/\\/g, '/').includes('/src/client')) {
            serverLogger.debug('[Dev Server] Using Vite dev server for', { path: p });
            try {
              const { createServer: createViteServer } = await import('vite');
              this.viteServer = await createViteServer({
                root: p,
                plugins: [formatPlugin],
                server: {
                  middlewareMode: true,
                  hmr: { port: this.config.development.hmrPort || 5173 },
                },
              });
            } catch (err) {
              serverLogger.warn('[Dev Server] Vite not available for dev mode');
            }
            break;
          } else if (existsSync(resolve(p, 'index.html'))) {
            clientPath = p;
            serverLogger.debug('[Dev Server] Using pre-built client at', { path: clientPath });
            break;
          }
        }
      }
    }

    if (clientPath) {
      return this.setupBuiltClient(clientPath);
    }

    if (!this.viteServer && !isBundled) {
      const sourceClientPath = resolve(__dirname, '../client');
      try {
        const { createServer: createViteServer } = await import('vite');
        this.viteServer = await createViteServer({
          root: sourceClientPath,
          plugins: [formatPlugin],
          server: {
            middlewareMode: true,
            hmr: { port: this.config.development.hmrPort || 5173 },
          },
        });
      } catch {
        serverLogger.warn('[Dev Server] Vite not available');
      }
    }

    if (this.viteServer) {
      this.app.use('*', async (c, next) => {
        const path = c.req.path;

        if ((path.startsWith('/api') || path === '/health') && !/\.(ts|tsx|js|jsx|css|map)$/.test(path)) {
          return next();
        }

        const env = c.env as Record<string, unknown>;
        const req = env.incoming || env.req;
        const res = env.outgoing || env.res;

        if (req && res && this.viteServer) {
          return new Promise((resolve) => {
            this.viteServer!.middlewares.handle(req as any, res as any, () => {
              resolve(next());
            });
          });
        }

        return next();
      });
    }
  }

  private async setupBuiltClient(clientPath: string) {
    const { serveStatic } = await import('@hono/node-server/serve-static');
    const fs = await import('fs');
    const { extname } = await import('path');
    const mime = await import('mime-types');

    const format = this.adapter.name.replace(/[^a-zA-Z0-9]/g, '');

    // Serve static assets
    this.app.use('/assets/*', serveStatic({
      root: clientPath,
      rewriteRequestPath: (path) => path.replace(/^\/assets/, '/assets'),
    }));

    // Handle file requests
    this.app.use('/*', async (c, next) => {
      const reqPath = c.req.path;
      if (reqPath.startsWith('/api') || reqPath === '/health') return next();

      const ext = extname(reqPath);
      if (ext) {
        const filePath = resolve(clientPath, reqPath.slice(1));
        if (fs.existsSync(filePath)) {
          const mimeType = mime.lookup(filePath) || 'application/octet-stream';
          const content = fs.readFileSync(filePath);
          c.header('Content-Type', mimeType);
          return c.body(content);
        }
      }

      return next();
    });

    // SPA fallback - inject format into HTML
    this.app.get('*', async (c) => {
      const reqPath = c.req.path;
      if (reqPath.startsWith('/api') || reqPath === '/health') return c.notFound();

      const indexPath = resolve(clientPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, 'utf-8');
        // Inject format configuration
        html = html.replace(
          '</head>',
          `<script>window.__JTO_FORMAT__ = '${format}';</script>\n</head>`
        );
        return c.html(html);
      }

      return c.notFound();
    });
  }

  private async setupProdClient() {
    const { serveStatic } = await import('@hono/node-server/serve-static');
    const format = this.adapter.name.replace(/[^a-zA-Z0-9]/g, '');

    this.app.use('/*', async (c, next) => {
      const path = c.req.path;
      if (path.startsWith('/api') || path === '/health') return next();
      return serveStatic({ root: './dist/client' })(c, next);
    });

    this.app.get('*', (c) => {
      const path = c.req.path;
      if (path.startsWith('/api') || path === '/health') return c.notFound();

      return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JSON to Office</title>
  <script>window.__JTO_FORMAT__ = '${format}';</script>
  <script>window.location.href = '/';</script>
</head>
<body>
  <noscript>You need to enable JavaScript to run this app.</noscript>
</body>
</html>`);
    });
  }

  async start(): Promise<void> {
    await this.initialize();

    return new Promise((resolve) => {
      this.server = serve(
        {
          fetch: this.app.fetch,
          port: this.config.server.port,
          hostname: this.config.server.host,
        },
        () => {
          resolve();
        }
      );
    });
  }

  async stop(): Promise<void> {
    if (this.viteServer) await this.viteServer.close();
    if (this.server) {
      return new Promise((resolve) => {
        this.server?.close(() => resolve());
      });
    }
  }
}
