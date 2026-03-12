# Remotion Video Reels Implementation Plan

> **Status: COMPLETE** — All 21 tasks implemented and working end-to-end. Post-plan improvements: N-team scene support, Ken Burns ScoreReveal, Winner ceremony, criterion label fallback, Arena4Ai theme audio, data layer fixes (finalScore, judgeResults scores, team.persona).

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "🎬 Generate Reel" button to completed competition pages that renders an ESPN-style 9:16 vertical recap video (~42s) using Remotion and returns a downloadable MP4.

**Architecture:** New `packages/video/` Remotion package contains all scenes/components and the `ReelData` type. The Next.js web package adds two API routes (`POST/GET /api/competitions/[id]/reel` and `GET /api/competitions/[id]/reel/download`) that transform competition data, run `renderMedia()` server-side, track progress via a temp JSON state file, and stream the MP4 for download. The competition detail page gains a reel button with inline progress % and a TRON-styled progress card.

**Tech Stack:** Remotion 4.x, `@remotion/renderer`, `@remotion/bundler`, `@remotion/google-fonts`, Next.js 15 App Router, TypeScript, npm workspaces (Turbo)

---

## File Map

### New files — `packages/video/`
| File | Responsibility |
|------|---------------|
| `packages/video/package.json` | Package config, Remotion deps |
| `packages/video/tsconfig.json` | TSX + bundler module resolution |
| `packages/video/remotion.config.ts` | Remotion Studio entry config |
| `packages/video/src/index.ts` | Package entry: exports `ReelData`, `COMPOSITION_ID` |
| `packages/video/src/types.ts` | `ReelData` interface |
| `packages/video/src/tokens.ts` | Standalone TRON design tokens (no Next.js imports) |
| `packages/video/src/utils.ts` | Shared `hexToRgb()` helper (used by components + scenes) |
| `packages/video/src/mock.ts` | `mockReelData` fixture for Studio dev |
| `packages/video/src/Root.tsx` | Remotion Root + `<Composition>` registry |
| `packages/video/src/compositions/CompetitionRecap.tsx` | Main composition wiring all 8 scenes |
| `packages/video/src/components/TronGrid.tsx` | Animated TRON grid background |
| `packages/video/src/components/ModelBadge.tsx` | Color-matched model name badge |
| `packages/video/src/components/ScoreBar.tsx` | Animated dual score bar |
| `packages/video/src/components/EventRow.tsx` | Single key-moment row |
| `packages/video/src/scenes/IntroBumper.tsx` | Frames 0–90: logo + "COMPETITION RECAP" |
| `packages/video/src/scenes/Matchup.tsx` | Frames 90–210: A vs B matchup card |
| `packages/video/src/scenes/TheBrief.tsx` | Frames 210–330: challenge + criteria |
| `packages/video/src/scenes/KeyMoments.tsx` | Frames 330–570: 3–5 highlights |
| `packages/video/src/scenes/ScoreReveal.tsx` | Frames 570–900: criterion score bars |
| `packages/video/src/scenes/Winner.tsx` | Frames 900–990: winner glow |
| `packages/video/src/scenes/GoDeeper.tsx` | Frames 990–1170: Synthesis + Forge promo |
| `packages/video/src/scenes/Outro.tsx` | Frames 1170–1260: branding outro |

### New files — `packages/web/`
| File | Responsibility |
|------|---------------|
| `packages/web/lib/remotion-bundle.ts` | Promise-singleton for Remotion bundle |
| `packages/web/app/api/competitions/[id]/reel/route.ts` | POST (trigger render) + GET (poll status) |
| `packages/web/app/api/competitions/[id]/reel/download/route.ts` | GET: stream MP4 |

### Modified files — `packages/web/`
| File | Change |
|------|--------|
| `packages/web/package.json` | Add `@arena/video`, `@remotion/renderer`, `@remotion/bundler` |
| `packages/web/tsconfig.json` | Add `@arena/video/*` path alias |
| `packages/web/app/competitions/[id]/page.tsx` | Add reel button + progress card |

---

## Chunk 1: Video Package Foundation

### Task 1: Scaffold `packages/video/`

**Files:**
- Create: `packages/video/package.json`
- Create: `packages/video/tsconfig.json`
- Create: `packages/video/remotion.config.ts`

- [ ] **Step 1: Create `packages/video/package.json`**

```json
{
  "name": "@arena/video",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "build:watch": "tsc -p tsconfig.json --watch",
    "studio": "npx remotion studio src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "remotion": "^4.0.0",
    "@remotion/renderer": "^4.0.0",
    "@remotion/bundler": "^4.0.0",
    "@remotion/google-fonts": "^4.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@remotion/cli": "^4.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `packages/video/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "jsx": "react-jsx",
    "module": "CommonJS",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`"jsx": "react-jsx"` uses the automatic JSX runtime — no `import React from 'react'` needed in component files. `"moduleResolution": "bundler"` is required for Remotion 4.x's `exports`-based package resolution.

- [ ] **Step 3: Create `packages/video/remotion.config.ts`**

```ts
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
```

- [ ] **Step 4: Install dependencies**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
npm install --workspace=packages/video
```

Expected: Remotion packages installed in `packages/video/node_modules`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add packages/video/package.json packages/video/tsconfig.json packages/video/remotion.config.ts
git commit -m "feat(video): scaffold packages/video with Remotion dependencies"
```

---

### Task 2: Foundation files — types, tokens, mock, index

**Files:**
- Create: `packages/video/src/types.ts`
- Create: `packages/video/src/tokens.ts`
- Create: `packages/video/src/mock.ts`
- Create: `packages/video/src/index.ts`

- [ ] **Step 1: Create `packages/video/src/types.ts`**

```ts
export interface ReelCriterionScore {
  name: string;        // display name from brief.rubric.criteria[].description
  score: number;       // 0–1
  commentary: string;
}

export interface ReelTeam {
  teamId: string;
  label: string;       // e.g. "claude:architect"
  model: string;       // e.g. "claude"
  persona: string;     // e.g. "architect"
  color: string;       // hex color for this model
  score: number;       // 0–1 total score
  criteriaScores: ReelCriterionScore[];
}

export interface ReelKeyMoment {
  relativeMs: number;  // ms from competition startedAt
  teamId: string;
  label: string;       // e.g. "Created fizzbuzz.py"
  type: 'FILE_CREATE' | 'TOOL_CALL' | 'ERROR';
}

export interface ReelData {
  competitionId: string;
  briefTitle: string;
  briefDescription: string;
  criteria: string[];              // display names in order
  teams: ReelTeam[];
  winnerId: string | null;
  keyMoments: ReelKeyMoment[];
  synthesisQuote?: string;         // first sentence of synthesis, markdown stripped
  hasSynthesis: boolean;
  hasForge: boolean;
}
```

- [ ] **Step 2: Create `packages/video/src/tokens.ts`**

Standalone copy — do NOT import from `packages/web`. This avoids circular deps and Next.js-specific import failures in Remotion's bundler.

```ts
// TRON design tokens — standalone copy for use in Remotion components.
// Keep in sync with packages/web/lib/design-tokens.ts manually.

export const BG_DARK    = '#000408';
export const BG_CARD    = '#050f1e';
export const BG_HEADER  = '#020b14';

export const ACCENT_CYAN   = '#00f0ff';
export const ACCENT_BLUE   = '#0080ff';
export const ACCENT_ORANGE = '#ff6600';
export const ACCENT_GOLD   = '#ffd700';

export const TEXT_PRIMARY = '#e4f8ff';
export const TEXT_MUTED   = '#7cc6db';
export const TEXT_DIM     = '#3d7d94';

export const MODEL_COLORS: Record<string, string> = {
  claude: '#ff6600',
  codex:  '#0066ff',
  gemini: '#00f0ff',
};

export function getModelColor(model: string): string {
  const base = model.toLowerCase().split(':')[0];
  return MODEL_COLORS[base] ?? '#4a8fa8';
}

export const ORBITRON = '"Orbitron", sans-serif';
export const MONO     = '"SF Mono", "Fira Code", monospace';
```

