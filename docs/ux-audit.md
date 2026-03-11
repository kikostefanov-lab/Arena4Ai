# Arena4Ai UX Audit

**Date:** 2026-03-11
**Audited by:** 4-agent UX review team (Senior Orchestrator + 3 specialists)
**Scope:** Web app (`packages/web`) vs. Marketing landing page (`marketing/index.html`)

---

## Executive Summary

- **Brand coherence is broken at the layout root.** Three signature TRON effects — scanlines overlay, corner bracket HUD elements, and the background grid — are either absent or misconfigured in the web app's root layout, meaning every page in the product feels visually disconnected from the marketing site.
- **Orbitron, the brand typeface, is loaded but barely used.** It is wired up in `layout.tsx` and applied on only one of six primary pages (the arena page). The remaining five pages fall back to SF Mono, erasing the TRON identity from the most-visited surfaces.
- **No shared navigation component exists.** Each page independently reinvents its header with different layouts, font sizes, and padding — there is no fixed top bar anchoring the product across routes.
- **Design tokens are underutilized.** `design-tokens.ts` exports utilities like `glowShadow()` that are never imported. Badge colors, font stacks, spacing values, and button styles are hardcoded inline across five or more pages rather than drawn from a central source.
- **CSS architecture is fragmented.** Animations are defined in three separate files; a 170-line `GLOBAL_STYLES` string is injected as a `<style>` tag inside a React component; and there is no fixed-position background layer architecture at the layout root.

---

## Merge Notes

- **CP-006 merged into CP-007.** Both findings targeted animation CSS duplication. CP-007 ("GLOBAL_STYLES in Arena Page") was the more detailed version and explicitly named the 170-line `GLOBAL_STYLES` string in `[id]/page.tsx`. CP-006 added scope coverage for `page.tsx` and `leaderboard/page.tsx` — that scope has been absorbed into the merged finding CP-007.

---

## Findings Summary

| ID | Severity | Domain | Title | File(s) | Suggested Fix |
|----|----------|--------|-------|---------|---------------|
| BG-001 | Critical | Background | Grid spacing inconsistency (48px vs 40px) | `marketing/index.html`, `globals.css` | Change `background-size` to `48px 48px` in globals.css |
| BG-003 | Critical | Background | Scanlines overlay completely absent from web app | `globals.css`, `layout.tsx` | Add `.scanlines` class + render div in layout.tsx |
| BG-004 | Critical | Background | Corner bracket HUD elements missing from web app | `globals.css`, `layout.tsx` | Add `.corner*` classes + render four divs in layout.tsx |
| TY-001 | Critical | Typography | Orbitron font loaded but unused on 5 of 6 pages | `layout.tsx`, 5 page files | Apply `var(--font-orbitron)` to all page headings |
| CP-001 | Critical | Pages | No fixed top navigation bar | All page files | Create shared `TopBar.tsx` component |
| BG-002 | Major | Background | Grid opacity inconsistency (0.035 vs 0.025) | `marketing/index.html`, `globals.css` | Change grid gradient opacity to `0.025` in globals.css |
| BG-006 | Major | Background | No radial ambient glow on standard web pages | `globals.css`, `layout.tsx` | Add `.hero-glow-center` class and render in layout |
| BG-007 | Major | Background | No hero fade gradient on web app pages | `globals.css`, `layout.tsx` | Add `.hero-fade` class with 220px gradient |
| BG-008 | Major | Background | No fixed-position background layer architecture in layout root | `layout.tsx` | Add fixed-position layer divs (grid-bg, scanlines, corners) |
| TY-002 | Major | Typography | H1 gradient text not using Orbitron on leaderboard | `leaderboard/page.tsx` | Add `fontFamily: var(--font-orbitron)` to h1 |
| TY-003 | Major | Typography | Badge styling hardcoded across components | `design-tokens.ts`, 4 page files | Export `STAMP_STYLE`, `KICKER_STYLE`, `BADGE_PRESETS` |
| CP-002 | Major | Pages | Button styling scattered across 5+ pages, no component | 5 page files | Create `.arena-btn` CSS class in globals.css |
| CP-003 | Major | Pages | Form styling not centralized | `page.tsx`, `competitions/new/page.tsx` | Create `.arena-form` CSS class in globals.css |
| CP-005 | Major | Pages | Spacing/padding rhythm inconsistent, no standardized scale | Multiple pages | Export `SPACING` scale from design-tokens.ts |
| CP-007 | Major | Pages | GLOBAL_STYLES and duplicated animations should be in globals.css | `[id]/page.tsx`, `page.tsx`, `leaderboard/page.tsx`, `globals.css` | Move all animations and GLOBAL_STYLES to globals.css |
| CP-010 | Major | Pages | glowShadow() helper never used; card glow inconsistent | `design-tokens.ts`, 4 page files | Use `glowShadow()` on cards; create `.arena-card` CSS class |
| BG-005 | Minor | Background | `tronScan` keyframe defined but never used | `globals.css` | Delete or apply the unused keyframe |
| TY-004 | Minor | Typography | Letter-spacing inconsistency on kickers (5px vs 3–4px) | 4 page files | Export `LABEL_LETTER_SPACING = '5px'` from design-tokens.ts |
| TY-005 | Minor | Typography | Monospace font stack duplicated across 5 pages | 5 page files | Export `MONOSPACE_FONT` from design-tokens.ts |
| TY-006 | Minor | Typography | `text-transform: uppercase` applied inconsistently | 5 page files | Audit all kicker/stamp/button elements and apply consistently |
| TY-007 | Minor | Typography | Button letter-spacing varies (2px marketing vs 0–2px web) | 3 page files | Export `BUTTON_LETTER_SPACING = '2px'` from design-tokens.ts |
| TY-008 | Minor | Typography | Form label styling hardcoded in every page | `competitions/new`, `tournaments/new` | Export `FORM_LABEL_STYLE` from design-tokens.ts |
| TY-009 | Minor | Typography | Rank/accent badge colors hardcoded | `leaderboard/page.tsx`, `analytics/page.tsx` | Add `ACCENT_GOLD/SILVER/BRONZE` to design-tokens.ts |
| TY-010 | Minor | Typography | Font weights not exported as tokens | `design-tokens.ts`, multiple pages | Export `FONT_WEIGHT_*` constants from design-tokens.ts |
| CP-004 | Minor | Pages | Section dividers lack gradient fades | 4 page files | Add `DIVIDER_GRADIENT` token; apply to section borders |
| CP-008 | Minor | Pages | Empty state styling varied across pages | `page.tsx`, `leaderboard`, `analytics` | Create shared `EmptyState` component |
| CP-009 | Minor | Pages | Hover states use inconsistent colors | `page.tsx`, `leaderboard/page.tsx` | Add `HOVER_DARK` and `HOVER_TEXT` to design-tokens.ts |
| CP-011 | Minor | Pages | Container max-width not centralized | `page.tsx`, `leaderboard`, `analytics` | Add `CONTAINER_MAX_WIDTH = '960px'` to design-tokens.ts |
| CP-012 | Minor | Pages | Link styling scattered | `page.tsx`, `analytics/page.tsx` | Define `.arena-link` in globals.css |

