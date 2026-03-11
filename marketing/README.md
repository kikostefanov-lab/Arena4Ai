# Arena4Ai Marketing Site

Static landing page + Cloudflare Workers email backend.

## Prerequisites

- Cloudflare account (free tier works)
- `npm install -g wrangler` (Cloudflare CLI)
- `wrangler login` (authenticate)

---

## Part 1 — Deploy the Email Worker

### 1. Create the D1 database

```bash
cd marketing/worker
npx wrangler d1 create arena4ai-registrants
```
To access your new D1 Database in your Worker, add the following snippet to your configuration file:
[[d1_databases]]
binding = "arena4ai_registrants"
database_name = "arena4ai-registrants"
database_id = "fdcb9eec-5005-4382-b547-00abbcdbead4"


Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 2. Run the schema migration

```bash
npx wrangler d1 execute arena4ai-registrants --file=./schema.sql
```

### 3. Set the admin secret

```bash
npx wrangler secret put ADMIN_KEY
# Enter a strong random string when prompted — save it somewhere safe
```
Yellowheart13!1974

### 4. Deploy the Worker

```bash
npx wrangler deploy
```

The output will show your worker URL, e.g.:
`https://arena4ai-worker.YOUR_SUBDOMAIN.workers.dev`
https://arena4ai-worker.kikostefanov.workers.dev
### 5. Test the Worker

```bash
# Register an email
curl -X POST https://arena4ai-worker.kikostefanov.workers.dev/api/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
# Expected: {"ok":true}

# List registrants (replace YOUR_KEY)
curl "https://arena4ai-worker.kikostefanov.workers.dev/api/registrants?key=YOUR_KEY"
# Expected: {"ok":true,"count":1,"registrants":[...]}
```

### 6. (Optional) Add a custom domain to the Worker

In Cloudflare Dashboard → Workers → arena4ai-worker → Settings → Domains & Routes:
- Add route: `api.arena4.ai/*` → Worker

---

## Part 2 — Deploy the Landing Page (Cloudflare Pages)

### 1. Update the API_URL in index.html

Open `marketing/index.html` and find this line near the bottom:

```js
const API_URL = 'https://arena4ai-worker.YOUR_SUBDOMAIN.workers.dev/api/register';
```

Replace `YOUR_SUBDOMAIN` with your actual Cloudflare subdomain from the deploy output. Example:

```js
const API_URL = 'https://arena4ai-worker.acmecorp.workers.dev/api/register';
```

If you added a custom route (e.g. `api.arena4.ai`), use that instead:

```js
const API_URL = 'https://api.arena4.ai/api/register';
```

### 2. Deploy via Cloudflare Pages (Direct Upload)

```bash
# From repo root:
npx wrangler pages deploy marketing --project-name=arena4ai-landing
```

On first run, Wrangler will create the Pages project. After deploy you get a URL like:
`https://arena4ai-landing.pages.dev`
https://0c3451c5.arena4ai-landing.pages.dev
### 3. Connect custom domains

In Cloudflare Dashboard → Pages → arena4ai-landing → Custom Domains:
- Add `arena4.ai` → follow DNS verification steps
- Add `arena4ai.com` → same
- Add `www.arena4.ai` → redirects to apex automatically

### 4. Redeploy after any HTML changes

```bash
npx wrangler pages deploy marketing --project-name=arena4ai-landing
```

---

## Part 3 — Viewing Registrants

```bash
curl "https://arena4ai-worker.kikostefanov.workers.dev/api/registrants?key=Yellowheart13!1974"
```

Or query D1 directly:

```bash
cd marketing/worker
npx wrangler d1 execute arena4ai-registrants --command="SELECT * FROM registrants ORDER BY created_at DESC;"
```

---

## Local dev tip

The `file://` origin is never allowed by CORS. To test forms locally, serve from localhost:

```bash
cd marketing
python3 -m http.server 8080
# Open http://localhost:8080
```

`localhost:8080` is already in `ALLOWED_ORIGINS` in the Worker — no changes needed.
