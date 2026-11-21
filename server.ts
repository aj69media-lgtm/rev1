import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { runMigrations, seedDefaultRolePermissions } from './server/db.ts';
import { initWebSocketServer } from './server/realtime.ts';
import adminRoutes from './server/routes/adminRoutes.ts';
import authRoutes from './server/routes/authRoutes.ts';
import clientPortalRoutes from './server/routes/clientPortalRoutes.ts';
import financeResourceRoutes from './server/routes/financeResourceRoutes.ts';
import projectRoutes from './server/routes/projectRoutes.ts';

async function startServer() {
  runMigrations();
  seedDefaultRolePermissions();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health probe
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'BuildCore CBMS', timestamp: new Date().toISOString() });
  });

  // Modular Monolith API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/client-portal', clientPortalRoutes);
  app.use('/api', projectRoutes);
  app.use('/api', financeResourceRoutes);

  // API 404 handler
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Safe error handler (never expose stack traces or server paths)
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[CBMS Error]', err.message);
    res.status(400).json({ error: err.message || 'Request failed' });
  });

  const server = http.createServer(app);
  initWebSocketServer(server);

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server },
        hmr: !hmrDisabled,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`BuildCore CBMS listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BuildCore CBMS server:', err);
  process.exit(1);
});
