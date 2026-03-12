import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { orchestratorUrl, orchestratorHeaders } from '../../../../../lib/orchestrator';
import { getBundle } from '../../../../../lib/remotion-bundle';
import { COMPOSITION_ID } from '@arena/video';
import type { ReelData, ReelTeam } from '@arena/video';

// ─── Types ────────────────────────────────────────────────────────────────────

type ReelStatus =
  | { status: 'idle' }
  | { status: 'rendering'; progress: number }
  | { status: 'done'; url: string }
  | { status: 'error'; message: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const REELS_DIR = '/tmp/arena-reels';

function statePath(id: string) { return path.join(REELS_DIR, `${id}.json`); }
function mp4Path(id: string)   { return path.join(REELS_DIR, `${id}.mp4`); }

function readState(id: string): ReelStatus | null {
  try {
    const raw = fs.readFileSync(statePath(id), 'utf8');
    return JSON.parse(raw) as ReelStatus;
  } catch {
    return null;
  }
}

function writeState(id: string, state: ReelStatus) {
  fs.mkdirSync(REELS_DIR, { recursive: true });
  fs.writeFileSync(statePath(id), JSON.stringify(state));
}

function getModelColor(model: string): string {
  const colors: Record<string, string> = { claude: '#ff6600', codex: '#0066ff', gemini: '#00f0ff' };
  return colors[model.toLowerCase().split(':')[0]] ?? '#4a8fa8';
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^[-•]\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .trim();
}

function extractFirstSentence(text: string): string {
  const stripped = stripMarkdown(text);
  const dotIdx = stripped.indexOf('. ');
  if (dotIdx !== -1 && dotIdx < 150) return stripped.slice(0, dotIdx + 1);
  return stripped.slice(0, 150);
}

// ─── Data transformer ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildReelData(competition: any, events: any[]): ReelData {
  const { brief, teams, startedAt, result } = competition;
  const startMs = new Date(startedAt).getTime();

  // Build criteria name list from brief rubric.
  // description is sometimes a placeholder (e.g. ">") — fall back to formatting the id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function criterionLabel(c: any): string {
    const desc = (c.description ?? '').trim();
    if (desc.length > 2) return desc;
    return (c.id as string)
      .split('-')
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const criteriaMap: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (brief.rubric?.criteria ?? []).forEach((c: any) => {
    criteriaMap[c.id] = criterionLabel(c);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const criteriaNames = (brief.rubric?.criteria ?? []).map((c: any) => criterionLabel(c));

  // Build teams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reelTeams: ReelTeam[] = teams.map((team: any) => {
    // team.model may be "claude:architect" or just "claude"; persona may be separate field
    const model = team.model.split(':')[0];
    const persona = team.persona ?? team.model.split(':')[1] ?? '';
    // result.scorecards holds per-team scores
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scorecard = result?.scorecards?.find((s: any) => s.teamId === team.id);
    // AI judge scores live in judgeResults[0].scores; each has score/10, criterionId, commentary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const judgeScores: any[] = scorecard?.judgeResults?.[0]?.scores ?? [];

    return {
      teamId: team.id,
      label: `${model}:${persona}`,
      model,
      persona,
      color: getModelColor(model),
      // finalScore is already 0–1
      score: scorecard?.finalScore ?? 0,
      criteriaScores: judgeScores.map((cs: any) => ({
        name: criteriaMap[cs.criterionId] ?? cs.criterionId,
        score: cs.score / 10,
        commentary: cs.commentary ?? '',
      })),
    };
  });

  // Key moments auto-selection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileCreates: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolCallBursts: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errors: any[] = [];

  for (const evt of events) {
    if (evt.type === 'FILE_CREATE' && !fileCreates.find(e => e.teamId === evt.teamId)) {
      fileCreates.push(evt);
    }
    if (evt.type === 'TOOL_CALL') toolCallBursts.push(evt);
    if (evt.type === 'ERROR') errors.push(evt);
  }

  // Pick the densest TOOL_CALL burst (highest count in any 10s window)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let burstMoment: any | null = null;
  if (toolCallBursts.length > 0) {
    let maxCount = 0;
    let bestEvt = toolCallBursts[0];
    for (const evt of toolCallBursts) {
      const evtMs = new Date(evt.timestamp).getTime();
      const count = toolCallBursts.filter(e => {
        const ms = new Date(e.timestamp).getTime();
        return ms >= evtMs && ms < evtMs + 10000;
      }).length;
      if (count > maxCount) { maxCount = count; bestEvt = evt; }
    }
    burstMoment = bestEvt;
  }

  const allMoments = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...fileCreates.map(e => ({
      relativeMs: new Date(e.timestamp).getTime() - startMs,
      teamId: e.teamId,
      label: (() => {
        try { return `Created ${(e.payload as { path?: string })?.path?.split('/').pop() ?? 'file'}`; } catch { return 'Created file'; }
      })(),
      type: 'FILE_CREATE' as const,
    })),
    ...(burstMoment ? [{
      relativeMs: new Date(burstMoment.timestamp).getTime() - startMs,
      teamId: burstMoment.teamId,
      label: 'Tool call burst',
      type: 'TOOL_CALL' as const,
    }] : []),
    ...errors.slice(0, 1).map(e => ({
      relativeMs: new Date(e.timestamp).getTime() - startMs,
      teamId: e.teamId,
      label: 'Error encountered',
      type: 'ERROR' as const,
    })),
  ]
    .sort((a, b) => a.relativeMs - b.relativeMs)
    .slice(0, 5);

  const synthesis = result?.synthesis ?? null;
  const synthesisQuote = synthesis?.synthesis
    ? extractFirstSentence(synthesis.synthesis)
    : undefined;

  return {
    competitionId: competition.id,
    briefTitle: brief.title,
    briefDescription: brief.problem ?? '',
    criteria: criteriaNames,
    teams: reelTeams,
    winnerId: result?.winnerId ?? null,
    keyMoments: allMoments,
    synthesisQuote,
    hasSynthesis: synthesis !== null,
    hasForge: !!(result?.forge && result.forge.length > 0),
  };
}

