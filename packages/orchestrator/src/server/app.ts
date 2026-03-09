import http from 'node:http';
import express from 'express';
import type { Application } from 'express';
import { competitionsRouter } from './routes/competitions.js';
import { attachWebSocket } from './websocket.js';

const CORS = {
  origin: '*',
  methods: 'GET, POST, OPTIONS',
  headers: 'Content-Type, Authorization',
} as const;

export function createApp(): Application {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', CORS.origin);
    res.setHeader('Access-Control-Allow-Methods', CORS.methods);
    res.setHeader('Access-Control-Allow-Headers', CORS.headers);
    next();
  });

  // Handle preflight
  app.options('/*path', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', CORS.origin);
    res.setHeader('Access-Control-Allow-Methods', CORS.methods);
    res.setHeader('Access-Control-Allow-Headers', CORS.headers);
    res.status(204).end();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/competitions', competitionsRouter);

  return app;
}

export function createServer(): http.Server {
  const app = createApp();
  const server = http.createServer(app);
  attachWebSocket(server);
  return server;
}
