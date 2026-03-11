# Arena4Ai UX Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 28 UX audit findings to unify the web app's TRON aesthetic with the marketing landing page, touching globals.css, layout.tsx, design-tokens.ts, 7 page files, and one new TopBar component.

**Architecture:** Four sequential chunks: (1) global background shell + CSS class library + animation consolidation, (2) design token expansion, (3) typography pass across all pages, (4) components and page polish. Each chunk is independently deployable and typechecks clean before the next begins.

**Tech Stack:** Next.js 15 App Router, Tailwind CSS, TypeScript, CSS-in-JS inline styles + className, `var(--font-orbitron)` CSS variable loaded via `next/font/google`.

**Spec / Audit:** `docs/ux-audit.md` — 28 findings (5 Critical, 11 Major, 12 Minor)

**Design quality standard:** @frontend-design — every change must feel intentional, not patched. TRON aesthetic means: precise opacity, correct glow intensity, Orbitron used at the right weights, corner brackets exactly 18px with 0.25 opacity, scanlines barely perceptible at 6% opacity.

**Typecheck command:** `npx tsc --noEmit -p packages/web/tsconfig.json`

---

## File Map

| File | Action | Findings |
|------|--------|---------|
| `packages/web/app/globals.css` | Rewrite | BG-001,002,003,004,005,006,007 + CP-002,003,004,007,008,010,012 |
| `packages/web/app/layout.tsx` | Rewrite | BG-008 + BG-003,004,006 render |
| `packages/web/app/competitions/[id]/page.tsx` | Edit | CP-007 (remove GLOBAL_STYLES) |
| `packages/web/app/page.tsx` | Edit | CP-007 (remove inline style), TY-001,005, CP-002,009,010 |
| `packages/web/app/leaderboard/page.tsx` | Edit | CP-007, TY-001,002,009 |
| `packages/web/lib/design-tokens.ts` | Edit | TY-004,005,007,008,009,010 + CP-004,005,009,011 |
| `packages/web/app/analytics/page.tsx` | Edit | TY-001,005,009 |
| `packages/web/app/tournaments/[id]/page.tsx` | Edit | TY-001,005 |
| `packages/web/app/competitions/new/page.tsx` | Edit | TY-001,005,008 |
| `packages/web/app/tournaments/new/page.tsx` | Edit | TY-001,005,008 |
| `packages/web/components/TopBar.tsx` | Create | CP-001 |

---

## Chunk 1: Global Background Shell

Fixes all 8 BG findings + consolidates all CSS (CP-007) + adds the shared CSS class library (CP-002, CP-003, CP-004, CP-008, CP-010, CP-012).

### Task 1: Rewrite globals.css

**Files:**
- Modify: `packages/web/app/globals.css`

- [ ] **Step 1: Verify current file contents**

```bash
cat "/Users/kstefano/Personal Projects/agentarena/packages/web/app/globals.css"
```

Expected: 30 lines — @tailwind directives, body grid, html font-size, and 3 keyframes.

- [ ] **Step 2: Write the new globals.css**

Replace the entire file with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ── TRON grid — fixed, matches marketing (BG-001: 48px, BG-002: 0.025 opacity) ── */
body {
  background-image:
    linear-gradient(rgba(0,240,255,0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,240,255,0.025) 1px, transparent 1px);
  background-size: 48px 48px;
  background-attachment: fixed;
}

html {
  font-size: 120%;
}

/* ── BG-003: Scanlines overlay — CRT texture, fixed, barely perceptible ── */
.scanlines {
  position: fixed; inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0,0,0,0.06) 2px,
    rgba(0,0,0,0.06) 4px
  );
  pointer-events: none;
  z-index: 1;
}