---

## Domain 1: Background Systems

### BG-001: Grid Spacing Inconsistency Across Brand Surfaces

**Severity:** Critical
**Marketing:** `background-size: 48px 48px;` (line 33)
**Web app:** `background-size: 40px 40px;` (line 10, `globals.css`)
**Gap:** The TRON grid background is 8px smaller in the web app (40px) vs. the marketing site (48px). This creates a visually inconsistent grid density that is immediately noticeable on every page and breaks brand coherence.
**Files:** `marketing/index.html` line 33; `packages/web/app/globals.css` line 10
**Fix:** Change `background-size: 40px 40px;` to `background-size: 48px 48px;` in `globals.css` line 10.

---

### BG-002: Grid Opacity Inconsistency

**Severity:** Major
**Marketing:** `linear-gradient(rgba(0,240,255,0.025) 1px, transparent 1px)` (lines 31–32)
**Web app:** `linear-gradient(rgba(0,240,255,0.035) 1px, transparent 1px)` (lines 8–9, `globals.css`)
**Gap:** The web app grid uses 40% higher opacity (0.035 vs. 0.025), creating a denser visual grid that diverges from the marketing intent.
**Files:** `marketing/index.html` lines 31–32; `packages/web/app/globals.css` lines 8–9
**Fix:** Change `rgba(0,240,255,0.035)` to `rgba(0,240,255,0.025)` in both gradient axes in `globals.css` lines 8–9.

---

### BG-003: Scanlines Overlay Completely Absent from Web App

**Severity:** Critical
**Marketing:** `.scanlines { position: fixed; inset: 0; background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px); pointer-events: none; z-index: 1; }` (lines 36–40)
**Web app:** No `.scanlines` class defined or rendered in `globals.css` or `layout.tsx`.
**Gap:** The marketing page has a persistent CRT scanlines effect overlaid on all content. The web app has no equivalent global scanlines overlay on any page. This is a high-visibility signature brand effect.
**Files:** `packages/web/app/globals.css` (not present); `packages/web/app/layout.tsx` (not present)
**Fix:** Add `.scanlines` class to `globals.css`. Render `<div className="scanlines" />` in `layout.tsx` as a fixed overlay behind all content.

---

### BG-004: Corner Bracket HUD Elements Missing from Web App