- [ ] **Step 3: Create `packages/video/src/mock.ts`**

```ts
import type { ReelData } from './types';

export const mockReelData: ReelData = {
  competitionId: 'mock-001',
  briefTitle: 'FizzBuzz CLI Challenge',
  briefDescription: 'Build a CLI tool that outputs FizzBuzz for numbers 1–100.',
  criteria: ['Correctness', 'Code Quality', 'Performance'],
  teams: [
    {
      teamId: 'team-a',
      label: 'claude:architect',
      model: 'claude',
      persona: 'architect',
      color: '#ff6600',
      score: 0.917,
      criteriaScores: [
        { name: 'Correctness',   score: 0.95, commentary: 'All 100 numbers correct with proper Fizz, Buzz, FizzBuzz logic.' },
        { name: 'Code Quality',  score: 0.88, commentary: 'Clean, readable Python with good variable names and comments.' },
        { name: 'Performance',   score: 0.92, commentary: 'Efficient single-pass implementation, no unnecessary iterations.' },
      ],
    },
    {
      teamId: 'team-b',
      label: 'codex:speedrunner',
      model: 'codex',
      persona: 'speedrunner',
      color: '#0066ff',
      score: 0.832,
      criteriaScores: [
        { name: 'Correctness',   score: 0.80, commentary: 'Output correct but edge case at 15 was handled suboptimally.' },
        { name: 'Code Quality',  score: 0.85, commentary: 'Compact JavaScript, could use more descriptive naming.' },
        { name: 'Performance',   score: 0.85, commentary: 'Functional but used a dictionary lookup instead of modulo.' },
      ],
    },
  ],
  winnerId: 'team-a',
  keyMoments: [
    { relativeMs: 42000,  teamId: 'team-a', label: 'Created fizzbuzz.py',    type: 'FILE_CREATE' },
    { relativeMs: 65000,  teamId: 'team-b', label: 'Created solution.js',    type: 'FILE_CREATE' },
    { relativeMs: 91000,  teamId: 'team-a', label: 'Created test_fizzbuzz.py', type: 'FILE_CREATE' },
  ],
  synthesisQuote: 'Claude demonstrated a more thorough approach by including unit tests alongside the implementation.',
  hasSynthesis: true,
  hasForge: true,
};
```

- [ ] **Step 4: Create `packages/video/src/index.ts`**

```ts
export type { ReelData, ReelTeam, ReelCriterionScore, ReelKeyMoment } from './types';
export const COMPOSITION_ID = 'CompetitionRecap' as const;
// Note: ReelTeam is exported above so the web API route can use it for building the teams array.
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
npm run typecheck --workspace=packages/video
```

Expected: No errors.

- [ ] **Step 5b: Create `packages/video/src/utils.ts`**

Used by all components and scenes — avoids duplicating this in every file.

```ts
export function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
npm run typecheck --workspace=packages/video
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add packages/video/src/
git commit -m "feat(video): add ReelData types, design tokens, mock fixture, utils, and package entry"
```

---

## Chunk 2: Shared Components

### Task 3: TronGrid component

**Files:**
- Create: `packages/video/src/components/TronGrid.tsx`

Renders the animated TRON grid background. Used by IntroBumper and as an optional underlay in other scenes.

- [ ] **Step 1: Create `packages/video/src/components/TronGrid.tsx`**

```tsx
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { ACCENT_CYAN, BG_DARK } from '../tokens';

interface TronGridProps {
  opacity?: number;  // 0–1, default 1
}

export const TronGrid: React.FC<TronGridProps> = ({ opacity = 1 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Slow horizontal scan line sweeping downward
  const scanY = interpolate(frame, [0, 300], [0, height], { extrapolateRight: 'wrap' });

  return (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundColor: BG_DARK,
      opacity,
      overflow: 'hidden',
    }}>
      {/* Grid lines — SVG for crisp rendering */}
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0 }}
      >
        <defs>
          <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke={ACCENT_CYAN}
              strokeWidth="0.5"
              strokeOpacity="0.12"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        {/* Sweep line */}
        <rect
          x={0}
          y={scanY}
          width={width}
          height={2}
          fill={ACCENT_CYAN}
          opacity={0.06}
        />
      </svg>

      {/* Radial glow at center */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 80% 50% at 50% 50%, rgba(0,240,255,0.05) 0%, transparent 70%)`,
      }} />
    </div>
  );
};
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
npm run typecheck --workspace=packages/video
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/components/TronGrid.tsx
git commit -m "feat(video): add TronGrid shared component"
```

---

### Task 4: ModelBadge component

**Files:**
- Create: `packages/video/src/components/ModelBadge.tsx`

- [ ] **Step 1: Create `packages/video/src/components/ModelBadge.tsx`**

```tsx
import { ORBITRON } from '../tokens';
import { hexToRgb } from '../utils';

interface ModelBadgeProps {
  model: string;    // e.g. "claude"
  persona: string;  // e.g. "architect"
  color: string;    // hex
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_MAP = {
  sm: { model: 28, persona: 18, padding: '6px 14px', gap: 4 },
  md: { model: 42, persona: 24, padding: '10px 20px', gap: 6 },
  lg: { model: 60, persona: 28, padding: '14px 28px', gap: 8 },
};

export const ModelBadge: React.FC<ModelBadgeProps> = ({ model, persona, color, size = 'md' }) => {
  const s = SIZE_MAP[size];

  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: s.padding,
      background: `rgba(${hexToRgb(color)}, 0.12)` as string,
      border: `1.5px solid rgba(${hexToRgb(color)}, 0.5)`,
      borderRadius: 8,
      gap: s.gap,
    }}>
      <div style={{
        fontFamily: ORBITRON,
        fontSize: s.model,
        fontWeight: 900,
        color,
        letterSpacing: '2px',
        textTransform: 'uppercase',
        textShadow: `0 0 20px rgba(${hexToRgb(color)}, 0.6)`,
      }}>
        {model.toUpperCase()}
      </div>
      <div style={{
        fontFamily: ORBITRON,
        fontSize: s.persona,
        fontWeight: 400,
        color: `rgba(${hexToRgb(color)}, 0.7)`,
        letterSpacing: '4px',
        textTransform: 'uppercase',
      }}>
        :{persona}
      </div>
    </div>
  );
};

// hexToRgb imported from '../utils'
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/components/ModelBadge.tsx
git commit -m "feat(video): add ModelBadge shared component"
```

---

### Task 5: ScoreBar component

**Files:**
- Create: `packages/video/src/components/ScoreBar.tsx`

Animated dual progress bar for two teams side-by-side, used in ScoreReveal scene.

- [ ] **Step 1: Create `packages/video/src/components/ScoreBar.tsx`**

```tsx
import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';
import { TEXT_DIM, TEXT_PRIMARY } from '../tokens';
import { hexToRgb } from '../utils';

interface ScoreBarProps {
  label: string;
  teamA: { score: number; color: string; label: string };
  teamB: { score: number; color: string; label: string };
  /** Frame at which the animation starts (relative to the scene, not composition) */
  startFrame: number;
  /** Optional commentary text shown below */
  commentary?: string;
}

