import { Router } from 'express';
import type { AgentRepository } from '../../db/agent-repository.js';

export function createAgentsRouter(repo: AgentRepository): Router {
  const router = Router();

  // GET /agents?provider=claude&retired=false&search=arch
  router.get('/', async (req, res) => {
    try {
      const { provider, retired, search } = req.query as Record<string, string>;
      const result = await repo.list({
        provider: provider || undefined,
        retired: retired === 'true',
        search: search || undefined,
      });
      res.json(result);
    } catch (err) {
      console.error('[agents] list error:', err);
      res.status(500).json({ error: 'Failed to list agents' });
    }
  });

  // POST /agents
  router.post('/', async (req, res) => {
    try {
      const { name, personaId, provider, modelVariant, providerOptions } = req.body as {
        name?: string; personaId?: string; provider?: 'claude' | 'codex' | 'gemini';
        modelVariant?: string; providerOptions?: Record<string, unknown>;
      };
      if (!name || !provider || !modelVariant) {
        res.status(400).json({ error: 'name, provider, and modelVariant are required' });
        return;
      }
      const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const agent = await repo.create({ id, name, personaId, provider, modelVariant, providerOptions, createdBy: 'user' });
      res.status(201).json(agent);
    } catch (err: any) {
      if (err.code === '23505') {
        res.status(409).json({ error: 'An agent with this provider+name already exists' });
        return;
      }
      console.error('[agents] create error:', err);
      res.status(500).json({ error: 'Failed to create agent' });
    }
  });

  // GET /agents/:id
  router.get('/:id', async (req, res) => {
    try {
      const agent = await repo.get(req.params.id);
      if (!agent) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(agent);
    } catch (err) {
      console.error('[agents] get error:', err);
      res.status(500).json({ error: 'Failed to get agent' });
    }
  });

  // PATCH /agents/:id
  router.patch('/:id', async (req, res) => {
    try {
      const { name, personaId, modelVariant, providerOptions } = req.body as {
        name?: string; personaId?: string | null;
        modelVariant?: string; providerOptions?: Record<string, unknown> | null;
      };
      const updated = await repo.update(req.params.id, { name, personaId, modelVariant, providerOptions });
      if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(updated);
    } catch (err) {
      console.error('[agents] update error:', err);
      res.status(500).json({ error: 'Failed to update agent' });
    }
  });

  // DELETE /agents/:id — retire
  router.delete('/:id', async (req, res) => {
    try {
      const agent = await repo.retire(req.params.id);
      if (!agent) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(agent);
    } catch (err) {
      console.error('[agents] retire error:', err);
      res.status(500).json({ error: 'Failed to retire agent' });
    }
  });

  // POST /agents/:id/fork
  router.post('/:id/fork', async (req, res) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name) { res.status(400).json({ error: 'name is required' }); return; }
      const forked = await repo.fork(req.params.id, { name, createdBy: 'user' });
      if (!forked) { res.status(404).json({ error: 'Source agent not found' }); return; }
      res.status(201).json(forked);
    } catch (err: any) {
      if (err.code === '23505') {
        res.status(409).json({ error: 'An agent with this provider+name already exists' });
        return;
      }
      console.error('[agents] fork error:', err);
      res.status(500).json({ error: 'Failed to fork agent' });
    }
  });

  return router;
}