**Severity:** Critical
**Marketing:** `.corner { position: fixed; width: 18px; height: 18px; z-index: 50; opacity: 0.25; }` plus four variant classes (`.corner-tl`, `.corner-tr`, `.corner-bl`, `.corner-br`) with cyan borders (lines 41–45). Four divs rendered in HTML (lines 202–205).
**Web app:** No `.corner*` classes defined anywhere; no corner bracket elements rendered.
**Gap:** The marketing page has cyan corner bracket HUD elements at all four screen corners. Completely absent from the web app. These brackets are a signature TRON brand marker visible on every screen.
**Files:** `packages/web/app/globals.css` (not present); `packages/web/app/layout.tsx` (not present)
**Fix:** Add corner bracket classes to `globals.css`. Render four corner divs in `layout.tsx` globally.

---

### BG-005: `tronScan` Keyframe Defined But Never Used

**Severity:** Minor
**Marketing:** Not defined in marketing site.
**Web app:** `@keyframes tronScan { 0% { background-position: 0 -100%; } 100% { background-position: 0 200%; } }` defined at lines 26–29 in `globals.css` but no CSS class applies it.
**Gap:** Dead code. Minor bundle weight and maintenance confusion.
**Files:** `packages/web/app/globals.css` lines 26–29
**Fix:** Either delete the unused keyframe or apply it to a `.scanlines` or grid element class.

---

### BG-006: No Radial Ambient Glow on Standard Web Pages

**Severity:** Major
**Marketing:** `.hero-glow-center { position: absolute; inset: 0; background: radial-gradient(ellipse 70% 55% at 50% 45%, rgba(0,240,255,0.06) 0%, transparent 70%); pointer-events: none; }` (lines 70–74)
**Web app:** Radial glow only exists in the arena `PreBattleScreen` component. Not applied globally to standard pages.
**Gap:** The marketing hero has a persistent radial ambient glow. The gallery, leaderboard, analytics, and form pages have no equivalent, making the web app feel flat.
**Files:** `packages/web/app/globals.css` (not defined); `packages/web/app/layout.tsx` (not applied)
**Fix:** Add `.hero-glow-center` class to `globals.css`. Apply as a fixed/absolute div at layout level or per-page root.

---

### BG-007: No Hero Fade Gradient on Web App Pages

**Severity:** Major
**Marketing:** `.hero-fade { position: absolute; bottom: 0; left: 0; right: 0; height: 220px; background: linear-gradient(to top, #000408, transparent); pointer-events: none; }` (line 75)
**Web app:** No equivalent fade gradient defined anywhere globally.
**Gap:** Marketing uses a 220px bottom fade gradient for visual depth at section transitions. Web app has no such gradient, making page sections feel harder and less cinematic.
**Files:** `packages/web/app/globals.css` (not present); `packages/web/app/layout.tsx` (not applied)
**Fix:** Add `.hero-fade` class to `globals.css`. Use at page or section boundaries.

---

### BG-008: No Fixed-Position Background Layer Architecture in Layout Root

**Severity:** Major
**Marketing:** Grid background, scanlines, and corner brackets are all `position: fixed` with `inset: 0`, rendered as root-level HTML elements (lines 29, 37, 41).
**Web app:** `layout.tsx` applies `background: '#000408'` as a single inline style on the `<body>` tag (line 19). No fixed overlay layers render persistently behind page content.
**Gap:** Marketing achieves its layered depth by stacking fixed elements at the document root. The web app body has a flat background with no layer architecture, so adding any of the missing effects (scanlines, glow, corners) requires structural changes to `layout.tsx`.
**Files:** `packages/web/app/layout.tsx` line 19
**Fix:** Extend `layout.tsx` to include fixed-position background layer divs (grid-bg, scanlines, corner brackets) rendered persistently behind `{children}`.

---

## Domain 2: Typography & Badges

### TY-001: Orbitron Font Loaded But Unused on 5 of 6 Main Pages

**Severity:** Critical
**Marketing:** Uses generic `font-family: monospace` throughout — does not use Orbitron.
**Web app:** `layout.tsx` loads Orbitron via `next/font/google` (weights 400/700/900) and exposes CSS variable `--font-orbitron` (lines 5–18). Only `competitions/[id]/page.tsx` applies `var(--font-orbitron)`. Gallery, leaderboard, analytics, tournaments/new, and competitions/new all use a hardcoded SF Mono stack.
**Gap:** Orbitron is the brand typeface for Arena4Ai but is effectively invisible on the five most-visited pages. The TRON identity evaporates on every route except the live arena.
**Files:** `packages/web/app/layout.tsx` lines 5–18; `packages/web/app/page.tsx` line 234; `packages/web/app/leaderboard/page.tsx` line 103; `packages/web/app/analytics/page.tsx` line 106; `packages/web/app/competitions/new/page.tsx` line 108; `packages/web/app/tournaments/new/page.tsx` lines 162, 185
**Fix:** Replace hardcoded SF Mono font stack on all pages with `"var(--font-orbitron), 'SF Mono', monospace"`. Export a shared `ORBITRON_FONT` constant from `design-tokens.ts`.

