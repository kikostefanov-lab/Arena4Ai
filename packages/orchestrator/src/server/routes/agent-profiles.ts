import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { AgentRepository } from '../../db/agent-repository.js';

export function createAgentProfilesRouter(repo: AgentRepository): Router {
  const router = Router();

  // GET /agent-profiles?provider=claude&retired=false
  router.get('/', async (req, res) => {
    try {
      const { provider, retired } = req.query as Record<string, string>;
      const filters: { provider?: string; retired?: boolean } = {};
      if (provider) filters.provider = provider;
      if (retired !== undefined) filters.retired = retired === 'true';
      const result = await repo.list(filters);
      res.json(result.agents);
    } catch (_err) {
      res.status(500).json({ error: 'Failed to list agent profiles' });
    }
  });

  // POST /agent-profiles
  router.post('/', async (req, res) => {
    try {
      const { name, provider, modelVariant, systemPrompt, description, avatar, tags } = req.body as Record<string, unknown>;
      if (!name || !provider || !modelVariant) {
        res.status(400).json({ error: 'name, provider, modelVariant are required' });
        return;
      }
      const id = `agent-${randomUUID()}`;
      const created = await repo.create({
        id,
        name: String(name),
        provider: String(provider) as 'claude' | 'codex' | 'gemini',
        modelVariant: String(modelVariant),
        createdBy: 'user',
      });
      res.status(201).json(created);
    } catch (_err) {
      res.status(500).json({ error: 'Failed to create agent profile' });
    }
  });

  // GET /agent-profiles/:id
  router.get('/:id', async (req, res) => {
    try {
      const profile = await repo.get(req.params.id);
      if (!profile) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json(profile);
    } catch (_err) {
      res.status(500).json({ error: 'Failed to get agent profile' });
    }
  });

  // PATCH /agent-profiles/:id
  router.patch('/:id', async (req, res) => {
    try {
      const profile = await repo.get(req.params.id);
      if (!profile) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      if (profile.createdBy === 'system') {
        res.status(403).json({ error: 'System profiles cannot be edited' });
        return;
      }
      const updated = await repo.update(req.params.id, req.body as Parameters<typeof repo.update>[1]);
      res.json(updated);
    } catch (_err) {
      res.status(500).json({ error: 'Failed to update agent profile' });
    }
  });

  // DELETE /agent-profiles/:id  (soft delete — retire)
  router.delete('/:id', async (req, res) => {
    try {
      const profile = await repo.get(req.params.id);
      if (!profile) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      if (profile.createdBy === 'system') {
        res.status(403).json({ error: 'System profiles cannot be deleted' });
        return;
      }
      const retired = await repo.retire(req.params.id);
      res.json({ ok: retired !== null });
    } catch (_err) {
      res.status(500).json({ error: 'Failed to retire agent profile' });
    }
  });

  // POST /agent-profiles/:id/fork
  router.post('/:id/fork', async (req, res) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      const fork = await repo.fork(req.params.id, { name, createdBy: 'user' });
      if (!fork) {
        res.status(404).json({ error: 'Source agent not found' });
        return;
      }
      res.status(201).json(fork);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fork';
      const status = err instanceof Error && err.message.includes('not found') ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  });

  return router;
}