// ─── POST /api/competitions/[id]/reel ────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const COMPLETE_STATES = ['COMPLETE', 'FORGING', 'FORGE_COMPLETE'];

  // Fetch competition
  const compRes = await fetch(orchestratorUrl(`/competitions/${id}`), { headers: orchestratorHeaders() });
  if (!compRes.ok) return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  const competition = await compRes.json();

  if (!COMPLETE_STATES.includes(competition.state)) {
    return NextResponse.json({ error: 'Competition must be complete to generate a reel' }, { status: 422 });
  }

  fs.mkdirSync(REELS_DIR, { recursive: true });

  // Atomic lock with wx flag
  try {
    fs.writeFileSync(statePath(id), JSON.stringify({ status: 'rendering', progress: 0 }), { flag: 'wx' });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EEXIST') {
      const existing = readState(id);
      if (existing?.status === 'rendering') {
        return NextResponse.json({ error: 'Render already in progress' }, { status: 409 });
      }
      // status is 'done' or 'error' — delete both files and claim lock
      try { fs.unlinkSync(statePath(id)); } catch {}
      try { fs.unlinkSync(mp4Path(id)); } catch {}
      fs.writeFileSync(statePath(id), JSON.stringify({ status: 'rendering', progress: 0 }));
    } else {
      throw err;
    }
  }

  // Fetch events for key moment selection
  const eventsRes = await fetch(orchestratorUrl(`/competitions/${id}/events`), { headers: orchestratorHeaders() });
  const events: unknown[] = eventsRes.ok ? await eventsRes.json() : [];

  // Transform data
  const reelData = buildReelData(competition, events);

  // Fire-and-forget render
  void (async () => {
    try {
      const serveUrl = await getBundle();
      const inputProps = reelData as unknown as Record<string, unknown>;
      const composition = await selectComposition({
        serveUrl,
        id: COMPOSITION_ID,
        inputProps,
      });
      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: mp4Path(id),
        inputProps,
        onProgress: ({ progress }) => writeState(id, { status: 'rendering', progress }),
      });
      writeState(id, { status: 'done', url: `/api/competitions/${id}/reel/download` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      writeState(id, { status: 'error', message: msg });
    }
  })();

  return NextResponse.json({ status: 'rendering' }, { status: 202 });
}

// ─── GET /api/competitions/[id]/reel ─────────────────────────────────────────

const STALE_RENDER_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sp = statePath(id);

  if (!fs.existsSync(sp)) {
    return NextResponse.json({ status: 'idle' });
  }

  const state = readState(id);
  if (!state) return NextResponse.json({ status: 'idle' });

  // Stale render detection
  if (state.status === 'rendering') {
    const mtime = fs.statSync(sp).mtimeMs;
    if (Date.now() - mtime > STALE_RENDER_MS) {
      return NextResponse.json({ status: 'error', message: 'Render timed out' });
    }
  }

  // done but MP4 gone (cleaned up)
  if (state.status === 'done' && !fs.existsSync(mp4Path(id))) {
    return NextResponse.json({ status: 'idle' });
  }

  return NextResponse.json(state);
}