---

### TY-002: H1 Gradient Text Not Using Orbitron on Leaderboard

**Severity:** Major
**Marketing:** Wordmark uses gradient text with monospace font.
**Web app:** Leaderboard `h1` (lines 158–165) has a gradient text effect but no `--font-orbitron` variable applied — falls back to SF Mono stack.
**Gap:** The gradient h1 on the gallery applies Orbitron correctly. The leaderboard gradient h1 uses the wrong font, creating a visible inconsistency between primary pages.
**Files:** `packages/web/app/leaderboard/page.tsx` lines 158–165
**Fix:** Add `fontFamily: "var(--font-orbitron), 'SF Mono', monospace"` to the leaderboard `h1` style.

---

### TY-003: Badge Styling Hardcoded Across Components Instead of Centralized

**Severity:** Major
**Marketing:** `.stamp` single CSS class reused consistently everywhere with uniform styling.
**Web app:** `design-tokens.ts` exports `STATE_STYLES`, `MODEL_BADGE_COLORS`, `FORMAT_BADGES` but many pages hardcode inline badge styles. `page.tsx` lines 575–612, 618–641, 697–706; `leaderboard/page.tsx` lines 61–64; `analytics/page.tsx` lines 50–55. No exported `STAMP_STYLE` or `KICKER_STYLE` objects exist.
**Gap:** Badge styling is fragmented across five files. Inconsistency in border-radius, padding, and letter-spacing is inevitable without a central definition.
**Files:** `packages/web/lib/design-tokens.ts`; `packages/web/app/page.tsx` lines 575–641, 697–706; `packages/web/app/leaderboard/page.tsx` lines 61–64; `packages/web/app/analytics/page.tsx` lines 50–55
**Fix:** Export `STAMP_STYLE`, `KICKER_STYLE`, and `BADGE_PRESETS` from `design-tokens.ts`. Update all pages to import and use these instead of inlining.

---

### TY-004: Letter-Spacing Inconsistency on Kickers (5px marketing vs 3–4px web app)

**Severity:** Minor
**Marketing:** `.stamp`, `.logo`, `.bottom-kicker` all use `letter-spacing: 5px`.
**Web app:** `page.tsx` kicker: 4px; `leaderboard/page.tsx`: 4px; `analytics/page.tsx`: 3px; `competitions/new/page.tsx`: no explicit spacing.
**Gap:** Marketing standardizes kicker spacing at 5px; the web app varies between 3px and 4px or omits it entirely.
**Files:** `packages/web/app/page.tsx` line 225; `packages/web/app/leaderboard/page.tsx` line 150; `packages/web/app/analytics/page.tsx` line 151; `packages/web/app/competitions/new/page.tsx` line 597
**Fix:** Add `LABEL_LETTER_SPACING = '5px'` to `design-tokens.ts`. Apply to all kicker/stamp/label elements.

---

### TY-005: Monospace Font Stack Duplicated Across 5 Pages

**Severity:** Minor
**Marketing:** Uses generic `font-family: monospace`.
**Web app:** The string `"'SF Mono', 'Fira Code', 'Cascadia Code', monospace"` is duplicated verbatim in `page.tsx` (line 159), `leaderboard/page.tsx` (line 103), `analytics/page.tsx` (line 106), `competitions/new/page.tsx` (line 108), and `tournaments/new/page.tsx` (lines 162, 185).
**Gap:** Consistent but not DRY. A single fallback font change requires editing five files.
**Files:** All five page files listed above
**Fix:** Export `MONOSPACE_FONT = "'SF Mono', 'Fira Code', 'Cascadia Code', monospace"` from `design-tokens.ts`. Import in all pages. Note: this finding is a subset of TY-001 — resolved together when `ORBITRON_FONT` is adopted.

---

### TY-006: `text-transform: uppercase` Applied Inconsistently to Labels, Kickers, and Buttons

**Severity:** Minor
**Marketing:** `.stamp`, `.nav-cta`, `.agent-label`, `.tagline` all uppercase.
**Web app:** Mostly consistent but some secondary buttons and badge variants are missing `text-transform`.
**Gap:** Sporadic omissions break the all-caps brand voice on secondary surfaces.
**Files:** `packages/web/app/page.tsx`; `packages/web/app/leaderboard/page.tsx`; `packages/web/app/analytics/page.tsx`; `packages/web/app/competitions/new/page.tsx`; `packages/web/app/tournaments/new/page.tsx`
**Fix:** Audit all `.kicker`, `.stamp`, `.nav-link`, and button elements. Apply `textTransform: 'uppercase'` consistently. Include in the `STAMP_STYLE` and `KICKER_STYLE` token objects (TY-003).

