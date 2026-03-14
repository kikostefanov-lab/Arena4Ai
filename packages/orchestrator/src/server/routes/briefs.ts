import { Router } from 'express';
import type { Request, Response } from 'express';
import type { BriefsRepository } from '../../db/repository.js';

export function createBriefsRouter(briefsRepo: BriefsRepository) {
  const router = Router();

  // GET /briefs
  router.get('/', async (_req: Request, res: Response) => {
    const rows = await briefsRepo.list();
    res.json(rows.map(r => ({
      id: r.id, title: r.title, brief: r.brief,
      source: r.source, qualityScore: r.qualityScore ? Number(r.qualityScore) : null,
      tags: r.tags ?? [], createdAt: r.createdAt,
    })));
  });

  // POST /briefs
  router.post('/', async (req: Request, res: Response) => {
    const { brief, source = 'generated', tags } = req.body;
    if (!brief?.title) { res.status(400).json({ error: 'Missing brief or title' }); return; }
    const id = brief.id ?? brief.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    await briefsRepo.save({ id, title: brief.title, brief, source, qualityScore: brief._qualityScore ?? null, tags: tags ?? brief.tags ?? [] });
    res.status(201).json({ id });
  });

  // PUT /briefs/:id
  router.put('/:id', async (req: Request<{ id: string }>, res: Response) => {
    const { brief, tags } = req.body;
    if (!brief) { res.status(400).json({ error: 'Missing brief' }); return; }
    await briefsRepo.save({ id: req.params.id, title: brief.title ?? req.params.id, brief, source: 'generated', tags: tags ?? brief.tags ?? [] });
    res.json({ id: req.params.id });
  });

  // DELETE /briefs/:id (YAML protected)
  router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
    const existing = await briefsRepo.getById(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    if (existing.source === 'yaml') { res.status(403).json({ error: 'Cannot delete YAML-sourced briefs' }); return; }
    await briefsRepo.remove(req.params.id);
    res.json({ deleted: true });
  });

  return router;
}