export const ScoreBar: React.FC<ScoreBarProps> = ({ label, teamA, teamB, startFrame, commentary }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: Math.max(0, frame - startFrame),
    fps,
    config: { damping: 200, stiffness: 100, mass: 0.5 },
  });

  const scoreA = interpolate(progress, [0, 1], [0, teamA.score]);
  const scoreB = interpolate(progress, [0, 1], [0, teamB.score]);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 22, color: TEXT_DIM, letterSpacing: '2px', marginBottom: 8, textTransform: 'uppercase' }}>
        {label}
      </div>

      {/* Team A bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div style={{ width: 120, fontSize: 20, color: teamA.color, textAlign: 'right', flexShrink: 0 }}>
          {teamA.label}
        </div>
        <div style={{ flex: 1, height: 16, background: `rgba(255,255,255,0.06)`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{
            width: `${scoreA * 100}%`,
            height: '100%',
            background: teamA.color,
            borderRadius: 8,
            boxShadow: `0 0 12px rgba(${hexToRgb(teamA.color)}, 0.5)`,
            transition: 'none',
          }} />
        </div>
        <div style={{ width: 60, fontSize: 22, color: teamA.color, fontWeight: 700, flexShrink: 0 }}>
          {Math.round(scoreA * 100)}%
        </div>
      </div>

      {/* Team B bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: commentary ? 10 : 0 }}>
        <div style={{ width: 120, fontSize: 20, color: teamB.color, textAlign: 'right', flexShrink: 0 }}>
          {teamB.label}
        </div>
        <div style={{ flex: 1, height: 16, background: `rgba(255,255,255,0.06)`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{
            width: `${scoreB * 100}%`,
            height: '100%',
            background: teamB.color,
            borderRadius: 8,
            boxShadow: `0 0 12px rgba(${hexToRgb(teamB.color)}, 0.5)`,
            transition: 'none',
          }} />
        </div>
        <div style={{ width: 60, fontSize: 22, color: teamB.color, fontWeight: 700, flexShrink: 0 }}>
          {Math.round(scoreB * 100)}%
        </div>
      </div>

      {commentary && (
        <div style={{ fontSize: 18, color: TEXT_DIM, fontStyle: 'italic', paddingLeft: 132, lineHeight: 1.5 }}>
          {commentary}
        </div>
      )}
    </div>
  );
};

// hexToRgb imported from '../utils'
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/components/ScoreBar.tsx
git commit -m "feat(video): add ScoreBar shared component"
```

---

### Task 6: EventRow component

**Files:**
- Create: `packages/video/src/components/EventRow.tsx`

Single key-moment row used in the KeyMoments scene.

- [ ] **Step 1: Create `packages/video/src/components/EventRow.tsx`**

```tsx
import { TEXT_PRIMARY, TEXT_DIM, MONO } from '../tokens';
import { hexToRgb } from '../utils';

interface EventRowProps {
  moment: {
    relativeMs: number;
    teamId: string;
    label: string;
    type: 'FILE_CREATE' | 'TOOL_CALL' | 'ERROR';
  };
  teamColor: string;
  teamLabel: string;
  opacity?: number;
}

const TYPE_ICONS: Record<string, string> = {
  FILE_CREATE: '📄',
  TOOL_CALL:   '⚡',
  ERROR:       '⚠',
};

function formatRelativeTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem.toString().padStart(2, '0')}s`;
}

export const EventRow: React.FC<EventRowProps> = ({ moment, teamColor, teamLabel, opacity = 1 }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '14px 20px',
    background: `rgba(${hexToRgb(teamColor)}, 0.08)`,
    borderLeft: `3px solid ${teamColor}`,
    borderRadius: '0 8px 8px 0',
    marginBottom: 12,
    opacity,
  }}>
    <div style={{ fontSize: 20, width: 28, flexShrink: 0 }}>
      {TYPE_ICONS[moment.type] ?? '◆'}
    </div>
    <div style={{ fontSize: 20, color: teamColor, width: 80, flexShrink: 0, fontFamily: MONO }}>
      {formatRelativeTime(moment.relativeMs)}
    </div>
    <div style={{ fontSize: 20, color: teamColor, fontWeight: 700, width: 160, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>
      {teamLabel}
    </div>
    <div style={{ fontSize: 22, color: TEXT_PRIMARY, flex: 1, fontFamily: MONO }}>
      {moment.label}
    </div>
  </div>
);

// hexToRgb imported from '../utils'
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/components/EventRow.tsx
git commit -m "feat(video): add EventRow shared component"
```

---

## Chunk 3: Scenes Part 1 (IntroBumper → KeyMoments)

### Task 7: IntroBumper scene

**Files:**
- Create: `packages/video/src/scenes/IntroBumper.tsx`

Frames 0–90 (3s). Arena4Ai logo animates in on TRON grid. "COMPETITION RECAP" text flashes in below.

- [ ] **Step 1: Create `packages/video/src/scenes/IntroBumper.tsx`**

```tsx
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { TronGrid } from '../components/TronGrid';
import { ACCENT_CYAN, ACCENT_ORANGE, ORBITRON, TEXT_MUTED } from '../tokens';

export const IntroBumper: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo fades + scales in over first 20 frames
  const logoProgress = spring({ frame, fps, config: { damping: 200, stiffness: 120 } });
  const logoOpacity = interpolate(logoProgress, [0, 1], [0, 1]);
  const logoScale  = interpolate(logoProgress, [0, 1], [0.7, 1]);

  // "COMPETITION RECAP" fades in at frame 20
  const textProgress = spring({ frame: Math.max(0, frame - 20), fps, config: { damping: 200, stiffness: 100 } });
  const textOpacity = interpolate(textProgress, [0, 1], [0, 1]);
  const textY       = interpolate(textProgress, [0, 1], [20, 0]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <TronGrid />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        {/* ARENA4AI logo */}
        <div style={{
          fontFamily: ORBITRON,
          fontSize: 96,
          fontWeight: 900,
          letterSpacing: '8px',
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
        }}>
          <span style={{ color: ACCENT_CYAN }}>ARENA</span>
          <span style={{ color: ACCENT_ORANGE }}>4</span>
          <span style={{ color: ACCENT_CYAN }}>AI</span>
        </div>

        {/* Divider line */}
        <div style={{
          width: interpolate(logoProgress, [0, 1], [0, 300]),
          height: 1,
          background: ACCENT_CYAN,
          margin: '20px auto',
          opacity: 0.5,
          boxShadow: `0 0 8px ${ACCENT_CYAN}`,
        }} />

        {/* COMPETITION RECAP label */}
        <div style={{
          fontFamily: ORBITRON,
          fontSize: 36,
          fontWeight: 400,
          letterSpacing: '12px',
          color: TEXT_MUTED,
          textTransform: 'uppercase',
          opacity: textOpacity,
          transform: `translateY(${textY}px)`,
        }}>
          COMPETITION RECAP
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/scenes/IntroBumper.tsx
git commit -m "feat(video): add IntroBumper scene"
```

---

### Task 8: Matchup scene

**Files:**
- Create: `packages/video/src/scenes/Matchup.tsx`

Frames 90–210 (4s). Team A vs Team B card. Both badges animate in from sides, "VS" pulses in center, brief title fades below.

- [ ] **Step 1: Create `packages/video/src/scenes/Matchup.tsx`**

```tsx
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { ModelBadge } from '../components/ModelBadge';
import { TronGrid } from '../components/TronGrid';
import type { ReelData } from '../types';
import { ACCENT_CYAN, TEXT_DIM, ORBITRON } from '../tokens';

interface MatchupProps {
  data: Pick<ReelData, 'teams' | 'briefTitle'>;
}

