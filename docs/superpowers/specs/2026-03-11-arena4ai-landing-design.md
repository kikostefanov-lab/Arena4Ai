# Arena4Ai Marketing Landing Page — Design Spec

**Date:** 2026-03-11
**Domains:** arena4.ai / arena4ai.com
**Status:** Approved

---

## Goal

A single cinematic, SEO-heavy marketing page for Arena4Ai that teases the product with Hollywood suspense aesthetics, collects early registrant emails, and deploys to Cloudflare Pages with a serverless email-capture backend.

---

## Visual Design

**Theme:** TRON-inspired cinematic dark. Near-black background (`#000408`), TRON grid texture, scanlines overlay, corner bracket marks, Orbitron/monospace typography.

**Approved mockup:** `.superpowers/brainstorm/50668-1773222494/cinematic-v3.html`

**Palette:**
- Background: `#000408`
- Accent cyan: `#00f0ff`
- Accent orange: `#ff6600`
- Text primary: `#c8eef8`
- Text muted: `#4a8fa8`
- Text dim: `#1e4a5a`

**No model names.** Framing is fully abstract — "Your Models vs Any Problem."

---

## Page Structure

### 1. Fixed Nav
- Left: `ARENA4AI` logo (monospace, cyan, with orange `4`)
- Right: "Early Access" CTA button (cyan border, ghost style)

### 2. Hero Section
- Classification stamp: `◆ CLASSIFIED · LAUNCHING SOON`
- Wordmark: `ARENA4AI` with gradient (cyan → blue)
- Tagline: *"May the best model win."*
- Arena graphic: two large SVG hexagon shields side by side
  - Left (cyan): **"Your Models"** / sub: "bring any model"
  - VS divider (center diamond + "VS")
  - Right (orange): **"Any Problem"** / sub: "define the brief"
- Sub-tagline: *"Any model. Any problem. One winner."*
- Email capture form (input + "Get Early Access" button)
- Form note: "No spam · First to know when we open"
- Scroll hint arrow

### 3. Act II — What Is Arena4Ai
- Kicker: "What Is Arena4Ai"
- Headline: *"Set the brief. Deploy your models. Let them fight for it."*
- Body copy describing the platform concept (no model names)

### 4. Divider

### 5. Four Acts Section
| Act | Title | Copy focus |
|-----|-------|------------|
| I   | The Brief   | You define the problem, objective, rubric |
| II  | The Battle  | Agents race in parallel, watch in real time |
| III | The Verdict | Blind AI judge scores against rubric |
| IV  | The Forge   | Synthesize the best of both into one deliverable |

### 6. Bottom CTA
- Kicker: "The competition starts soon"
- Headline: *"Claim your spot before the gates open."*
- Body: founding member status, priority access, no credit card
- Second email capture form
- Domain callout: `arena4.ai · arena4ai.com`

### 7. Footer
- Logo (dim), copyright, Privacy / Contact links

---

## Email Capture Backend

**Stack:** Cloudflare Workers + D1 (SQLite)

**D1 Schema:**
```sql
CREATE TABLE IF NOT EXISTS registrants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT DEFAULT 'landing'
);
```

**Worker endpoint:** `POST /api/register`
- Request: `{ email: string }`
- Validates email format
- Inserts into D1 (ignores duplicate — returns 200 with `{ ok: true, duplicate: true }`)
- Returns `{ ok: true }` on success
- Rate limit: Cloudflare's built-in (no custom logic needed for MVP)
- CORS: allow the two domains (`arena4.ai`, `arena4ai.com`) + localhost for dev

**Worker endpoint:** `GET /api/registrants` (protected)
- Query param `?key=<admin_key>` checked against Worker env var `ADMIN_KEY`
- Returns JSON list of all emails + timestamps
- Simple admin access for the owner to see signups

---

## SEO

**Title:** `Arena4Ai — May the best model win`
**Description:** `Arena4Ai is a competitive AI platform where your models race to solve structured problems. One winner. Blind judging. Real results. Get early access.`
**OG/Twitter cards:** title, description, image (generated or placeholder)
**Canonical:** `https://arena4.ai`
**Keywords in body copy:** AI agent competition, model evaluation, LLM benchmark, AI battle, automated judging

---

## File Structure

```
marketing/
├── index.html          # Static landing page
├── styles.css          # Extracted CSS (or inline in <style>)
├── worker/
│   ├── index.js        # Cloudflare Worker (email endpoint)
│   └── wrangler.toml   # Cloudflare Worker config
└── README.md           # Deployment steps
```

---

## Deployment

### Static Site (Cloudflare Pages)
1. Push `marketing/` to a GitHub repo (or use direct upload)
2. Cloudflare Pages → New Project → connect repo, root = `marketing/`, build = none
3. Custom domains: `arena4.ai`, `arena4ai.com` → both point to Pages project
4. `www` redirects handled via Pages redirect rules

### Worker (Email Backend)
1. `cd marketing/worker && npx wrangler login`
2. Create D1: `npx wrangler d1 create arena4ai-registrants`
3. Copy DB ID into `wrangler.toml`
4. Run migration: `npx wrangler d1 execute arena4ai-registrants --file=./schema.sql`
5. Set secret: `npx wrangler secret put ADMIN_KEY`
6. Deploy: `npx wrangler deploy`
7. Update `API_URL` constant in `index.html` to point to deployed worker URL

---

## Constraints

- Single `index.html` — no build step, no framework, no npm for the page itself
- CSS inline in `<style>` tag (keeps it self-contained)
- Worker is vanilla JS (no TypeScript, no bundler)
- No third-party analytics on day 1 (keep it clean)
- No model names anywhere on the page
