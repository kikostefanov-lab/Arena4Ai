import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PersonaRepository } from '../../db/persona-repository.js';

export function createPersonasRouter(repo: PersonaRepository): Router {
  const router = Router();

  // GET /personas?retired=false&search=arch
  router.get('/', async (req: Request, res: Response) => {
    try {
      const retired = req.query.retired === 'true';
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const list = await repo.list({ retired, search });
      res.json(list);
    } catch (err) {
      console.error('[personas] list error:', err);
      res.status(500).json({ error: 'Failed to list personas' });
    }
  });

  // POST /personas
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { name, description, systemPrompt, avatar, tags } = req.body as {
        name?: string; description?: string; systemPrompt?: string;
        avatar?: string; tags?: string[];
      };
      if (!name || !systemPrompt) {
        res.status(400).json({ error: 'name and systemPrompt are required' });
        return;
      }
      const id = `persona-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const persona = await repo.create({ id, name, description, systemPrompt, avatar, tags, createdBy: 'user' });
      res.status(201).json(persona);
    } catch (err: any) {
      if (err.code === '23505') {
        res.status(409).json({ error: 'A persona with this name already exists' });
        return;
      }
      console.error('[personas] create error:', err);
      res.status(500).json({ error: 'Failed to create persona' });
    }
  });

  // GET /personas/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const persona = await repo.get(String(req.params.id));
      if (!persona) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(persona);
    } catch (err) {
      console.error('[personas] get error:', err);
      res.status(500).json({ error: 'Failed to get persona' });
    }
  });

  // PATCH /personas/:id
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const updated = await repo.update(String(req.params.id), req.body);
      if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(updated);
    } catch (err) {
      console.error('[personas] update error:', err);
      res.status(500).json({ error: 'Failed to update persona' });
    }
  });

  // DELETE /personas/:id — retire
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const result = await repo.retire(String(req.params.id));
      if (result.notFound) { res.status(404).json({ error: 'Not found' }); return; }
      if (!result.retired && result.blockedByAgents) {
        res.status(409).json({
          error: `${result.blockedByAgents} agent(s) still use this persona — retire or reassign them first.`,
        });
        return;
      }
      res.json({ retired: true });
    } catch (err) {
      console.error('[personas] retire error:', err);
      res.status(500).json({ error: 'Failed to retire persona' });
    }
  });

  return router;
}