export const Matchup: React.FC<MatchupProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const [teamA, teamB] = data.teams;

  // Left team slides in from left
  const leftProgress = spring({ frame, fps, config: { damping: 200, stiffness: 80 } });
  const leftX = interpolate(leftProgress, [0, 1], [-300, 0]);

  // Right team slides in from right
  const rightProgress = spring({ frame: Math.max(0, frame - 8), fps, config: { damping: 200, stiffness: 80 } });
  const rightX = interpolate(rightProgress, [0, 1], [300, 0]);

  // VS pulses in at frame 20
  const vsProgress = spring({ frame: Math.max(0, frame - 20), fps, config: { damping: 300, stiffness: 150 } });
  const vsScale   = interpolate(vsProgress, [0, 1], [0, 1]);
  const vsOpacity = interpolate(vsProgress, [0, 1], [0, 1]);

  // Brief title fades in at frame 50
  const titleOpacity = interpolate(frame, [50, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 48 }}>
      <TronGrid opacity={0.5} />

      {/* Team matchup row */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 40 }}>
        <div style={{ transform: `translateX(${leftX}px)` }}>
          <ModelBadge model={teamA.model} persona={teamA.persona} color={teamA.color} size="lg" />
        </div>

        <div style={{
          fontFamily: ORBITRON,
          fontSize: 64,
          fontWeight: 900,
          color: ACCENT_CYAN,
          textShadow: `0 0 30px rgba(0,240,255,0.8)`,
          transform: `scale(${vsScale})`,
          opacity: vsOpacity,
          minWidth: 80,
          textAlign: 'center',
        }}>
          VS
        </div>

        <div style={{ transform: `translateX(${rightX}px)` }}>
          <ModelBadge model={teamB.model} persona={teamB.persona} color={teamB.color} size="lg" />
        </div>
      </div>

      {/* Brief title */}
      <div style={{
        position: 'relative', zIndex: 1,
        fontFamily: ORBITRON,
        fontSize: 32,
        color: TEXT_DIM,
        letterSpacing: '3px',
        textAlign: 'center',
        opacity: titleOpacity,
        paddingLeft: 60,
        paddingRight: 60,
      }}>
        {data.briefTitle.toUpperCase()}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/scenes/Matchup.tsx
git commit -m "feat(video): add Matchup scene"
```

---

### Task 9: TheBrief scene

**Files:**
- Create: `packages/video/src/scenes/TheBrief.tsx`

Frames 210–330 (4s). Challenge title, 1-line description, criteria listed one-by-one.

- [ ] **Step 1: Create `packages/video/src/scenes/TheBrief.tsx`**

```tsx
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { ACCENT_CYAN, TEXT_PRIMARY, TEXT_DIM, BG_DARK, ORBITRON } from '../tokens';

interface TheBriefProps {
  data: Pick<ReelData, 'briefTitle' | 'briefDescription' | 'criteria'>;
}

