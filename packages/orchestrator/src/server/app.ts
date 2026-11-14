import http from 'node:http';
import express from 'express';
import type { Application } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createCompetitionsRouter } from './routes/competitions.js';
import { analyticsRouter } from './routes/analytics.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { generateBriefRouter } from './routes/generate-brief.js';
import { tournamentsRouter } from './routes/tournaments.js';
import { createBriefsRouter } from './routes/briefs.js';
import { BriefsRepository } from '../db/repository.js';
import { seedYamlBriefs } from './routes/briefs-seed.js';
import { compareRouter } from './routes/compare.js';
import { criteriaRouter } from './routes/criteria.js';
import { attachWebSocket } from './websocket.js';
import { db } from '../db/client.js';
import { PersonaRepository } from '../db/persona-repository.js';
import { AgentRepository } from '../db/agent-repository.js';
import { createAgentProfilesRouter } from './routes/agent-profiles.js';
import { createPersonasRouter } from './routes/personas.js';
import { createAgentsRouter } from './routes/agents.js';
import { generatePersonaRouter } from './routes/generate-persona.js';
import { seedPersonasAgents, repairStaleSystemAgents } from '../db/seed-personas-agents.js';
import { getLiveModelRegistry } from '../adapters/model-catalog.js';
import { requireApiKeyForAll } from './middleware/auth.js';
import { isAllowedWsOrigin } from './network.js';

const CORS = {
  methods: 'GET, POST, PATCH, DELETE, OPTIONS',
  headers: 'Content-Type, Authorization',
} as const;

export function createApp(): Application {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Browser origins. This used to be `Access-Control-Allow-Origin: *`, which let
  // any website open in the operator's browser read from, and with no key set
  // write to, the local orchestrator. Now only an allowed origin (loopback, or
  // ARENA_ALLOWED_ORIGINS) is echoed back, and a request that names any other
  // origin is refused outright. Requests with no Origin header (the web app's
  // server, curl, scripts) are unaffected: this is a browser control, and the
  // API key remains the real gate.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !isAllowedWsOrigin(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', CORS.methods);
    res.setHeader('Access-Control-Allow-Headers', CORS.headers);
    next();
  });

  // Handle preflight
  app.options('/*path', (_req, res) => {
    res.status(204).end();
  });

  // Auth. Applied here, once, rather than per-router: a route that forgets its
  // own `requireApiKey` is an open door to the operator's machine. With
  // ARENA_API_KEY set, reads need the key too (deliverables and event logs can
  // hold source code and prompts); only /health is exempt. Unset = all open.
  app.use(requireApiKeyForAll);

  // Rate limiting: max 10 new competitions per minute per IP.
  //
  // SCOPE THIS TO THE MUTATION, NEVER TO THE ROUTER. Mounted as
  // `app.use('/competitions', createLimiter, router)` it charged every GET to
  // the create budget — listing competitions, opening one, streaming its events
  // — so a viewer refreshing a page a few times got
  // "Too many competitions created" and the arena silently rendered no data at
  // all. A limiter on a read path fails as MISSING CONTENT rather than as an
  // error anyone notices, which is what let it survive.
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

  // Limit for AI brief generation.
  // Mounted with `app.use` below, which is safe ONLY because every route in
  // that router is a POST. If a GET is ever added there it will be rate-limited
  // as though it were a generation — the same defect fixed above. Same for
  // /generate-persona.
  const generateBriefLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: { error: 'Too many brief generation requests. Try again in a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Limit for AI persona generation
  const generatePersonaLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: { error: 'Too many generate-persona requests. Try again in a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const personaRepo = new PersonaRepository(db);
  const agentRepo = new AgentRepository(db);

  // Seed system personas + agents on startup (async, non-blocking)
  void seedPersonasAgents(personaRepo, agentRepo)
    .then(() => repairStaleSystemAgents(agentRepo))
    .catch((err) => console.warn('[seed] Failed to seed personas/agents:', err));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  // Presets come from the installed CLIs (cached), so pickers follow new models.
  app.get('/models', async (_req, res, next) => {
    try { res.json(await getLiveModelRegistry()); } catch (err) { next(err); }
  });
  // Tighter limits for the two most expensive routes in the product. These MUST
  // be registered before the /competitions router: Express matches layers in
  // registration order, so a router mounted first answers the path and any
  // limiter registered after it is dead code.
  app.post('/competitions/:id/forge', forgeSynthesisLimiter);
  app.post('/competitions/:id/synthesis', forgeSynthesisLimiter);
  // Creation only. Same registration-order rule as above: this must precede the
  // router, and it is `app.post` rather than `app.use` so the seven GET routes
  // underneath (list, fetch, events, forge status, forge progress, forge
  // download, synthesis status) are never charged for it.
  app.post('/competitions', createLimiter);
  app.use('/competitions', createCompetitionsRouter(agentRepo));
  app.use('/analytics/criteria', criteriaRouter);
  app.use('/analytics', analyticsRouter);
  app.use('/compare', compareRouter);
  app.use('/leaderboard', leaderboardRouter);
  app.use('/generate-brief', generateBriefLimiter, generateBriefRouter);
  app.use('/tournaments', tournamentsRouter);
  const briefsRepo = new BriefsRepository(db);
  app.use('/briefs', createBriefsRouter(briefsRepo));

  // Seed YAML briefs into DB on startup (async, non-blocking)
  void seedYamlBriefs(briefsRepo).catch((err) =>
    console.warn('[seed] Failed to seed YAML briefs:', err),
  );
  app.use('/personas', createPersonasRouter(personaRepo));
  app.use('/agents', createAgentsRouter(agentRepo));
  app.use('/generate-persona', generatePersonaLimiter, generatePersonaRouter);
  // Keep agent-profiles for backward compat (now backed by AgentRepository)
  app.use('/agent-profiles', createAgentProfilesRouter(agentRepo));

  return app;
}

export function createServer(): http.Server {
  const app = createApp();
  const server = http.createServer(app);
  attachWebSocket(server);
  return server;
}