---

### TY-007: Button Letter-Spacing Varies (2px marketing vs 0–2px web app)

**Severity:** Minor
**Marketing:** `.nav-cta`: 1.5px; signup button: 2px.
**Web app:** Gallery CTA button has no explicit letter-spacing; `tournaments/new` CTA: 2px but team selection buttons: 0.5px; `competitions/new` varies.
**Gap:** Marketing standardizes at 1.5–2px range; web app is inconsistent with some buttons at 0px.
**Files:** `packages/web/app/page.tsx` lines 289, 300, 302; `packages/web/app/leaderboard/page.tsx` line 188; `packages/web/app/tournaments/new/page.tsx` lines 269, 659
**Fix:** Export `BUTTON_LETTER_SPACING = '2px'` and `NAV_LETTER_SPACING = '1.5px'` from `design-tokens.ts`. Apply to button and nav-link elements.

---

### TY-008: Form Label Styling Hardcoded in Every Page

**Severity:** Minor
**Marketing:** No form labels (marketing is a single signup form only).
**Web app:** `competitions/new/page.tsx` and `tournaments/new/page.tsx` define `labelStyle` inline in 15+ places: `color: '#4a8fa8', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700`.
**Gap:** Consistent within each file but not shared — any design update requires editing two files in multiple locations.
**Files:** `packages/web/app/competitions/new/page.tsx` (lines 806–1363, scattered); `packages/web/app/tournaments/new/page.tsx` (lines 167–175)
**Fix:** Export `FORM_LABEL_STYLE` constant from `design-tokens.ts`. Import in both form pages.

---

### TY-009: Rank/Accent Badge Colors Hardcoded Instead of Using Design Tokens

**Severity:** Minor
**Marketing:** No rank badges.
**Web app:** Leaderboard rank badges hardcode gold (`#eab308`), silver (`#94a3b8`), bronze (`#b47c3c`) inline (lines 61–64). Analytics `FORMAT_BADGE_CONFIG` is also inline (lines 50–55). No `ACCENT_GOLD`/`ACCENT_SILVER`/`ACCENT_BRONZE` exist in `design-tokens.ts`.
**Gap:** Color values are not source-of-truth in the tokens file — maintenance burden and inconsistency risk.
**Files:** `packages/web/lib/design-tokens.ts`; `packages/web/app/leaderboard/page.tsx` lines 61–64; `packages/web/app/analytics/page.tsx` lines 50–55
**Fix:** Add `ACCENT_GOLD`, `ACCENT_SILVER`, `ACCENT_BRONZE` to `design-tokens.ts`. Import in leaderboard and analytics pages.

---

### TY-010: Font Weights Not Exported as Tokens

**Severity:** Minor
**Marketing:** Wordmark/stamp/nav-cta use weight 800–900.
**Web app:** `design-tokens.ts` has no `FONT_WEIGHT_*` exports. Pages hardcode `700`, `800`, `900` inline.
**Gap:** No single source of truth for font weight scale.
**Files:** `packages/web/app/layout.tsx` line 7 (loads 400/700/900); `packages/web/lib/design-tokens.ts`
**Fix:** Export `FONT_WEIGHT_REGULAR = 400`, `FONT_WEIGHT_BOLD = 700`, `FONT_WEIGHT_EXTRABOLD = 900` from `design-tokens.ts`.

---

## Domain 3: Pages & Components

### CP-001: No Fixed Top Navigation Bar — Navigation Pattern Breaks Brand Coherence

**Severity:** Critical
**Marketing:** `.top-bar` (lines 47–51): `position: fixed`, full-width, gradient fade background, logo on left + CTA button on right.
**Web app:** `page.tsx` (gallery) has an inline header (lines 213–310); `leaderboard/page.tsx` has its own header (lines 140–207); the arena page has no traditional nav; each page reinvents navigation locally with different layouts and styles.
**Gap:** Marketing has a globally consistent fixed header visible on every page. The web app has no fixed header. Users lose brand anchoring on every route change. Navigation font sizes, padding, and link styles differ between all pages.
**Files:** `packages/web/app/page.tsx` lines 213–310; `packages/web/app/leaderboard/page.tsx` lines 140–207; `packages/web/app/analytics/page.tsx` lines 130–178; `packages/web/app/tournaments/[id]/page.tsx`; `packages/web/app/competitions/[id]/page.tsx`; `packages/web/app/competitions/new/page.tsx`
**Fix:** Create shared `TopBar.tsx` component in `packages/web/components/` mirroring marketing's `.top-bar`: fixed position, full-width, gradient fade, logo left + nav links right. Mount in `layout.tsx`.

