/**
 * Synthetic ArenaEvent streams for the harness.
 *
 * These are emitted in the REAL wire shape — ISO-8601 `timestamp`, `payload`,
 * `metadata` — not the prototype's convenient `{timestamp: msFromStart}`. The
 * harness is only worth anything if it exercises the same normalization path a
 * live competition does, including `toFrameEvents()` parsing the dates.
 */

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T0 = Date.parse('2026-08-24T00:00:00.000Z');
const TIME_LIMIT = 120000;

const THOUGHTS = [
  'stdin may be empty — default to 1..100', 'tests should cover 3, 5, 15 and 0',
  'keep the CLI a thin wrapper', 'use argparse for --max', 'edge: negative numbers',
  'README needs a usage block', 'separate generator from printer', 'no third-party deps per brief',
];
const TOOLS = [
  ['Bash', 'pytest -q'], ['Bash', 'python -m src.cli < input.txt'], ['Read', 'README.md'],
  ['Bash', 'ruff check .'], ['Grep', 'def fizz'], ['Bash', 'pytest tests/ -x'],
];
const ERRORS = [
  'pytest: 2 failed — test_fizzbuzz.py::test_fifteen', 'ModuleNotFoundError: No module named src',
  'SyntaxError: unexpected indent (cli.py:12)', 'ruff: E501 line too long (3)',
];
const CAST = [
  'Claude opens with a plan; Codex opens with a file. Two philosophies, one brief.',
  'Codex already has a test file up — speedrunner energy, but does it pass?',
  'Both teams have a README now. The judge reads those first, and it knows it.',
  'Tests are green on both boards. Now it comes down to what the judge values.',
];

function iso(ms) { return new Date(T0 + Math.round(ms)).toISOString(); }

/** Build the file list for a team; `count` drives the stress scenario. */
function fileList(rnd, count) {
  const roots = ['src', 'tests', 'docs', 'packages/api', 'packages/ui', 'packages/core', 'infra', 'scripts'];
  const leaves = ['', 'core', 'cli', 'util', 'models', 'handlers'];
  const exts = ['.py', '.py', '.ts', '.md', '.yml', '.json'];
  const out = [];
  for (let i = 0; i < count; i++) {
    const root = roots[Math.floor(rnd() * roots.length)];
    const leaf = leaves[Math.floor(rnd() * leaves.length)];
    const d = leaf ? `${root}/${leaf}` : root;
    out.push(`${d}/mod_${i}${exts[Math.floor(rnd() * exts.length)]}`);
  }
  return out;
}

/**
 * @param {object} o
 * @param {'modern'|'legacy'|'mixed'} o.mode  payload shape to emit
 * @param {number} o.filesPerTeam
 * @param {number} o.seed
 */