export const TheBrief: React.FC<TheBriefProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Kicker fades in
  const kickerOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  // Title fades in at frame 10
  const titleOpacity = interpolate(frame, [10, 25], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Description at frame 20
  const descOpacity = interpolate(frame, [20, 35], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Each criterion fades in staggered (every 15 frames starting at frame 35)
  const criteriaOpacities = data.criteria.map((_, i) =>
    interpolate(frame, [35 + i * 15, 50 + i * 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  );

  return (
    <div style={{
      width: '100%', height: '100%',
      background: BG_DARK,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '0 72px',
    }}>
      {/* Kicker */}
      <div style={{
        fontSize: 22, color: ACCENT_CYAN, letterSpacing: '6px',
        textTransform: 'uppercase', marginBottom: 20, opacity: kickerOpacity,
        fontFamily: ORBITRON,
      }}>
        ◆ THE CHALLENGE
      </div>

      {/* Title */}
      <div style={{
        fontFamily: ORBITRON,
        fontSize: 56,
        fontWeight: 900,
        color: TEXT_PRIMARY,
        lineHeight: 1.2,
        marginBottom: 24,
        opacity: titleOpacity,
        background: `linear-gradient(135deg, #c8eef8, ${ACCENT_CYAN}, #0080ff)`,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        {data.briefTitle}
      </div>

      {/* Description */}
      <div style={{
        fontSize: 28, color: TEXT_MUTED, lineHeight: 1.6,
        marginBottom: 48, opacity: descOpacity,
      }}>
        {data.briefDescription}
      </div>

      {/* Criteria */}
      <div>
        <div style={{ fontSize: 20, color: TEXT_DIM, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: 16, fontFamily: ORBITRON }}>
          JUDGED ON
        </div>
        {data.criteria.map((criterion, i) => (
          <div key={criterion} style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '12px 20px', marginBottom: 10,
            background: `rgba(0,240,255,0.06)`,
            borderLeft: `3px solid ${ACCENT_CYAN}`,
            borderRadius: '0 6px 6px 0',
            opacity: criteriaOpacities[i],
          }}>
            <div style={{ fontSize: 22, color: ACCENT_CYAN }}>◆</div>
            <div style={{ fontSize: 26, color: TEXT_PRIMARY }}>{criterion}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/scenes/TheBrief.tsx
git commit -m "feat(video): add TheBrief scene"
```

---

### Task 10: KeyMoments scene

**Files:**
- Create: `packages/video/src/scenes/KeyMoments.tsx`

Frames 330–570 (8s). 3–5 key moment rows stagger in, each with team color, timestamp, and label.

- [ ] **Step 1: Create `packages/video/src/scenes/KeyMoments.tsx`**

```tsx
import { useCurrentFrame, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { EventRow } from '../components/EventRow';
import { ACCENT_CYAN, TEXT_DIM, ORBITRON, BG_DARK } from '../tokens';

interface KeyMomentsProps {
  data: Pick<ReelData, 'keyMoments' | 'teams'>;
}

export const KeyMoments: React.FC<KeyMomentsProps> = ({ data }) => {
  const frame = useCurrentFrame();

  // Title fades in
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  // Each moment fades in staggered (every 25 frames starting at frame 20)
  const momentOpacities = data.keyMoments.map((_, i) =>
    interpolate(frame, [20 + i * 25, 40 + i * 25], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  );

  // Build team color lookup
  const teamColorMap = Object.fromEntries(data.teams.map(t => [t.teamId, t.color]));
  const teamLabelMap = Object.fromEntries(data.teams.map(t => [t.teamId, t.model.toUpperCase()]));

  return (
    <div style={{
      width: '100%', height: '100%',
      background: BG_DARK,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '0 72px',
    }}>
      {/* Section header */}
      <div style={{ opacity: titleOpacity, marginBottom: 40 }}>
        <div style={{ fontSize: 22, color: ACCENT_CYAN, letterSpacing: '6px', textTransform: 'uppercase', fontFamily: ORBITRON, marginBottom: 8 }}>
          ◆ KEY MOMENTS
        </div>
        <div style={{ fontSize: 24, color: TEXT_DIM }}>
          How the battle unfolded
        </div>
      </div>

      {/* Moment rows */}
      {data.keyMoments.map((moment, i) => (
        <EventRow
          key={i}
          moment={moment}
          teamColor={teamColorMap[moment.teamId] ?? '#4a8fa8'}
          teamLabel={teamLabelMap[moment.teamId] ?? moment.teamId}
          opacity={momentOpacities[i]}
        />
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/scenes/KeyMoments.tsx
git commit -m "feat(video): add KeyMoments scene"
```

---

## Chunk 4: Scenes Part 2 (ScoreReveal → Outro)

### Task 11: ScoreReveal scene

**Files:**
- Create: `packages/video/src/scenes/ScoreReveal.tsx`

Frames 570–900 (11s). Criterion-by-criterion score bars animate in sequentially, with judge commentary.

- [ ] **Step 1: Create `packages/video/src/scenes/ScoreReveal.tsx`**

```tsx
import { useCurrentFrame, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { ScoreBar } from '../components/ScoreBar';
import { ACCENT_CYAN, TEXT_DIM, ORBITRON, BG_DARK } from '../tokens';

interface ScoreRevealProps {
  data: Pick<ReelData, 'teams' | 'criteria'>;
}

export const ScoreReveal: React.FC<ScoreRevealProps> = ({ data }) => {
  const frame = useCurrentFrame();

  const [teamA, teamB] = data.teams;
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <div style={{
      width: '100%', height: '100%',
      background: BG_DARK,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '0 72px',
    }}>
      {/* Header */}
      <div style={{ opacity: titleOpacity, marginBottom: 40 }}>
        <div style={{ fontSize: 22, color: ACCENT_CYAN, letterSpacing: '6px', textTransform: 'uppercase', fontFamily: ORBITRON, marginBottom: 8 }}>
          ◆ SCORES
        </div>
        {/* Team labels */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 132 }}>
          <div style={{ fontSize: 22, color: teamA.color, fontWeight: 700, width: 'calc(50% - 60px)' }}>
            {teamA.model.toUpperCase()}
          </div>
          <div style={{ fontSize: 22, color: teamB.color, fontWeight: 700, width: 'calc(50% - 60px)' }}>
            {teamB.model.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Criterion bars — each bar starts animating 40 frames apart */}
      {data.criteria.map((criterion, i) => {
        const aScore = teamA.criteriaScores.find(s => s.name === criterion);
        const bScore = teamB.criteriaScores.find(s => s.name === criterion);

        return (
          <ScoreBar
            key={criterion}
            label={criterion}
            teamA={{ score: aScore?.score ?? 0, color: teamA.color, label: teamA.model.toUpperCase() }}
            teamB={{ score: bScore?.score ?? 0, color: teamB.color, label: teamB.model.toUpperCase() }}
            startFrame={15 + i * 40}
            commentary={aScore?.commentary}
          />
        );
      })}
    </div>
  );
};
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/scenes/ScoreReveal.tsx
git commit -m "feat(video): add ScoreReveal scene"
```

---

### Task 12: Winner scene

**Files:**
- Create: `packages/video/src/scenes/Winner.tsx`

Frames 900–990 (3s). Winner model name glows with TRON flash, final score %, optional synthesis quote.

- [ ] **Step 1: Create `packages/video/src/scenes/Winner.tsx`**

```tsx
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { TronGrid } from '../components/TronGrid';
import { ACCENT_CYAN, ORBITRON, TEXT_MUTED, TEXT_DIM } from '../tokens';
import { hexToRgb } from '../utils';

interface WinnerProps {
  data: Pick<ReelData, 'teams' | 'winnerId' | 'synthesisQuote'>;
}

export const Winner: React.FC<WinnerProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const winner = data.teams.find(t => t.teamId === data.winnerId) ?? data.teams[0];

  // Winner name springs in
  const nameProgress = spring({ frame, fps, config: { damping: 200, stiffness: 80 } });
  const nameScale   = interpolate(nameProgress, [0, 1], [0.5, 1]);
  const nameOpacity = interpolate(nameProgress, [0, 1], [0, 1]);

  // Glow pulses: 0→1→0 over full scene
  const glowIntensity = interpolate(frame, [0, 30, 60, 90], [0, 1, 0.7, 1], { extrapolateRight: 'clamp' });

  // Score fades in at frame 30
  const scoreOpacity = interpolate(frame, [30, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Synthesis quote fades at frame 50
  const quoteOpacity = interpolate(frame, [50, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const glowColor = winner.color;
  const glow = `0 0 ${40 * glowIntensity}px rgba(${hexToRgb(glowColor)}, ${0.8 * glowIntensity})`;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <TronGrid opacity={0.4} />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        {/* WINNER label */}
        <div style={{
          fontFamily: ORBITRON, fontSize: 28, letterSpacing: '10px',
          color: TEXT_DIM, textTransform: 'uppercase', marginBottom: 16,
          opacity: nameOpacity,
        }}>
          ◆ WINNER ◆
        </div>

        {/* Winner model name */}
        <div style={{
          fontFamily: ORBITRON,
          fontSize: 120,
          fontWeight: 900,
          color: glowColor,
          textShadow: glow,
          letterSpacing: '4px',
          textTransform: 'uppercase',
          transform: `scale(${nameScale})`,
          opacity: nameOpacity,
        }}>
          {winner.model.toUpperCase()}
        </div>

        {/* Persona + score */}
        <div style={{ opacity: scoreOpacity, marginTop: 16 }}>
          <div style={{ fontSize: 32, color: TEXT_MUTED, letterSpacing: '4px' }}>
            :{winner.persona} · {Math.round(winner.score * 100)}%
          </div>
        </div>

        {/* Synthesis quote */}
        {data.synthesisQuote && (
          <div style={{
            fontSize: 24, color: TEXT_DIM, fontStyle: 'italic',
            maxWidth: 800, lineHeight: 1.6, marginTop: 32,
            opacity: quoteOpacity, textAlign: 'center', paddingLeft: 40, paddingRight: 40,
          }}>
            "{data.synthesisQuote}"
          </div>
        )}
      </div>
    </div>
  );
};

// hexToRgb imported from '../utils'
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/scenes/Winner.tsx
git commit -m "feat(video): add Winner scene"
```

---

### Task 13: GoDeeper scene

**Files:**
- Create: `packages/video/src/scenes/GoDeeper.tsx`

Frames 990–1170 (6s). Premium feature cards for Synthesis and Forge animate in sequentially with gold accent.

- [ ] **Step 1: Create `packages/video/src/scenes/GoDeeper.tsx`**

```tsx
import { useCurrentFrame, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { ACCENT_CYAN, ACCENT_ORANGE, ACCENT_GOLD, TEXT_MUTED, TEXT_DIM, ORBITRON, BG_DARK } from '../tokens';

interface GoDeeperProps {
  data: Pick<ReelData, 'hasSynthesis' | 'hasForge'>;
}

export const GoDeeper: React.FC<GoDeeperProps> = ({ data }) => {
  const frame = useCurrentFrame();

  const kickerOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  // Synthesis card fades + slides in at frame 25
  const synthOpacity = interpolate(frame, [25, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const synthY       = interpolate(frame, [25, 50], [30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Forge card fades + slides in at frame 55
  const forgeOpacity = interpolate(frame, [55, 80], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const forgeY       = interpolate(frame, [55, 80], [30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // CTA fades in at frame 100
  const ctaOpacity = interpolate(frame, [100, 130], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{
      width: '100%', height: '100%',
      background: BG_DARK,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '0 72px',
    }}>
      {/* Kicker */}
      <div style={{ opacity: kickerOpacity, marginBottom: 40 }}>
        <div style={{ fontSize: 22, color: ACCENT_GOLD, letterSpacing: '6px', textTransform: 'uppercase', fontFamily: ORBITRON, marginBottom: 8 }}>
          ✦ GO DEEPER
        </div>
        <div style={{ fontSize: 30, color: TEXT_DIM }}>
          Unlock premium analysis
        </div>
      </div>

      {/* Synthesis + Forge cards always shown as promotional content regardless of hasSynthesis/hasForge.
          The boolean props are reserved for future conditional rendering (e.g., show "activated" vs "available"). */}
      {(data.hasSynthesis || true) && (
        <div style={{
          padding: '28px 32px',
          background: `rgba(0,240,255,0.07)`,
          border: `1.5px solid rgba(0,240,255,0.25)`,
          borderRadius: 12,
          marginBottom: 20,
          opacity: synthOpacity,
          transform: `translateY(${synthY}px)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
            <div style={{ fontSize: 32 }}>◈</div>
            <div style={{ fontFamily: ORBITRON, fontSize: 32, fontWeight: 700, color: ACCENT_CYAN, letterSpacing: '2px' }}>
              SYNTHESIS
            </div>
          </div>
          <div style={{ fontSize: 26, color: TEXT_MUTED, lineHeight: 1.5 }}>
            AI cross-analysis of what each approach got right — per criterion
          </div>
        </div>
      )}

      {/* Forge card */}
      {(data.hasForge || true) && (
        <div style={{
          padding: '28px 32px',
          background: `rgba(255,102,0,0.07)`,
          border: `1.5px solid rgba(255,102,0,0.25)`,
          borderRadius: 12,
          marginBottom: 40,
          opacity: forgeOpacity,
          transform: `translateY(${forgeY}px)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
            <div style={{ fontSize: 32 }}>⚡</div>
            <div style={{ fontFamily: ORBITRON, fontSize: 32, fontWeight: 700, color: ACCENT_ORANGE, letterSpacing: '2px' }}>
              FORGE
            </div>
          </div>
          <div style={{ fontSize: 26, color: TEXT_MUTED, lineHeight: 1.5 }}>
            Turn the winner's solution into a full project blueprint
          </div>
        </div>
      )}

      {/* CTA */}
      <div style={{ fontSize: 26, color: ACCENT_GOLD, letterSpacing: '3px', opacity: ctaOpacity, fontFamily: ORBITRON }}>
        Available on arena4.ai
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/scenes/GoDeeper.tsx
git commit -m "feat(video): add GoDeeper scene"
```

---

### Task 14: Outro scene

**Files:**
- Create: `packages/video/src/scenes/Outro.tsx`

Frames 1170–1260 (3s). Arena4Ai logo fades in, URL and CTA below.

- [ ] **Step 1: Create `packages/video/src/scenes/Outro.tsx`**

```tsx
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { TronGrid } from '../components/TronGrid';
import { ACCENT_CYAN, ACCENT_ORANGE, TEXT_DIM, TEXT_MUTED, ORBITRON } from '../tokens';

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({ frame, fps, config: { damping: 200, stiffness: 80 } });
  const opacity  = interpolate(progress, [0, 1], [0, 1]);
  const scale    = interpolate(progress, [0, 1], [0.85, 1]);

  const subtitleOpacity = interpolate(frame, [20, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
      <TronGrid />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', opacity, transform: `scale(${scale})` }}>
        {/* Logo */}
        <div style={{ fontFamily: ORBITRON, fontSize: 80, fontWeight: 900, letterSpacing: '6px' }}>
          <span style={{ color: ACCENT_CYAN }}>ARENA</span>
          <span style={{ color: ACCENT_ORANGE }}>4</span>
          <span style={{ color: ACCENT_CYAN }}>AI</span>
        </div>

        <div style={{ width: 200, height: 1, background: ACCENT_CYAN, margin: '16px auto', opacity: 0.4 }} />

        {/* URL */}
        <div style={{
          fontFamily: ORBITRON, fontSize: 28, color: TEXT_DIM,
          letterSpacing: '4px', marginBottom: 20,
          opacity: subtitleOpacity,
        }}>
          arena4.ai
        </div>

        {/* CTA */}
        <div style={{
          fontSize: 24, color: TEXT_MUTED,
          letterSpacing: '2px',
          opacity: subtitleOpacity,
        }}>
          Watch more battles →
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/scenes/Outro.tsx
git commit -m "feat(video): add Outro scene"
```

---

## Chunk 5: Composition Assembly + Studio Test

### Task 15: Root.tsx and CompetitionRecap.tsx

**Files:**
- Create: `packages/video/src/compositions/CompetitionRecap.tsx`
- Create: `packages/video/src/Root.tsx`

- [ ] **Step 1: Create `packages/video/src/compositions/CompetitionRecap.tsx`**

```tsx
import { Sequence } from 'remotion';
import type { ReelData } from '../types';
import { IntroBumper }  from '../scenes/IntroBumper';
import { Matchup }      from '../scenes/Matchup';
import { TheBrief }     from '../scenes/TheBrief';
import { KeyMoments }   from '../scenes/KeyMoments';
import { ScoreReveal }  from '../scenes/ScoreReveal';
import { Winner }       from '../scenes/Winner';
import { GoDeeper }     from '../scenes/GoDeeper';
import { Outro }        from '../scenes/Outro';

// Scene timing table (from spec)
// IntroBumper:  from=0,    duration=90
// Matchup:      from=90,   duration=120
// TheBrief:     from=210,  duration=120
// KeyMoments:   from=330,  duration=240
// ScoreReveal:  from=570,  duration=330
// Winner:       from=900,  duration=90
// GoDeeper:     from=990,  duration=180
// Outro:        from=1170, duration=90
// Total: 1260 frames

export const CompetitionRecap: React.FC<ReelData> = (data) => (
  <div style={{ width: '100%', height: '100%', overflow: 'hidden', fontFamily: '"Orbitron", sans-serif' }}>
    <Sequence from={0}    durationInFrames={90}>  <IntroBumper /> </Sequence>
    <Sequence from={90}   durationInFrames={120}> <Matchup    data={data} /> </Sequence>
    <Sequence from={210}  durationInFrames={120}> <TheBrief   data={data} /> </Sequence>
    <Sequence from={330}  durationInFrames={240}> <KeyMoments data={data} /> </Sequence>
    <Sequence from={570}  durationInFrames={330}> <ScoreReveal data={data} /> </Sequence>
    <Sequence from={900}  durationInFrames={90}>  <Winner     data={data} /> </Sequence>
    <Sequence from={990}  durationInFrames={180}> <GoDeeper   data={data} /> </Sequence>
    <Sequence from={1170} durationInFrames={90}>  <Outro /> </Sequence>
  </div>
);
```

- [ ] **Step 2: Create `packages/video/src/Root.tsx`**

```tsx
import { Composition, delayRender, continueRender } from 'remotion';
import { useState, useEffect } from 'react';
import { loadFont } from '@remotion/google-fonts/Orbitron';
import { CompetitionRecap } from './compositions/CompetitionRecap';
import { mockReelData } from './mock';
import { COMPOSITION_ID } from './index';
import type { ReelData } from './types';

const { waitUntilDone } = loadFont();

// FontLoader: ensures Orbitron is loaded before any frame is captured.
// Uses useState + useEffect to call delayRender exactly once.
const FontLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender('Loading Orbitron font'));

  useEffect(() => {
    waitUntilDone().then(() => continueRender(handle));
  }, [handle]);

  return <>{children}</>;
};

export const RemotionRoot: React.FC = () => (
  <FontLoader>
    <Composition
      id={COMPOSITION_ID}
      component={CompetitionRecap}
      durationInFrames={1260}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={mockReelData}
      schema={undefined}
    />
  </FontLoader>
);
```

- [ ] **Step 3: Verify types**

```bash
npm run typecheck --workspace=packages/video
```

- [ ] **Step 4: Commit**

```bash
git add packages/video/src/compositions/ packages/video/src/Root.tsx
git commit -m "feat(video): wire up CompetitionRecap composition and Root"
```

---

### Task 16: Remotion Studio smoke test

- [ ] **Step 1: Install Remotion browser if needed**

```bash
cd "/Users/kstefano/Personal Projects/agentarena/packages/video"
npx remotion browser ensure
```

Expected: Chromium installed or already present.

- [ ] **Step 2: Launch Remotion Studio**

**Important:** The orchestrator API server runs on port 3000. Use port 3002 to avoid conflict.

```bash
cd "/Users/kstefano/Personal Projects/agentarena/packages/video"
npx remotion studio src/Root.tsx --port 3002
```

Expected: Browser opens at `http://localhost:3002` (Remotion Studio). `CompetitionRecap` composition visible in the sidebar.

- [ ] **Step 3: Scrub through all 1260 frames**

Drag the scrubber from 0 to 1260. Verify:
- Frame 0–90: ARENA4AI logo + "COMPETITION RECAP" on TRON grid ✓
- Frame 90–210: CLAUDE vs CODEX matchup with VS between ✓
- Frame 210–330: Brief title + criteria list ✓
- Frame 330–570: Key moment rows ✓
- Frame 570–900: Score bars per criterion ✓
- Frame 900–990: Winner glow ✓
- Frame 990–1170: GoDeeper Synthesis + Forge cards ✓
- Frame 1170–1260: Outro logo ✓

Fix any visual issues before proceeding.

- [ ] **Step 4: Commit any fixes found during studio review**

```bash
git add -A
git commit -m "fix(video): visual adjustments from Remotion Studio review"
```

---

## Chunk 6: Web Integration

### Task 17: Add workspace dependency and bundle singleton

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/web/tsconfig.json`
- Create: `packages/web/lib/remotion-bundle.ts`

- [ ] **Step 1: Update `packages/web/package.json`**

Add to `"dependencies"`:
```json
"@arena/video": "*",
"@remotion/renderer": "^4.0.0",
"@remotion/bundler": "^4.0.0"
```

The full dependencies section should now include those three entries. The `"@arena/video": "*"` uses `*` instead of `workspace:*` because npm workspaces resolve by package name automatically.

- [ ] **Step 2: Update `packages/web/tsconfig.json`**

Add `paths` to `compilerOptions` so Next.js can resolve `@arena/video` to the source directly during development without a build step:

```json
"paths": {
  "@arena/video": ["../video/src/index.ts"],
  "@arena/video/*": ["../video/src/*"]
}
```

If a `paths` key already exists, add these entries to it.

- [ ] **Step 3: Install new dependencies**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
npm install
```

Expected: `@remotion/renderer`, `@remotion/bundler` installed in `packages/web/node_modules`.

- [ ] **Step 4: Create `packages/web/lib/remotion-bundle.ts`**

```ts
import { bundle } from '@remotion/bundler';
import path from 'path';

// Promise-singleton: bundle() is called at most once per process lifetime.
// Two simultaneous POST /reel requests both await the same promise safely.
let bundlePromise: Promise<string> | null = null;

export function getBundle(): Promise<string> {
  if (!bundlePromise) {
    // path.resolve from this file: packages/web/lib/remotion-bundle.ts
    // → packages/video/src/index.ts
    const entryPoint = path.resolve(__dirname, '../../video/src/index.ts');
    bundlePromise = bundle({ entryPoint });
  }
  return bundlePromise;
}
```

- [ ] **Step 5: Verify web package typechecks**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: No errors related to `@arena/video` or `@remotion/*`.

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json packages/web/tsconfig.json packages/web/lib/remotion-bundle.ts
git commit -m "feat(web): add @arena/video and remotion renderer dependencies, add bundle singleton"
```

---

### Task 18: Reel render API route (POST + GET)

**Files:**
- Create: `packages/web/app/api/competitions/[id]/reel/route.ts`

- [ ] **Step 1: Create `packages/web/app/api/competitions/[id]/reel/route.ts`**

```ts
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

function buildReelData(competition: any, events: any[]): ReelData {
  const { brief, teams, startedAt, result } = competition;
  const startMs = new Date(startedAt).getTime();

  // Build criteria name list from brief rubric
  const criteriaMap: Record<string, string> = {};
  (brief.rubric?.criteria ?? []).forEach((c: any) => {
    criteriaMap[c.id] = c.description;
  });
  const criteriaNames = (brief.rubric?.criteria ?? []).map((c: any) => c.description);

  // Build teams
  const reelTeams: ReelTeam[] = teams.map((team: any) => {
    const model = team.model.split(':')[0];
    const persona = team.model.split(':')[1] ?? '';
    // result.scorecards (not result.teams) holds the per-team scores
    const scorecard = result?.scorecards?.find((s: any) => s.teamId === team.id);

    return {
      teamId: team.id,
      label: team.model,
      model,
      persona,
      color: getModelColor(model),
      // totalScore (= finalScore from score-aggregator.ts) is already 0–1
      score: scorecard?.totalScore ?? 0,
      criteriaScores: (scorecard?.criteriaScores ?? []).map((cs: any) => ({
        name: criteriaMap[cs.criterionId] ?? cs.criterionId,
        // cs.score is raw (0–maxScore), cs.maxScore typically 10
        score: cs.maxScore > 0 ? cs.score / cs.maxScore : cs.score,
        commentary: cs.commentary ?? '',
      })),
    };
  });

  // Key moments auto-selection
  const teamIds = teams.map((t: any) => t.id);
  const fileCreates: any[] = [];
  const toolCallBursts: any[] = [];
  const errors: any[] = [];

  for (const evt of events) {
    if (evt.type === 'FILE_CREATE' && !fileCreates.find(e => e.teamId === evt.teamId)) {
      fileCreates.push(evt);
    }
    if (evt.type === 'TOOL_CALL') toolCallBursts.push(evt);
    if (evt.type === 'ERROR') errors.push(evt);
  }

  // Pick the densest TOOL_CALL burst (highest count in any 10s window)
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
    ...fileCreates.map(e => ({
      relativeMs: new Date(e.timestamp).getTime() - startMs,
      teamId: e.teamId,
      label: (() => {
        try { return `Created ${(e.payload as any)?.path?.split('/').pop() ?? 'file'}`; } catch { return 'Created file'; }
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
  } catch (err: any) {
    if (err.code === 'EEXIST') {
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
  const events: any[] = eventsRes.ok ? await eventsRes.json() : [];

  // Transform data
  const reelData = buildReelData(competition, events);

  // Fire-and-forget render
  void (async () => {
    try {
      const serveUrl = await getBundle();
      const composition = await selectComposition({
        serveUrl,
        id: COMPOSITION_ID,
        inputProps: reelData,
      });
      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: mp4Path(id),
        inputProps: reelData,
        onProgress: ({ progress }) => writeState(id, { status: 'rendering', progress }),
      });
      writeState(id, { status: 'done', url: `/api/competitions/${id}/reel/download` });
    } catch (err: any) {
      writeState(id, { status: 'error', message: String(err?.message ?? err) });
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
```

- [ ] **Step 2: Verify types**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/api/competitions/
git commit -m "feat(web): add POST/GET /api/competitions/[id]/reel render endpoint"
```

---

### Task 19: Download route

**Files:**
- Create: `packages/web/app/api/competitions/[id]/reel/download/route.ts`

- [ ] **Step 1: Create `packages/web/app/api/competitions/[id]/reel/download/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const mp4 = path.join('/tmp/arena-reels', `${id}.mp4`);

  if (!fs.existsSync(mp4)) {
    return NextResponse.json({ error: 'Reel not found' }, { status: 404 });
  }

  const stat = fs.statSync(mp4);
  // Stream the file to avoid loading potentially large MP4 into heap
  const nodeStream = fs.createReadStream(mp4);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="arena-recap-${id}.mp4"`,
      'Content-Length': String(stat.size),
    },
  });
}
```

- [ ] **Step 2: Verify types**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/api/competitions/
git commit -m "feat(web): add GET /api/competitions/[id]/reel/download MP4 stream"
```

---

### Task 20: Competition detail page — reel button + progress card

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`

Add reel state, initial hydration on mount, the button, and the TRON progress card. All button styles follow the existing header button pattern (0.70rem, inline flex, border, borderRadius 6px, padding 0.35rem 0.75rem).

- [ ] **Step 1: Add reel state types and state variables**

Find the existing state declarations near the top of the component (around line 200–300 where `useState` calls are grouped). Add:

```ts
// Reel state
type ReelStatus =
  | { status: 'idle' }
  | { status: 'rendering'; progress: number }
  | { status: 'done'; url: string }
  | { status: 'error'; message: string };

const [reelStatus, setReelStatus] = useState<ReelStatus>({ status: 'idle' });
const [reelStartTime, setReelStartTime] = useState<number | null>(null);
const reelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

- [ ] **Step 2: Add reel hydration on mount and polling logic**

Define the polling helpers with `useCallback` before the `useEffect` to avoid stale closure issues. Place near the other `useCallback`/`useRef` declarations in the component:

```ts
const stopReelPolling = useCallback(() => {
  if (reelPollRef.current) {
    clearInterval(reelPollRef.current);
    reelPollRef.current = null;
  }
}, []);

const startReelPolling = useCallback(() => {
  if (reelPollRef.current) return;
  reelPollRef.current = setInterval(async () => {
    try {
      const res = await fetch(`/api/competitions/${id}/reel`);
      const s: ReelStatus = await res.json();
      setReelStatus(s);
      if (s.status !== 'rendering') stopReelPolling();
    } catch {}
  }, 1500);
}, [id, stopReelPolling]);

// Hydrate reel state on mount and clean up polling on unmount
useEffect(() => {
  if (!id) return;
  fetch(`/api/competitions/${id}/reel`)
    .then(r => r.json())
    .then((s: ReelStatus) => {
      setReelStatus(s);
      if (s.status === 'rendering') {
        setReelStartTime(Date.now());
        startReelPolling();
      }
    })
    .catch(() => {});
  return () => stopReelPolling();
}, [id, startReelPolling, stopReelPolling]);
```

- [ ] **Step 3: Add handleGenerateReel function**

Near the other handler functions (e.g., `handleRematch`):

```ts
const handleGenerateReel = async () => {
  try {
    setReelStatus({ status: 'rendering', progress: 0 });
    setReelStartTime(Date.now());
    const res = await fetch(`/api/competitions/${id}/reel`, { method: 'POST' });
    if (res.status === 409) {
      // Already in progress — just start polling
    } else if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setReelStatus({ status: 'error', message: err.error ?? 'Failed to start render' });
      return;
    }
    startReelPolling();
  } catch (err: any) {
    setReelStatus({ status: 'error', message: String(err?.message ?? 'Unknown error') });
  }
};
```

- [ ] **Step 4: Add reel button to the header action bar**

Find the block containing `{isComplete && (...▶ REPLAY...)}` (around line 2459). Add the reel button immediately after the REPLAY link:

```tsx
{/* Generate Reel button — shown when competition is complete */}
{isComplete && (
  <button
    onClick={reelStatus.status === 'idle' || reelStatus.status === 'error' ? handleGenerateReel : undefined}
    disabled={reelStatus.status === 'rendering'}
    style={{
      position: 'relative', overflow: 'hidden',
      fontSize: '0.70rem',
      color: reelStatus.status === 'done'
        ? '#ff6600'
        : reelStatus.status === 'error'
        ? '#ef4444'
        : reelStatus.status === 'rendering'
        ? '#00f0ff'
        : '#4a8fa8',
      background: reelStatus.status === 'done'
        ? 'rgba(255,102,0,0.08)'
        : 'transparent',
      border: `1px solid ${
        reelStatus.status === 'done' ? 'rgba(255,102,0,0.4)'
        : reelStatus.status === 'error' ? 'rgba(239,68,68,0.4)'
        : reelStatus.status === 'rendering' ? 'rgba(0,240,255,0.35)'
        : '#0a2235'}`,
      borderRadius: '6px', padding: '0.35rem 0.75rem', flexShrink: 0,
      letterSpacing: '0.5px', fontWeight: 600,
      cursor: reelStatus.status === 'rendering' ? 'not-allowed' : 'pointer',
      display: 'flex', alignItems: 'center', gap: '0.35rem',
      transition: 'all 0.15s ease', fontFamily: 'inherit',
      minWidth: 120,
    }}
    title={reelStatus.status === 'error' ? (reelStatus as any).message : 'Generate a shareable video reel'}
  >
    {/* Fill animation behind text during rendering */}
    {reelStatus.status === 'rendering' && (
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: `${reelStatus.progress * 100}%`,
        background: 'rgba(0,240,255,0.08)',
        transition: 'width 0.5s ease',
        pointerEvents: 'none',
      }} />
    )}
    <span style={{ position: 'relative' }}>
      {reelStatus.status === 'rendering'
        ? `⟳ Rendering… ${Math.round(reelStatus.progress * 100)}%`
        : reelStatus.status === 'done'
        ? <a href={reelStatus.url} download style={{ color: 'inherit', textDecoration: 'none' }}>⬇ Download Reel</a>
        : reelStatus.status === 'error'
        ? '⚠ Reel Failed'
        : '🎬 Generate Reel'}
    </span>
  </button>
)}
```

- [ ] **Step 5: Add TRON progress card**

Find a good location just below the header bar (after the closing `</div>` of the header section, before the lane panels). Add:

```tsx
{/* Reel progress card — shown while rendering */}
{reelStatus.status === 'rendering' && (() => {
  const progress = reelStatus.progress;
  const elapsed = reelStartTime ? (Date.now() - reelStartTime) : 0;
  const estimatedTotalMs = progress > 0.05 ? (elapsed / progress) : null;
  const remainingMs = estimatedTotalMs ? estimatedTotalMs * (1 - progress) : null;
  const remainingSec = remainingMs ? Math.round(remainingMs / 1000) : null;

  return (
    <div style={{
      margin: '0 1rem 0.75rem',
      padding: '0.75rem 1rem',
      background: '#050f1e',
      border: '1px solid rgba(0,240,255,0.2)',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: '0.65rem', color: '#00f0ff', letterSpacing: '2px', fontWeight: 600 }}>
          ◈ RENDERING REEL
        </span>
        <span style={{ fontSize: '0.72rem', color: '#ff6600', fontWeight: 700 }}>
          {Math.round(progress * 100)}%
        </span>
      </div>
      <div style={{ height: 4, background: 'rgba(0,240,255,0.1)', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
        <div style={{
          width: `${progress * 100}%`, height: '100%',
          background: 'linear-gradient(90deg, #00f0ff, #0080ff)',
          borderRadius: 2,
          boxShadow: '0 0 8px rgba(0,240,255,0.5)',
          transition: 'width 0.5s ease',
        }} />
      </div>
      <div style={{ fontSize: '0.62rem', color: '#3d7d94' }}>
        {remainingSec !== null ? `~${remainingSec}s remaining` : 'Encoding frames…'}
      </div>
    </div>
  );
})()}
```

- [ ] **Step 6: Verify types**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/competitions/
git commit -m "feat(web): add Generate Reel button and TRON progress card to competition detail page"
```

---

### Task 21: End-to-end test

- [ ] **Step 1: Start the full stack**

Terminal 1:
```bash
cd "/Users/kstefano/Personal Projects/agentarena"
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts serve --port 3000
```

Terminal 2:
```bash
cd "/Users/kstefano/Personal Projects/agentarena/packages/web"
npm run dev
```

- [ ] **Step 2: Find a COMPLETE competition and navigate to its detail page**

Open `http://localhost:3001`, find a competition in COMPLETE state, click it. Verify the "🎬 Generate Reel" button appears in the header action bar.

- [ ] **Step 3: Click "🎬 Generate Reel"**

Expected:
- Button changes to `⟳ Rendering… 0%`
- TRON progress card appears below the header
- Progress % increases over time (may take 30–120s depending on machine)

- [ ] **Step 4: Wait for completion**

Expected:
- Button changes to `⬇ Download Reel` (orange)
- Progress card disappears

- [ ] **Step 5: Click "⬇ Download Reel"**

Expected: MP4 file downloads. Open in any video player, verify all 8 scenes render correctly at ~42 seconds.

- [ ] **Step 6: Verify concurrent render protection**

With a render in progress, send a second POST to the same endpoint via curl:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3001/api/competitions/<competition-id>/reel
```

Expected: `409` response — "Render already in progress".

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: add Remotion video reel generation to Arena4Ai competition detail page"
```