---

### CP-002: Button Styling Scattered Across 5+ Pages — No Unified Component

**Severity:** Major
**Marketing:** `.nav-cta` (lines 54–60): small uppercase monospace, `border: 1px solid rgba(0,240,255,0.35)`, transparent background, `padding: 0.45rem 1.1rem`, `letter-spacing: 1.5px`, hover increases background opacity.
**Web app:** Gallery nav links (lines 286–291): `fontSize: 0.65rem`, `padding: 0.45rem 0.85rem`, `border: 1px solid #0a2235`; Gallery CTA (lines 299–304): `background: #00f0ff`, `color: #000408`; Leaderboard (lines 185–201): `fontSize: 0.62rem`, different padding; Analytics: back link `fontSize: 0.62rem`, `padding: 0.35rem 0.7rem`. Each page redefines button styles inline with variations.
**Gap:** No shared button component or CSS class. Font size varies 0.62–0.7rem; padding, border-radius (4–6px), and letter-spacing are all inconsistent. No page matches the marketing's `1.5px` letter-spacing.
**Files:** `packages/web/app/page.tsx` lines 286–307; `packages/web/app/leaderboard/page.tsx` lines 185–204; `packages/web/app/analytics/page.tsx` lines 140–177; `packages/web/app/competitions/new/page.tsx`; `packages/web/app/tournaments/[id]/page.tsx`
**Fix:** Create `.arena-btn` and `.arena-btn-primary` CSS classes in `globals.css` matching the marketing `.nav-cta` pattern. Use consistently across all pages.

---

### CP-003: Form Styling Not Centralized

**Severity:** Major
**Marketing:** `.signup-form` (lines 129–139): flex row, bordered input + button, cyan button with orange hover state.
**Web app:** Gallery has a custom search input with absolute icon overlay (lines 316–365). No shared form component or CSS class.
**Gap:** The marketing has a clean, consistent form pattern. The web app has no shared form styling. Gallery search is styled uniquely and differs from form pages.
**Files:** `packages/web/app/page.tsx` lines 316–365; `packages/web/app/competitions/new/page.tsx`
**Fix:** Create shared `.arena-form` CSS class in `globals.css`. Use for search inputs and brief creation forms.

---

### CP-004: Section Dividers Lack Gradient Fades

**Severity:** Minor
**Marketing:** `.divider`: `max-width: 900px; margin: 3rem auto; height: 1px; background: linear-gradient(to right, transparent, #0a2235 30%, #0a2235 70%, transparent)`.
**Web app:** `borderBottom: '1px solid #0a2235'` throughout (`page.tsx` line 217, `leaderboard/page.tsx` line 144, `analytics/page.tsx` line 137) — simple flat lines with no gradient.
**Gap:** Marketing has sophisticated gradient-faded dividers. Web app uses hard-edged flat borders. The flat borders feel blunt compared to the cinematic marketing aesthetic.
**Files:** `packages/web/app/page.tsx` line 217; `packages/web/app/leaderboard/page.tsx` line 144; `packages/web/app/analytics/page.tsx` line 137; `packages/web/app/competitions/[id]/page.tsx`
**Fix:** Add `DIVIDER_GRADIENT = 'linear-gradient(to right, transparent, #0a2235 30%, #0a2235 70%, transparent)'` to `design-tokens.ts`. Apply as `backgroundImage` on a `height: 1px` divider element.

---

### CP-005: Spacing/Padding Rhythm Inconsistent — No Standardized Scale

**Severity:** Major
**Marketing:** Hero `padding: 2rem 2rem 6rem`; act rows `2.5rem 0`; section margins `3rem auto` — consistent rem-based scale.
**Web app:** Gallery header `padding: 1.5rem 0` vs. leaderboard `2rem 0` vs. analytics `1.25rem`; card padding varies (`1rem 1.25rem` vs. `0.85rem 1.1rem`); margin-bottom varies (`1.25rem`, `1.5rem`, `2rem`). Container padding is consistent at `2.5rem 1.5rem` across main pages.
**Gap:** No standardized spacing scale. Gaps between elements vary arbitrarily across pages with no clear design rationale.
**Files:** `packages/web/app/page.tsx` lines 211–217; `packages/web/app/leaderboard/page.tsx` lines 138–144; `packages/web/app/analytics/page.tsx` lines 128–137; scattered throughout
**Fix:** Export `SPACING = { xs: '0.25rem', sm: '0.5rem', md: '1rem', lg: '1.5rem', xl: '2rem', xxl: '3rem', xxxl: '6rem' }` from `design-tokens.ts`. Apply consistently across all pages.

---

### CP-007: Animation Keyframes Duplicated Across Files; GLOBAL_STYLES Must Move to globals.css

