import 'dotenv/config';
import express from 'express';
import path from 'path';
import {AuditLog} from './server/auditLog.ts';
import {AUDIT_LOG_PATH, HOST, PORT, SERVER_DATA_DIR, distPath, hasBuiltDist, useViteDev} from './server/config.ts';
import {LiveMarketEngine} from './server/marketEngine.ts';
import {createApiRouter} from './server/routes.ts';

async function startServer() {
  const app = express();
  const engine = new LiveMarketEngine();
  const audit = new AuditLog(AUDIT_LOG_PATH);
  app.use('/api', createApiRouter(engine, audit));

  if (useViteDev) {
    try {
      const {createServer: createViteServer} = await import('vite');
      const vite = await createViteServer({
        server: {middlewareMode: true},
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('[boot] Vite dev middleware unavailable, serving static dist:', err);
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  console.log('[boot] binding HTTP server...', {
    port: PORT,
    useViteDev,
    hasBuiltDist,
    host: HOST,
    dataDir: SERVER_DATA_DIR,
    nodeEnv: process.env.NODE_ENV || null,
  });

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(
      `Kestrel Trade server (${useViteDev ? 'dev' : 'production'}) listening on http://${HOST}:${PORT}`,
    );
  });
  httpServer.requestTimeout = 0;
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  httpServer.on('error', (err) => {
    console.error('[boot] HTTP server listen error:', err);
    process.exit(1);
  });
}

process.on('uncaughtException', (err) => {
  console.error('[runtime] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[runtime] Unhandled promise rejection:', reason);
});

startServer().catch((err) => {
  console.error('[boot] Fatal startup error:', err);
  process.exit(1);
});
