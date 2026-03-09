import http from 'node:http';
import express from 'express';
import type { Application } from 'express';
import { competitionsRouter } from './routes/competitions.js';

export function createApp(): Application {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/competitions', competitionsRouter);

  return app;
}

export function createServer(): http.Server {
  const app = createApp();
  return http.createServer(app);
}