**Severity:** Major
**Marketing:** All animations defined once in the HTML `<style>` tag.
**Web app:** `competitions/[id]/page.tsx` contains a 170+ line `GLOBAL_STYLES` string (lines 95–228) injected via `<style>` inside a React component, including `pulse`, `pulseGlow`, `slideIn`, `slideInScore`, `glow`, `judgingPulse`, `spinDot`, `progressReveal`, `borderGlow`, `celebrationFlash`, `scanline`, `msgFade`, `launchFlash`, `launchText`, `winnerFlash`, `winnerBanner`, scrollbar styles, and more. Additionally, `fadeIn` and `pulse` are independently redefined in `page.tsx` (lines 163–209) and `leaderboard/page.tsx` (lines 107–114).
**Gap:** Violates separation of concerns. Three files define animation keyframes. `fadeIn` and `pulse` are duplicated in at least two places. The `GLOBAL_STYLES` injection increases bundle weight, prevents server-side reuse, and makes updates error-prone.

*(Merge note: This finding absorbs CP-006, which identified the same duplication — CP-007 is the more detailed version.)*

**Files:** `packages/web/app/competitions/[id]/page.tsx` lines 95–228; `packages/web/app/page.tsx` lines 163–209; `packages/web/app/leaderboard/page.tsx` lines 107–114; `packages/web/app/globals.css`
**Fix:** Move all keyframes and shared styles from `GLOBAL_STYLES` and page-level `<style>` injections into `packages/web/app/globals.css`. Remove the `GLOBAL_STYLES` constant and its `<style>` tag from `[id]/page.tsx`.

---

### CP-008: Empty State Styling Varied Across Pages

**Severity:** Minor
**Marketing:** No empty state.
**Web app:** Gallery main empty state (lines 479–507): `padding: 5rem 2rem`, `bg: #050f1e`, `border: 1px dashed #0a2235`, `borderRadius: 12px`; Gallery filtered empty (lines 465–475): `padding: 3rem 2rem`, `borderRadius: 8px`; Leaderboard (lines 230–257): `padding: 5rem 2rem`, `borderRadius: 12px`; Analytics error (lines 180–189): `padding: 4rem 2rem`, `bg: rgba(239,68,68,0.06)`, different border.
**Gap:** Similar visual intent but inconsistent padding and border-radius. Analytics error state diverges into a red tint.
**Files:** `packages/web/app/page.tsx` lines 465–507; `packages/web/app/leaderboard/page.tsx` lines 230–257; `packages/web/app/analytics/page.tsx` lines 180–189
**Fix:** Create shared `EmptyState` component. Standardize: `padding: 5rem 2rem`, `borderRadius: 12px`, `bg: #050f1e`, `border: 1px dashed #0a2235`.

---

### CP-009: Hover States Use Inconsistent Colors

**Severity:** Minor
**Marketing:** `.nav-cta:hover` increases background opacity — no explicit hover text color.
**Web app:** Gallery nav link hover: `color: #c8eef8`, `border-color: #0e3050` (lines 199–200); Gallery card hover: `box-shadow: rgba(0,240,255,0.15)` (lines 179–180); Leaderboard row hover: `bg: rgba(10,34,53,0.6)`, `border-color: #0e3050` (lines 119–120); Leaderboard nav links hover: `#c8eef8` (lines 126–127).
**Gap:** Hover colors are not centralized in `design-tokens.ts`. While `#c8eef8` and `#0e3050` appear consistent, they are hardcoded independently in every file.
**Files:** `packages/web/app/page.tsx` lines 195–201; `packages/web/app/leaderboard/page.tsx` lines 118–127
**Fix:** Add `HOVER_DARK = '#0e3050'` and `HOVER_TEXT = '#c8eef8'` to `design-tokens.ts`. Import and use consistently.

---

### CP-010: `glowShadow()` Helper Never Used — Card Glow Inconsistent

**Severity:** Major
**Marketing:** Cards have subtle borders; no explicit glow effect.
**Web app:** `design-tokens.ts` exports a `glowShadow()` helper function (lines 97–100) that is never imported by any page. Arena cards (`page.tsx` line 540) have a dynamic border; hover `box-shadow` (line 180) hardcodes `rgba(0,240,255,0.15)`; leaderboard table border (line 264): `1px solid #0a2235`, no glow; analytics cards (lines 207–211): `border: 1px solid #0a2235` with left-border accent; tournaments cards (line 796): dynamic border.
**Gap:** A glow utility was built but never adopted. Card interactive states use hardcoded shadow values. No consistent card glow pattern across the product.
**Files:** `packages/web/lib/design-tokens.ts` lines 97–100; `packages/web/app/page.tsx` lines 180, 536–540; `packages/web/app/leaderboard/page.tsx` line 264; `packages/web/app/analytics/page.tsx` lines 207–211; `packages/web/app/tournaments/[id]/page.tsx` line 796
**Fix:** Use `glowShadow()` on all interactive card hover states. Export `CARD_BORDER` and `CARD_GLOW` constants. Create `.arena-card` CSS class in `globals.css`.