export function generateStream({ mode = 'modern', filesPerTeam = 9, seed = 7, teams }) {
  const rnd = mulberry32(seed);
  const events = [];
  let n = 0;
  const push = (t, type, teamId, payload) =>
    events.push({
      eventId: 'e' + n++,
      competitionId: 'harness',
      teamId: teamId ?? '',
      timestamp: iso(t),
      type,
      payload,
      metadata: {},
    });

  push(0, 'STATE_CHANGE', null, { state: 'LAUNCHING' });
  push(1200, 'STATE_CHANGE', null, { state: 'RUNNING' });

  for (const team of teams) {
    // A team is "legacy" in mixed mode if it is the second one — so one floor
    // shows measured heights and the other inferred, side by side.
    const legacy = mode === 'legacy' || mode === 'prose' || (mode === 'mixed' && team.id === teams[1]?.id);
    // 'prose' reproduces pre-AA-037 gemini: the CLI narrated in English and the
    // normalizer could not pull a path out of it at all. Nothing to put on the
    // floor — the strongest form of honest absence.
    const prose = mode === 'prose' && team.id === teams[1]?.id;
    const fast = team.persona === 'speedrunner';
    const files = fileList(rnd, filesPerTeam);
    const created = [];
    let t = 1500 + rnd() * 1500;
    let pool = [...files];
    // The competition window is fixed at two minutes, so a bigger file count has
    // to mean a FASTER agent, not a longer run — otherwise the stress scenario
    // silently emits the same ~100 events as the small one and proves nothing.
    // This is what a high-volume run actually looks like: hundreds of writes
    // inside the same clock.
    const pace = Math.max(0.015, 9 / filesPerTeam);

    while (t < TIME_LIMIT - 2500) {
      const phase = t / TIME_LIMIT;
      let wR = fast ? 0.28 : 0.45;
      let wC = pool.length ? (phase < 0.6 ? 0.32 : 0.12) : 0;
      let wM = created.length ? 0.18 + phase * 0.15 : 0;
      let wT = fast ? 0.32 : 0.22;
      if (phase > 0.75) { wR *= 0.6; wT *= 1.5; }
      let r = rnd() * (wR + wC + wM + wT);

      if ((r -= wR) < 0) {
        push(t, 'REASONING', team.id, { text: THOUGHTS[Math.floor(rnd() * THOUGHTS.length)] });
        t += ((fast ? 400 : 700) + rnd() * 900) * pace;
        continue;
      }
      if ((r -= wC) < 0) {
        const f = pool.shift();
        created.push(f);
        // LEGACY: no path, no op, no opSource. `text` carries the path, which is
        // exactly what codex and claude wrote before c965642.
        push(t, 'FILE_CREATE', team.id, prose
          ? { text: 'I have now written the implementation and saved it for you' }
          : legacy
            ? { text: f, ...(team.model.startsWith('claude') ? { tool: 'Write', input: { file_path: f } } : {}) }
            : { path: f, op: 'create', opSource: 'tool', tool: 'Write', text: `Write ${f}` });
        t += (900 + rnd() * 1600) * pace;
        continue;
      }
      if ((r -= wM) < 0) {
        const f = created[Math.floor(rnd() * created.length)];
        // LEGACY: no normalizer ever emitted FILE_MODIFY, so an edit was
        // recorded as another FILE_CREATE. That is the whole reason the edit
        // badge has read zero for as long as it has existed.
        push(t, legacy ? 'FILE_CREATE' : 'FILE_MODIFY', team.id, prose
          ? { text: 'Updated the file with the change you asked for' }
          : legacy
            ? { text: f }
            : { path: f, op: 'modify', opSource: 'tool', tool: 'Edit', text: `Edit ${f}` });
        t += (700 + rnd() * 1400) * pace;
        continue;
      }
      const tool = TOOLS[Math.floor(rnd() * TOOLS.length)];
      push(t, 'TOOL_CALL', team.id, { tool: tool[0], text: tool[1] });
      t += (500 + rnd() * 1200) * pace;
      if (created.length > 1 && rnd() < (fast ? 0.13 : 0.09)) {
        push(t, 'ERROR', team.id, { error: ERRORS[Math.floor(rnd() * ERRORS.length)] });
        t += (600 + rnd() * 600) * pace;
      }
    }
  }

  CAST.forEach((line, i) => push(9000 + i * 24000, 'COMMENTARY', null, { text: line }));
  push(TIME_LIMIT, 'STATE_CHANGE', null, { state: 'TIME_UP' });
  push(TIME_LIMIT + 600, 'STATE_CHANGE', null, { state: 'COLLECTING' });
  push(TIME_LIMIT + 2200, 'STATE_CHANGE', null, { state: 'PRESENTING' });
  push(TIME_LIMIT + 6500, 'STATE_CHANGE', null, { state: 'JUDGING' });
  push(TIME_LIMIT + 15500, 'STATE_CHANGE', null, { state: 'SCORED' });
  push(TIME_LIMIT + 16500, 'STATE_CHANGE', null, { state: 'COMPLETE' });

  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return { events, timeLimitMs: TIME_LIMIT, originMs: T0 };
}