/* ── BG-004: Corner bracket HUD elements ── */
.corner {
  position: fixed;
  width: 18px; height: 18px;
  z-index: 50; opacity: 0.25;
  pointer-events: none;
}
.corner-tl { top: 1rem; left: 1rem; border-top: 1px solid #00f0ff; border-left: 1px solid #00f0ff; }
.corner-tr { top: 1rem; right: 1rem; border-top: 1px solid #00f0ff; border-right: 1px solid #00f0ff; }
.corner-bl { bottom: 1rem; left: 1rem; border-bottom: 1px solid #00f0ff; border-left: 1px solid #00f0ff; }
.corner-br { bottom: 1rem; right: 1rem; border-bottom: 1px solid #00f0ff; border-right: 1px solid #00f0ff; }

/* ── BG-006: Radial ambient glow ── */
.hero-glow-center {
  position: fixed; inset: 0;
  background: radial-gradient(ellipse 70% 55% at 50% 45%, rgba(0,240,255,0.06) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}

/* ── BG-007: Hero fade gradient ── */
.hero-fade {
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 220px;
  background: linear-gradient(to top, #000408, transparent);
  pointer-events: none;
}

/* ── TRON glow animations ── */
@keyframes tronGlow {
  0%,100% { box-shadow: 0 0 5px rgba(0,240,255,0.25), 0 0 10px rgba(0,240,255,0.1); }
  50%     { box-shadow: 0 0 12px rgba(0,240,255,0.6), 0 0 24px rgba(0,240,255,0.3); }
}
@keyframes tronBorderPulse {
  0%,100% { border-color: rgba(0,240,255,0.2); }
  50%     { border-color: rgba(0,240,255,0.7); }
}

/* ── Shared animations (consolidated from page.tsx, leaderboard, [id]/page.tsx) ── */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
@keyframes liveBorder {
  0%, 100% { border-color: rgba(0,240,255,0.6); }
  50%       { border-color: rgba(0,240,255,0.25); }
}
@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 4px rgba(0,240,255,0.3); }
  50%       { box-shadow: 0 0 12px rgba(0,240,255,0.6); }
}
@keyframes slideIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes slideInScore {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes glow {
  0%, 100% { box-shadow: 0 0 8px rgba(234,179,8,0.3), 0 0 20px rgba(234,179,8,0.1); }
  50%       { box-shadow: 0 0 16px rgba(234,179,8,0.5), 0 0 40px rgba(234,179,8,0.2); }
}
@keyframes judgingPulse {
  0%, 100% { opacity: 0.7; }
  50%       { opacity: 1; }
}
@keyframes spinDot {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes progressReveal { from { width: 0%; } }
@keyframes borderGlow {
  0%, 100% { border-color: rgba(0,240,255,0.2); }
  50%       { border-color: rgba(0,240,255,0.5); }
}
@keyframes celebrationFlash {
  0%   { background: rgba(0,240,255,0.15); }
  50%  { background: rgba(0,240,255,0.05); }
  100% { background: rgba(0,240,255,0); }
}
@keyframes scanline {
  0%   { background-position: 0 0; }
  100% { background-position: 0 40px; }
}
@keyframes msgFade {
  0%, 85% { opacity: 1; }
  95%, 100% { opacity: 0; }
}
@keyframes launchFlash {
  0%   { opacity: 0; }
  10%  { opacity: 1; }
  75%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes launchText {
  0%   { opacity: 0; transform: translateY(16px) scale(0.85); }
  15%  { opacity: 1; transform: translateY(0) scale(1); }
  75%  { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-12px) scale(1.1); }
}
@keyframes winnerFlash {
  0%   { box-shadow: 0 0 0 0 rgba(0,240,255,0); }
  30%  { box-shadow: 0 0 40px 12px rgba(0,240,255,0.6); }
  70%  { box-shadow: 0 0 40px 12px rgba(0,240,255,0.4); }
  100% { box-shadow: 0 0 0 0 rgba(0,240,255,0); }
}
@keyframes winnerBanner {
  0%   { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  15%  { opacity: 1; transform: translateX(-50%) translateY(0); }
  75%  { opacity: 1; transform: translateX(-50%) translateY(0); }
  100% { opacity: 0; transform: translateX(-50%) translateY(-8px); }
}

/* ── Arena animation utility classes (from [id]/page.tsx GLOBAL_STYLES) ── */
.arena-event-row  { animation: slideIn 0.2s ease-out; }
.arena-score-card { animation: slideInScore 0.4s ease-out both; }
.arena-winner-card { animation: glow 2s ease-in-out infinite; }
.arena-progress-bar { animation: progressReveal 0.8s ease-out both; }
.arena-running-border { animation: borderGlow 2s ease-in-out infinite; }
.arena-celebration { animation: celebrationFlash 1.5s ease-out; }

/* ── Scrollbar styles ── */
.arena-scrollbar::-webkit-scrollbar { width: 5px; }
.arena-scrollbar::-webkit-scrollbar-track { background: transparent; }
.arena-scrollbar::-webkit-scrollbar-thumb { background: #0a2235; border-radius: 3px; }
.arena-scrollbar::-webkit-scrollbar-thumb:hover { background: #0e3050; }

@media (max-width: 700px) {
  .arena-tab-bar { overflow-x: auto !important; white-space: nowrap !important; }
  .arena-tab-bar::-webkit-scrollbar { height: 3px; }
  .arena-tab-bar::-webkit-scrollbar-thumb { background: #0a2235; border-radius: 2px; }
}

/* ── Resize handle (file preview panel) ── */
.resize-handle {
  flex-shrink: 0; height: 5px;
  background: #0a2235; cursor: ns-resize;
  user-select: none; transition: background 0.15s;
  position: relative;
}
.resize-handle:hover, .resize-handle.dragging { background: rgba(0,240,255,0.5); }
.resize-handle::after {
  content: ''; position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: 40px; height: 3px;
  border-radius: 2px; background: rgba(255,255,255,0.12);
}

/* ── CP-002: Shared button styles ── */
.arena-btn {
  font-family: var(--font-orbitron), 'SF Mono', monospace;
  font-size: 0.65rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1.5px;
  padding: 0.45rem 1.1rem;
  border: 1px solid rgba(0,240,255,0.35);
  color: #00f0ff;
  background: rgba(0,240,255,0.05);
  border-radius: 4px; cursor: pointer;
  text-decoration: none;
  display: inline-flex; align-items: center; gap: 0.4rem;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
  white-space: nowrap;
}
.arena-btn:hover {
  background: rgba(0,240,255,0.12);
  border-color: rgba(0,240,255,0.6);
}
.arena-btn-primary {
  background: #00f0ff; color: #000408; border-color: #00f0ff;
  font-weight: 900;
}
.arena-btn-primary:hover { background: #33f4ff; transform: translateY(-1px); }
.arena-btn-orange {
  color: #ff6600; border-color: rgba(255,102,0,0.35);
  background: rgba(255,102,0,0.05);
}
.arena-btn-orange:hover { background: rgba(255,102,0,0.12); border-color: rgba(255,102,0,0.6); }

/* ── CP-003: Shared form styles ── */
.arena-form {
  display: flex;
  border: 1px solid rgba(0,240,255,0.2);
  border-radius: 5px; overflow: hidden;
}
.arena-form:focus-within { border-color: rgba(0,240,255,0.5); }
.arena-form input {
  flex: 1; background: transparent; border: none;
  color: #c8eef8;
  padding: 0.65rem 1rem;
  font-family: var(--font-orbitron), 'SF Mono', monospace;
  font-size: 0.75rem; outline: none;
}
.arena-form input::placeholder { color: #3d7d94; }

/* ── CP-010: Shared card styles ── */
.arena-card {
  background: #050f1e;
  border: 1px solid #0a2235;
  border-radius: 8px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}
.arena-card:hover {
  border-color: rgba(0,240,255,0.3);
  box-shadow: 0 0 5px rgba(0,240,255,0.1), 0 0 20px rgba(0,240,255,0.05);
  transform: translateY(-2px);
}

/* ── CP-004: Section divider ── */
.arena-divider {
  height: 1px; border: none;
  background: linear-gradient(to right, transparent, #0a2235 30%, #0a2235 70%, transparent);
  margin: 2rem 0;
}

/* ── CP-008: Empty state ── */
.arena-empty {
  padding: 5rem 2rem;
  background: #050f1e;
  border: 1px dashed #0a2235;
  border-radius: 12px;
  text-align: center;
}

/* ── CP-012: Link styles ── */
.arena-link { color: #00f0ff; text-decoration: none; transition: opacity 0.15s; }
.arena-link:hover { opacity: 0.75; }

/* ── Shared hover classes ── */
.nav-link { transition: color 0.15s ease, border-color 0.15s ease; }
.nav-link:hover { color: #c8eef8 !important; border-color: #0e3050 !important; }
.new-comp-btn { transition: background 0.15s ease, transform 0.1s ease; }
.new-comp-btn:hover { background: #33f5ff !important; transform: translateY(-1px); }
.delete-btn { transition: color 0.15s ease, background 0.15s ease; }
.delete-btn:hover { color: #ef4444 !important; background: rgba(239,68,68,0.1) !important; }
.replay-link { transition: color 0.15s ease; }
.replay-link:hover { color: #00f0ff !important; }
.lb-row { transition: background 0.15s ease, border-color 0.15s ease; }
.lb-row:hover { background: rgba(10,34,53,0.6) !important; border-color: #0e3050 !important; }
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p "/Users/kstefano/Personal Projects/agentarena/packages/web/tsconfig.json"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add packages/web/app/globals.css
git commit -m "$(cat <<'EOF'
feat(web): rewrite globals.css — TRON background shell + shared CSS library

- Grid: 40px→48px, opacity 0.035→0.025, background-attachment: fixed (BG-001,002)
- Add .scanlines CRT overlay (BG-003)
- Add .corner HUD brackets (BG-004)
- Remove unused tronScan keyframe (BG-005)
- Add .hero-glow-center radial ambient glow (BG-006)
- Add .hero-fade gradient (BG-007)
- Consolidate all animations from page.tsx, leaderboard, [id]/page.tsx (CP-007)
- Add .arena-btn, .arena-btn-primary, .arena-btn-orange (CP-002)
- Add .arena-form, .arena-card, .arena-divider, .arena-empty, .arena-link (CP-003,004,008,010,012)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### Task 2: Remove GLOBAL_STYLES from arena page

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx` (lines 93–229)

- [ ] **Step 5: Read the GLOBAL_STYLES section to confirm exact boundaries**

Read lines 93–230 of `packages/web/app/competitions/[id]/page.tsx` to confirm `const GLOBAL_STYLES` starts at line 95 and the closing `\`;` is at line 228. Also confirm `<style>{GLOBAL_STYLES}</style>` is present somewhere in the JSX.

- [ ] **Step 6: Remove GLOBAL_STYLES const and the style injection**

Find and remove:
1. The entire `const GLOBAL_STYLES = \`...\`;` block (lines 95–228 inclusive, including the `// ─── Global CSS ──` comment at line 93)
2. The `<style>{GLOBAL_STYLES}</style>` JSX line in the render (search for it — it's near the top of the returned JSX)

The CSS classes and keyframes now live in globals.css — no replacement needed.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit -p "/Users/kstefano/Personal Projects/agentarena/packages/web/tsconfig.json"
```

Expected: no errors. If there are errors about GLOBAL_STYLES not being defined, you missed the style injection — search for `GLOBAL_STYLES` in the file and remove all references.

- [ ] **Step 8: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add "packages/web/app/competitions/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
refactor(arena): remove inline GLOBAL_STYLES — animations now in globals.css (CP-007)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### Task 3: Remove inline style blocks from gallery and leaderboard

**Files:**
- Modify: `packages/web/app/page.tsx` (lines 162–209)
- Modify: `packages/web/app/leaderboard/page.tsx` (lines 106–135)

- [ ] **Step 9: Remove inline `<style>` block from gallery page**

In `packages/web/app/page.tsx`, remove the entire `<style>{`...`}</style>` block (lines 162–209). The keyframes (`pulse`, `liveBorder`, `fadeIn`) and CSS classes (`.arena-card`, `.delete-btn`, `.replay-link`, `.nav-link`, `.new-comp-btn`) now live in globals.css.

- [ ] **Step 10: Remove inline `<style>` block from leaderboard page**

In `packages/web/app/leaderboard/page.tsx`, remove the entire `<style>{`...`}</style>` block (lines 106–135). Same classes now in globals.css.

- [ ] **Step 11: Typecheck**

```bash
npx tsc --noEmit -p "/Users/kstefano/Personal Projects/agentarena/packages/web/tsconfig.json"
```

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add packages/web/app/page.tsx packages/web/app/leaderboard/page.tsx
git commit -m "$(cat <<'EOF'
refactor(web): remove duplicate inline style blocks from gallery and leaderboard (CP-007)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### Task 4: Rewrite layout.tsx — inject background overlays

**Files:**
- Modify: `packages/web/app/layout.tsx`

- [ ] **Step 13: Rewrite layout.tsx**

Replace the entire file with:

```tsx
import type { Metadata } from 'next';
import { Orbitron } from 'next/font/google';
import './globals.css';

const orbitron = Orbitron({
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  variable: '--font-orbitron',
});

export const metadata: Metadata = {
  title: 'Arena4Ai',
  description: 'AI Agent Competition Platform — Arena4Ai',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={orbitron.variable}>
      <body style={{ margin: 0, padding: 0, background: '#000408' }}>
        {/* BG-006: Ambient radial glow — fixed, behind everything */}
        <div className="hero-glow-center" />
        {/* BG-003: CRT scanlines overlay */}
        <div className="scanlines" />
        {/* BG-004: Corner bracket HUD elements */}
        <div className="corner corner-tl" />
        <div className="corner corner-tr" />
        <div className="corner corner-bl" />
        <div className="corner corner-br" />
        {/* BG-008: Main content above all overlays */}
        <main style={{ position: 'relative', zIndex: 2 }}>{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 14: Typecheck**

```bash
npx tsc --noEmit -p "/Users/kstefano/Personal Projects/agentarena/packages/web/tsconfig.json"
```

Expected: no errors.

- [ ] **Step 15: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add packages/web/app/layout.tsx
git commit -m "$(cat <<'EOF'
feat(layout): inject scanlines, corner brackets, ambient glow at root (BG-003,004,006,008)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 2: Design Tokens Expansion

Adds new exports to `design-tokens.ts` covering TY-004, TY-005, TY-007, TY-008, TY-009, TY-010, CP-004, CP-005, CP-009, CP-011.

### Task 5: Expand design-tokens.ts

**Files:**
- Modify: `packages/web/lib/design-tokens.ts`

- [ ] **Step 1: Ensure React type import is present in design-tokens.ts**

Check the top of `packages/web/lib/design-tokens.ts`:
```bash
head -5 "/Users/kstefano/Personal Projects/agentarena/packages/web/lib/design-tokens.ts"
```

If `import type React from 'react';` is not already the first line, add it now. This must exist before appending the new exports in Step 2, because those exports use `React.CSSProperties`.

- [ ] **Step 2: Append new exports to design-tokens.ts**

Add the following block at the end of the file (after the `glowShadow` function):

```ts
// ─── Typography tokens ────────────────────────────────────────────────────────

/** Font family — Orbitron first, monospace fallbacks. Use everywhere. (TY-001,005) */
export const MONOSPACE_FONT = "var(--font-orbitron), 'SF Mono', 'Fira Code', 'Cascadia Code', monospace";

/** Label / kicker letter-spacing — matches marketing .stamp (TY-004) */
export const LABEL_LETTER_SPACING = '5px';

/** Button letter-spacing — matches marketing CTA buttons (TY-007) */
export const BUTTON_LETTER_SPACING = '2px';

/** Nav link letter-spacing — matches marketing .nav-cta (TY-007) */
export const NAV_LETTER_SPACING = '1.5px';

/** Font weights — map to the Orbitron weights loaded in layout.tsx (TY-010) */
export const FONT_WEIGHT_REGULAR   = 400;
export const FONT_WEIGHT_BOLD      = 700;
export const FONT_WEIGHT_EXTRABOLD = 900;

/** Form label style — shared across competitions/new and tournaments/new (TY-008) */
export const FORM_LABEL_STYLE: React.CSSProperties = {
  color: '#4a8fa8',
  textTransform: 'uppercase' as const,
  letterSpacing: '1.5px',
  fontWeight: 700,
  fontSize: '0.6rem',
};

// ─── Accent colors ────────────────────────────────────────────────────────────

/** Rank badge accent colors — leaderboard podium (TY-009) */
export const ACCENT_GOLD   = '#eab308';
export const ACCENT_SILVER = '#94a3b8';
export const ACCENT_BRONZE = '#b47c3c';

// ─── Interaction tokens ───────────────────────────────────────────────────────

/** Hover state colors for interactive elements (CP-009) */
export const HOVER_DARK = '#0e3050';
export const HOVER_TEXT = '#c8eef8';

// ─── Layout tokens ────────────────────────────────────────────────────────────

/** Standard page container max-width (CP-011) */
export const CONTAINER_MAX_WIDTH = '960px';

/** Spacing scale — use for padding, margin, gap (CP-005) */
export const SPACING = {
  xs:   '0.5rem',
  sm:   '0.75rem',
  md:   '1rem',
  lg:   '1.5rem',
  xl:   '2rem',
  xxl:  '2.5rem',
  xxxl: '3rem',
} as const;

/** Section divider gradient — use instead of plain border-bottom (CP-004) */
export const DIVIDER_GRADIENT = 'linear-gradient(to right, transparent, #0a2235 30%, #0a2235 70%, transparent)';

// ─── Badge style presets ──────────────────────────────────────────────────────

/**
 * Stamp / kicker style — TRON label pattern.
 * Usage: <div style={STAMP_STYLE}>EARLY ACCESS</div>
 * (TY-003)
 */
export const STAMP_STYLE: React.CSSProperties = {
  fontSize: '0.55rem',
  fontWeight: 800,
  letterSpacing: '5px',
  color: TEXT_DIM,
  textTransform: 'uppercase' as const,
  border: `1px solid ${BORDER_DIM}`,
  padding: '0.25rem 0.85rem',
  borderRadius: '2px',
  display: 'inline-block',
};

/**
 * Kicker label style — above page titles.
 * (TY-003,004)
 */
export const KICKER_STYLE: React.CSSProperties = {
  fontSize: '0.55rem',
  fontWeight: 800,
  letterSpacing: LABEL_LETTER_SPACING,
  color: TEXT_DIM,
  textTransform: 'uppercase' as const,
};
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p "/Users/kstefano/Personal Projects/agentarena/packages/web/tsconfig.json"
```

Expected: no errors. If `React.CSSProperties` errors, add `import type React from 'react';` to design-tokens.ts.

- [ ] **Step 4: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add packages/web/lib/design-tokens.ts
git commit -m "$(cat <<'EOF'
feat(tokens): expand design-tokens.ts with typography, spacing, badge, and interaction tokens

Adds: MONOSPACE_FONT, LABEL_LETTER_SPACING, BUTTON/NAV_LETTER_SPACING,
FONT_WEIGHT_*, FORM_LABEL_STYLE, ACCENT_GOLD/SILVER/BRONZE, HOVER_DARK/TEXT,
CONTAINER_MAX_WIDTH, SPACING, DIVIDER_GRADIENT, STAMP_STYLE, KICKER_STYLE

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 3: Typography Pass

Applies `MONOSPACE_FONT` (which includes Orbitron) to all 6 main pages, fixes the leaderboard h1, updates badge usage, and applies letter-spacing/text-transform tokens consistently.

> **Dependency:** Chunk 2 must be complete before running Chunk 3. Verify by checking:
> ```bash
> grep -n "MONOSPACE_FONT" "/Users/kstefano/Personal Projects/agentarena/packages/web/lib/design-tokens.ts"
> ```
> Expected: at least one match. If not found, complete Chunk 2 first.

### Task 6: Apply MONOSPACE_FONT to gallery page

**Files:**
- Modify: `packages/web/app/page.tsx`

- [ ] **Step 1: Update fontFamily import and usage in page.tsx**

First, find all hardcoded monospace font strings in the file:
```bash
grep -n "SF Mono" "/Users/kstefano/Personal Projects/agentarena/packages/web/app/page.tsx"
```
Note every line number. Replace each occurrence in the following steps.

1. Add to the import from `'../lib/design-tokens'`:
   ```ts
   import { getModelColor, getStateStyle, FORMAT_BADGES, MONOSPACE_FONT, HOVER_DARK, HOVER_TEXT, ACCENT_CYAN, KICKER_STYLE } from '../lib/design-tokens';
   ```

2. Find the root `<div>` style (line ~156–161):
   ```tsx
   fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
   ```
   Replace with:
   ```tsx
   fontFamily: MONOSPACE_FONT,
   ```

3. Find all other hardcoded `"'SF Mono', 'Fira Code', 'Cascadia Code', monospace"` strings in the file — replace each with `MONOSPACE_FONT`.

- [ ] **Step 2: Apply KICKER_STYLE to the gallery kicker element**

Find the kicker/stamp above the page title (the element with `letterSpacing: '4px'` — around line 225). Import and spread `KICKER_STYLE`:
```tsx
import { ..., KICKER_STYLE } from '../lib/design-tokens';
// then in JSX:
<div style={{ ...KICKER_STYLE, marginBottom: '0.75rem' }}>
  ARENA4AI COMPETITION RESULTS
</div>
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p "/Users/kstefano/Personal Projects/agentarena/packages/web/tsconfig.json"
```

Expected: no errors.

### Task 7: Apply MONOSPACE_FONT to leaderboard + fix h1

**Files:**
- Modify: `packages/web/app/leaderboard/page.tsx`

- [ ] **Step 4: Update leaderboard fontFamily + h1 Orbitron + rank badge colors**

1. Add a new import (this file currently only imports `getModelColor` from design-tokens — extend it):
   ```ts
   import { MONOSPACE_FONT, ACCENT_GOLD, ACCENT_SILVER, ACCENT_BRONZE, KICKER_STYLE, TEXT_MUTED } from '../../lib/design-tokens';
   ```

2. Replace root div `fontFamily: "'SF Mono'..."` with `fontFamily: MONOSPACE_FONT`.

3. Find the leaderboard h1 (lines ~158–165). Add `fontFamily: MONOSPACE_FONT` to its style object.

4. Find the rank badge color logic (lines ~61–64) using hardcoded gold/silver/bronze colors. Replace the hardcoded values:
   ```ts
   const rankColor = rank === 1 ? ACCENT_GOLD : rank === 2 ? ACCENT_SILVER : rank === 3 ? ACCENT_BRONZE : TEXT_MUTED;
   ```

5. Apply `KICKER_STYLE` to the leaderboard kicker element (line ~150).

- [ ] **Step 5: Typecheck** — same command as before.

### Task 8: Apply MONOSPACE_FONT to analytics, tournaments, and form pages

**Files:**
- Modify: `packages/web/app/analytics/page.tsx`
- Modify: `packages/web/app/tournaments/[id]/page.tsx`
- Modify: `packages/web/app/competitions/new/page.tsx`
- Modify: `packages/web/app/tournaments/new/page.tsx`

- [ ] **Step 6: Update analytics/page.tsx**

This file does not currently import from `design-tokens`. Add a new import block near the top:
```ts
import { MONOSPACE_FONT, KICKER_STYLE } from '../../lib/design-tokens';
```

1. Replace the `fontFamily` constant (line ~106): `const font = MONOSPACE_FONT;`
2. Apply `KICKER_STYLE` to the analytics kicker element (line ~151).

- [ ] **Step 7: Update tournaments/[id]/page.tsx**

This file already imports `{ getModelColor, getStateStyle }` from `'../../../lib/design-tokens'`. Extend it:
```ts
import { getModelColor, getStateStyle, MONOSPACE_FONT, KICKER_STYLE } from '../../../lib/design-tokens';
```

1. Replace `fontFamily: "'SF Mono'..."` with `fontFamily: MONOSPACE_FONT` on the root div and any other occurrences.
2. Check whether a kicker/stamp label exists above the tournament title. If so, apply `KICKER_STYLE` to it (TY-003/004).

- [ ] **Step 8: Update competitions/new/page.tsx**

This file does not currently import from `design-tokens`. Add a new import (note 3-level path from `app/competitions/new/`):
```ts
import { MONOSPACE_FONT, FORM_LABEL_STYLE } from '../../../lib/design-tokens';
```

1. Replace `const FONT = "'SF Mono'..."` (line ~108) with `const FONT = MONOSPACE_FONT;`
2. Find `const labelStyle` (lines ~109–117) — delete the local const entirely. Then do a find-and-replace of all `style={labelStyle}` usages to `style={FORM_LABEL_STYLE}`.
3. Also check all `textTransform: 'uppercase'` usage on kicker/stamp elements — if any element has `letterSpacing` or `fontWeight: 800` but no `textTransform: 'uppercase'`, add it (TY-006).

- [ ] **Step 9: Update tournaments/new/page.tsx**

This file does not currently import from `design-tokens`. Add a new import:
```ts
import { MONOSPACE_FONT, FORM_LABEL_STYLE } from '../../lib/design-tokens';
```

1. Replace `fontFamily: "'SF Mono'..."` with `fontFamily: MONOSPACE_FONT`.
2. Find the `labelStyle` object (lines ~167–175) — delete the local const entirely. Then do a find-and-replace of all `labelStyle` usages to `FORM_LABEL_STYLE`.
3. Check all kicker/stamp elements for missing `textTransform: 'uppercase'` — add if absent (TY-006).

- [ ] **Step 10: Audit TY-006 — text-transform consistency across all 5 pages**

For each of these files, run:
```bash
grep -n "letterSpacing\|fontWeight.*800\|fontWeight.*900" <file>
```
For any element with high letter-spacing or heavy font weight but no `textTransform: 'uppercase'`, add it (TY-006). Key places to check:
- Gallery kicker/stamp above page title
- Leaderboard kicker/section labels
- Analytics kicker
- `competitions/new` label elements (already handled by FORM_LABEL_STYLE which includes uppercase)
- `tournaments/new` label elements (same)

- [ ] **Step 11: Typecheck**

```bash
npx tsc --noEmit -p "/Users/kstefano/Personal Projects/agentarena/packages/web/tsconfig.json"
```

Expected: no errors.

- [ ] **Step 12: Commit all typography changes**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add \
  packages/web/app/page.tsx \
  packages/web/app/leaderboard/page.tsx \
  packages/web/app/analytics/page.tsx \
  "packages/web/app/tournaments/[id]/page.tsx" \
  packages/web/app/competitions/new/page.tsx \
  packages/web/app/tournaments/new/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): apply MONOSPACE_FONT (Orbitron) and typography tokens across all pages

- All 6 pages now use MONOSPACE_FONT (Orbitron-first) (TY-001,005)
- Leaderboard h1 gets Orbitron (TY-002)
- Rank badge colors from ACCENT_GOLD/SILVER/BRONZE tokens (TY-009)
- KICKER_STYLE applied to gallery, leaderboard, analytics kickers (TY-003,004)
- FORM_LABEL_STYLE applied to competitions/new and tournaments/new (TY-008)
- text-transform: uppercase audited and fixed across all 5 pages (TY-006)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 4: Components & Page Polish

Creates the shared TopBar, applies .arena-btn across pages, uses glowShadow on cards, and adds padding-top for the fixed nav.

### Task 9: Create TopBar component

**Files:**
- Create: `packages/web/components/TopBar.tsx`
- Modify: `packages/web/app/layout.tsx`

- [ ] **Step 1: Create the components directory if it doesn't exist**

```bash
mkdir -p "/Users/kstefano/Personal Projects/agentarena/packages/web/components"
```

- [ ] **Step 2: Create TopBar.tsx**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MONOSPACE_FONT, NAV_LETTER_SPACING, FONT_WEIGHT_EXTRABOLD } from '../lib/design-tokens';

const NAV_LINKS = [
  { href: '/competitions/new', label: 'New Battle' },
  { href: '/leaderboard',      label: 'Leaderboard' },
  { href: '/analytics',        label: 'Analytics' },
  { href: '/tournaments/new',  label: 'Tournament' },
];

export function TopBar() {
  const pathname = usePathname();

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      zIndex: 100,
      padding: '0.9rem 2rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'linear-gradient(to bottom, rgba(0,4,8,0.92) 0%, rgba(0,4,8,0) 100%)',
    }}>
      {/* Logo */}
      <Link href="/" style={{ textDecoration: 'none' }}>
        <span style={{
          fontFamily: MONOSPACE_FONT,
          fontSize: '0.75rem', fontWeight: FONT_WEIGHT_EXTRABOLD,
          letterSpacing: '6px', textTransform: 'uppercase',
          color: '#00f0ff',
        }}>
          ARENA<span style={{ color: '#ff6600' }}>4</span>AI
        </span>
      </Link>

      {/* Nav links */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="arena-btn"
            style={pathname === href ? {
              borderColor: 'rgba(0,240,255,0.6)',
              background: 'rgba(0,240,255,0.1)',
            } : undefined}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Add TopBar to layout.tsx**

In `packages/web/app/layout.tsx`, add the TopBar import and render it inside `<body>` above `<main>`:

```tsx
import { TopBar } from '../components/TopBar';

// Inside <body>:
<TopBar />
<main style={{ position: 'relative', zIndex: 2, paddingTop: '3.5rem' }}>{children}</main>
```

Note: `paddingTop: '3.5rem'` prevents page content from starting under the fixed nav bar.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p "/Users/kstefano/Personal Projects/agentarena/packages/web/tsconfig.json"
```

Expected: no errors. If `usePathname` causes issues with server/client mismatch, ensure TopBar has `'use client'` at the top (already included above).

- [ ] **Step 5: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add packages/web/components/TopBar.tsx packages/web/app/layout.tsx
git commit -m "$(cat <<'EOF'
feat(web): add fixed TopBar component to layout — TRON nav with logo + nav links (CP-001)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### Task 10: Apply .arena-btn + glowShadow across pages

**Files:**
- Modify: `packages/web/app/page.tsx`
- Modify: `packages/web/app/leaderboard/page.tsx`
- Modify: `packages/web/app/analytics/page.tsx`
- Modify: `packages/web/app/competitions/new/page.tsx`
- Modify: `packages/web/app/tournaments/new/page.tsx`

- [ ] **Step 6: Set up usePathname in gallery page**

Check whether `page.tsx` already imports `usePathname`. If not, add it:
```ts
import { usePathname } from 'next/navigation';
```

Then inside the component, add:
```ts
const pathname = usePathname();
```

This enables active-state detection for nav links in the steps below.

- [ ] **Step 7: Replace inline button styles with .arena-btn in gallery page**

In `packages/web/app/page.tsx`, find all nav link `<button>` or `<Link>` elements with inline button styles (around lines 282–307). Replace inline styles with `className="arena-btn"` or `className="arena-btn-primary"` as appropriate:

- Nav links (Analytics, Leaderboard, Replay, etc.) → `className="nav-link arena-btn"`
- "New Battle" CTA → `className="arena-btn-primary new-comp-btn"`

**Important:** Some buttons have conditional or dynamic styles (e.g. active state, model-based color). Do NOT remove those — instead, add the className alongside the existing `style` prop:

```tsx
{/* Before */}
<Link href="/leaderboard" style={{ border: '1px solid rgba(0,240,255,0.35)', padding: '0.4rem 0.9rem' }}>
  Leaderboard
</Link>

{/* After — keep style for dynamic parts; className handles base appearance */}
<Link
  href="/leaderboard"
  className="arena-btn"
  style={pathname === '/leaderboard' ? { borderColor: 'rgba(0,240,255,0.6)', background: 'rgba(0,240,255,0.1)' } : undefined}
>
  Leaderboard
</Link>
```

If the inline style is fully static and duplicates what `.arena-btn` already provides (border, padding, font, letter-spacing, text-transform), remove it entirely and keep only the className. If the style has truly dynamic parts (computed from state), keep just the dynamic parts and add the className.

- [ ] **Step 8: Apply .arena-card className to gallery competition cards**

In `packages/web/app/page.tsx`, verify the competition card elements already use `className="arena-card"`:
```bash
grep -n "arena-card" "/Users/kstefano/Personal Projects/agentarena/packages/web/app/page.tsx"
```

If no matches (the CSS class in globals.css handles hover glow), find the card div at lines 536–540 and add `className="arena-card"`. Remove inline style properties that duplicate what `.arena-card` provides (background, border). Keep any dynamic `style` props that set per-competition colors.

- [ ] **Step 9: Apply .arena-btn in leaderboard page**

In `packages/web/app/leaderboard/page.tsx`, find nav link buttons and the "New Battle" CTA (lines ~185–204). Apply same className+style pattern as gallery. Also add `import { usePathname } from 'next/navigation';` and `const pathname = usePathname();` if not already present, to enable active-state styling.

- [ ] **Step 10: Apply .arena-btn in analytics page**

In `packages/web/app/analytics/page.tsx`, find the back-link and nav buttons (lines ~140–177). Apply `className="arena-btn"` following the same pattern.

- [ ] **Step 11: Apply .arena-btn to form page submit buttons**

CP-002 also covers form pages. In `packages/web/app/competitions/new/page.tsx` and `packages/web/app/tournaments/new/page.tsx`, find the submit/CTA buttons (typically `<button type="submit">`). Apply `className="arena-btn-primary"`. Do NOT change form input styles (those are handled by `.arena-form` CSS class from globals.css).

- [ ] **Step 12: Typecheck**

```bash
npx tsc --noEmit -p "/Users/kstefano/Personal Projects/agentarena/packages/web/tsconfig.json"
```

Expected: no errors.

- [ ] **Step 13: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add \
  packages/web/app/page.tsx \
  packages/web/app/leaderboard/page.tsx \
  packages/web/app/analytics/page.tsx \
  packages/web/app/competitions/new/page.tsx \
  packages/web/app/tournaments/new/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): apply .arena-btn and .arena-card across all pages (CP-002,010)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### Task 11: Final typecheck + visual verification

- [ ] **Step 14: Full typecheck**

```bash
npx tsc --noEmit -p "/Users/kstefano/Personal Projects/agentarena/packages/web/tsconfig.json"
```

Expected: no errors.

- [ ] **Step 15: Visual verification checklist**

Start the dev server and verify:

```bash
cd "/Users/kstefano/Personal Projects/agentarena/packages/web" && npm run dev
```

Open http://localhost:3001 and check:

| Check | Expected |
|-------|---------|
| Grid visible | 48px grid, barely visible cyan lines |
| Scanlines | Subtle CRT texture over entire page |
| Corner brackets | 4 cyan corners, 18px, faint |
| Ambient glow | Subtle cyan radial glow from center-top |
| TopBar | Fixed, fades from near-black at top |
| TopBar logo | "ARENA4AI" in Orbitron, orange "4" |
| Page headings | Orbitron font visible (distinct from monospace) |
| Gallery nav links | TRON-styled cyan-border buttons |
| New Battle CTA | Filled cyan button |
| Competition cards | Hover glow effect |

- [ ] **Step 16: Commit any final cleanup**

If any visual issues required small fixes during verification, commit those now:

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add -A packages/web/
git commit -m "$(cat <<'EOF'
fix(web): visual verification tweaks post-implementation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Success Criteria

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Grid is 48px × 48px, opacity 0.025, fixed (BG-001,002)
- [ ] Scanlines overlay visible on all pages (BG-003)
- [ ] Corner brackets visible in all 4 corners (BG-004)
- [ ] TopBar fixed at top on all pages with logo + nav (CP-001)
- [ ] Orbitron font used on all page headings (TY-001)
- [ ] `GLOBAL_STYLES` removed from `[id]/page.tsx` (CP-007)
- [ ] No inline `<style>` blocks in gallery or leaderboard (CP-007)
- [ ] `.arena-btn` used for nav links and CTAs across all 5 pages (CP-002)
- [ ] `text-transform: uppercase` applied consistently on all kicker/stamp elements (TY-006)
- [ ] All animation keyframes defined once in globals.css (CP-007)
- [ ] `design-tokens.ts` exports MONOSPACE_FONT, SPACING, FORM_LABEL_STYLE, STAMP_STYLE, KICKER_STYLE, ACCENT_GOLD/SILVER/BRONZE (Chunk 2)