---

### CP-011: Container Max-Width Not Centralized in Design Tokens

**Severity:** Minor
**Marketing:** Act section `max-width: 900px` (line 156).
**Web app:** Gallery `maxWidth: 960px` (line 211); leaderboard `960px` (line 138); analytics `960px` (line 128).
**Gap:** Consistent at 960px across web pages but not documented as a token. The 60px divergence from marketing's 900px is also undocumented and may be unintentional.
**Files:** `packages/web/app/page.tsx` line 211; `packages/web/app/leaderboard/page.tsx` line 138; `packages/web/app/analytics/page.tsx` line 128
**Fix:** Add `CONTAINER_MAX_WIDTH = '960px'` to `design-tokens.ts`. Import in all three pages.

---

### CP-012: Link Styling Scattered

**Severity:** Minor
**Marketing:** No explicit standalone link styling beyond `.nav-cta` buttons.
**Web app:** Analytics links use `color: #3b82f6`, `textDecoration: none` (lines 591–600); gallery links use `Link` component with inline styles; leaderboard has no explicit link styling.
**Gap:** No consistent link color or hover effect across pages. Analytics uses a generic blue (`#3b82f6`) that is not in the TRON color palette.
**Files:** `packages/web/app/page.tsx` lines 282–295; `packages/web/app/analytics/page.tsx` lines 591–600
**Fix:** Define `.arena-link { color: #00f0ff; text-decoration: none; }` with hover state in `globals.css`. Replace analytics blue link with TRON cyan.

---

## Implementation Priority

### Immediate (Critical)

| ID | Fix |
|----|-----|
| BG-001 | Change `background-size` to `48px 48px` in `globals.css` line 10 |
| BG-003 | Add `.scanlines` class to `globals.css`; render div in `layout.tsx` |
| BG-004 | Add `.corner*` classes to `globals.css`; render four divs in `layout.tsx` |
| TY-001 | Apply `var(--font-orbitron)` to all page headings; export `ORBITRON_FONT` from `design-tokens.ts` |
| CP-001 | Create `packages/web/components/TopBar.tsx`; mount in `layout.tsx` |

### High Priority (Major)

| ID | Fix |
|----|-----|
| BG-002 | Change grid opacity from `0.035` to `0.025` in `globals.css` |
| BG-006 | Add `.hero-glow-center` to `globals.css`; render in layout |
| BG-007 | Add `.hero-fade` to `globals.css` |
| BG-008 | Add fixed-position background layer architecture to `layout.tsx` |
| TY-002 | Add `fontFamily: var(--font-orbitron)` to leaderboard `h1` |
| TY-003 | Export `STAMP_STYLE`, `KICKER_STYLE`, `BADGE_PRESETS` from `design-tokens.ts` |
| CP-002 | Create `.arena-btn` + `.arena-btn-primary` in `globals.css` |
| CP-003 | Create `.arena-form` in `globals.css` |
| CP-005 | Export `SPACING` scale from `design-tokens.ts` |
| CP-007 | Move `GLOBAL_STYLES` and all duplicate keyframes to `globals.css` |
| CP-010 | Adopt `glowShadow()` on card hover states; create `.arena-card` in `globals.css` |

### Polish (Minor)

| ID | Fix |
|----|-----|
| BG-005 | Delete unused `tronScan` keyframe or apply it |
| TY-004 | Export `LABEL_LETTER_SPACING = '5px'`; apply to kicker elements |
| TY-005 | Export `MONOSPACE_FONT` from `design-tokens.ts` |
| TY-006 | Audit and apply `textTransform: 'uppercase'` to all kickers/stamps/buttons |
| TY-007 | Export `BUTTON_LETTER_SPACING` and `NAV_LETTER_SPACING` tokens |
| TY-008 | Export `FORM_LABEL_STYLE` from `design-tokens.ts` |
| TY-009 | Add `ACCENT_GOLD/SILVER/BRONZE` to `design-tokens.ts` |
| TY-010 | Export `FONT_WEIGHT_*` constants from `design-tokens.ts` |
| CP-004 | Add `DIVIDER_GRADIENT` token; apply to section borders |
| CP-008 | Create shared `EmptyState` component |
| CP-009 | Add `HOVER_DARK` + `HOVER_TEXT` to `design-tokens.ts` |
| CP-011 | Add `CONTAINER_MAX_WIDTH = '960px'` to `design-tokens.ts` |
| CP-012 | Define `.arena-link` in `globals.css`; replace analytics blue |
