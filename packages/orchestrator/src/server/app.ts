import http from 'node:http';
import express from 'express';
import type { Application } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createCompetitionsRouter } from './routes/competitions.js';
import { analyticsRouter } from './routes/analytics.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { generateBriefRouter } from './routes/generate-brief.js';
import { tournamentsRouter } from './routes/tournaments.js';
import { briefsRouter } from './routes/briefs.js';
import { compareRouter } from './routes/compare.js';
import { criteriaRouter } from './routes/criteria.js';
import { attachWebSocket } from './websocket.js';
import { db } from '../db/client.js';
import { AgentProfileRepository } from '../db/agent-profile-repository.js';
import { createAgentProfilesRouter } from './routes/agent-profiles.js';
import { seedAgentProfiles } from '../db/seed-agent-profiles.js';

const CORS = {
  origin: '*',
  methods: 'GET, POST, PATCH, DELETE, OPTIONS',
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

  // Rate limiting: max 10 new competitions per minute per IP
  const createLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    message: { error: 'Too many competitions created. Try again in a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Tighter limit for expensive post-completion operations (forge, synthesis)
  const forgeSynthesisLimiter = rateLimit({
    windowMs: 60_000,
    max: 5,
    message: { error: 'Too many requests. Try again in a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Limit for AI brief generation
  const generateBriefLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: { error: 'Too many brief generation requests. Try again in a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const agentProfileRepo = new AgentProfileRepository(db);

  // Seed system agents on startup (async, non-blocking)
  void seedAgentProfiles(agentProfileRepo).catch((err) =>
    console.warn('[seed] Failed to seed agent profiles:', err),
  );

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/competitions', createLimiter, createCompetitionsRouter(agentProfileRepo));
  // Apply tighter limits to expensive post-completion routes
  app.post('/competitions/:id/forge', forgeSynthesisLimiter);
  app.post('/competitions/:id/synthesis', forgeSynthesisLimiter);
  app.use('/analytics/criteria', criteriaRouter);
  app.use('/analytics', analyticsRouter);
  app.use('/compare', compareRouter);
  app.use('/leaderboard', leaderboardRouter);
  app.use('/generate-brief', generateBriefLimiter, generateBriefRouter);
  app.use('/tournaments', tournamentsRouter);
  app.use('/briefs', briefsRouter);
  // Apply tighter limit to fork endpoint (creates DB rows)
  app.post('/agent-profiles/:id/fork', forgeSynthesisLimiter);
  app.use('/agent-profiles', createAgentProfilesRouter(agentProfileRepo));

  return app;
}

export function createServer(): http.Server {
  const app = createApp();
  const server = http.createServer(app);
  attachWebSocket(server);
  return server;
}
