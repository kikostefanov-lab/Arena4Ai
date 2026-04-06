# Arena4AI Public Launch — Design Spec

**Date:** 2026-04-06
**Status:** Draft for review
**Goal:** Take Arena4AI from a single-tenant local dev tool to a hosted SaaS open beta with social login, BYOK API keys, K8s-sandboxed competitions, and a free + paid tier model.

---

## Goals & Non-Goals

### Goals
- **Open beta scale**: hundreds of users, public sign-up, basic horizontal scaling (not thousands).
- **Hosted SaaS**: we run the infrastructure at arena4.ai. Users sign up, add their own LLM API keys, run competitions in our cloud.
- **Multi-tenant**: every competition, brief, persona, agent is owned by a user; users only see their own data plus public/system resources.
- **Secure sandboxing**: each competing agent runs in its own K8s pod with strict pod security, network egress allowlist, and a hard time limit.
- **BYOK with trust**: user API keys are stored encrypted at rest with KMS-backed envelope encryption, never logged, decrypted only at runtime, wiped after use.
- **Sustainable**: free tier for hobbyists, paid tiers ($19 / $99) for builders and studios. Stripe-managed billing.

### Non-Goals (v1)
- Microservices architecture (deferred — monolith ships first).
- Async job queue (deferred to Phase 6 when concurrency demands it).
- Team / organization sharing (only individual user accounts in v1).
- Usage-based billing (flat tiers only — simpler tax/refund handling).
- Self-hosted distribution (SaaS only; open-source repo stays available but no Docker Compose package).
- AI-judge / Forge / Reels generation paid by us — these all consume the user's own API keys.

---

## High-Level Architecture

**Approach: Monolith-first → Job Queue (when needed).**

We deploy the existing Express + Next.js codebase as a single Docker image to a Kubernetes cluster. Agent sandboxes are *separate* K8s pods spawned per competition by a `K8sSandboxManager` (replacing the current local `SandboxManager`). This is the smallest change that gets us deployable, multi-tenant, and secure.

```
                     Users (browser)
                          │
                          │  HTTPS / WSS
                          ▼
                 nginx-ingress + cert-manager
                          │
                          ▼
              ┌───────────────────────────┐
              │   Kubernetes Cluster      │
              │                           │
              │  ┌─────────────────────┐  │
              │  │  Arena Pod (×2)     │  │
              │  │  Next.js + Express  │  │
              │  │  Competition runner │  │
              │  └────────┬────────────┘  │
              │           │ K8s API       │
              │           ▼               │
              │  ┌─────────────────────┐  │
              │  │  Agent Sandbox Pods │  │
              │  │  arena-agent:latest │  │
              │  │  (1 per team)       │  │
              │  └─────────────────────┘  │
              │                           │
              │  ┌──────────┬──────────┐  │
              │  │ Postgres │  Redis   │  │
              │  │ (managed)│ (managed)│  │
              │  └──────────┴──────────┘  │
              │                           │
              │  ┌──────────────────────┐ │
              │  │  KMS / Secrets Mgr   │ │
              │  └──────────────────────┘ │
              └───────────────────────────┘
                          │
                          │  Sandbox pods call out
                          ▼
            ┌──────────────────────────────┐
            │ Anthropic / OpenAI / Google  │
            │     (with USER's API keys)   │
            └──────────────────────────────┘
```

**Why monolith first:** the current codebase is a tightly-integrated Express + Next.js + competition runner. Refactoring it into services before we have a single paying user is wasted work. Monolith with horizontal pod replicas handles open-beta scale (hundreds of users, ~30 concurrent competitions) without changing the business logic. When we hit the worker-thread bottleneck, Phase 6 splits the runner into a queue-driven worker deployment.

**Why K8s pods (not Docker-in-Docker):** the existing `SandboxManager` uses local Docker. In a hosted environment, DinD is fragile and security-questionable. Spawning K8s pods directly via the cluster API gives us native pod security policies, network policies, resource quotas, and clean teardown — all things K8s does well.

---

## Component Inventory

### Reused (no change)
- `competition-runner.ts` — orchestrates a competition. The interface stays the same; only the sandbox manager swaps out.
- All adapters (`ClaudeAdapter`, `CodexAdapter`, `GeminiAdapter`) — they read API keys from env vars; the env now comes from a per-competition K8s Secret instead of the parent process.
- All judging, presentation, synthesis, forge, reel pipelines.
- The Drizzle schema for `competitions`, `events`, `results`, `tournaments`, `briefs`, `personas`, `agents`.

### New
- **Auth layer** — Auth.js v5 with Google + GitHub OAuth providers, JWT session cookies.
- **`users`, `sessions`, `user_api_keys`, `usage_records`, `subscriptions` tables** — see Data Model below.
- **`KeyStore`** — wraps a KMS provider (AWS KMS, GCP KMS, or Vault Transit), exposes `encrypt(plaintext) → ciphertext` and `decrypt(ciphertext) → plaintext`. Uses envelope encryption with per-record data keys.
- **`K8sSandboxManager`** — implements the same interface as `SandboxManager` but spawns K8s pods via the cluster API (using `@kubernetes/client-node`). Creates a per-competition Secret, mounts it as env vars, deletes both on cleanup.
- **`PlanGate` middleware** — checks `req.user.plan` against feature requirements and monthly quota before allowing the request.
- **Stripe webhook handler** — updates `users.plan` and `subscriptions` on subscription events.
- **Production Dockerfile** — multi-stage build for the monolith.
- **Helm chart** — Deployment, Service, Ingress, ConfigMap, Secret refs, NetworkPolicy, RBAC for the K8s API permissions the arena pod needs.
- **GitHub Actions workflows** — lint, typecheck, test, build, push image, deploy.

### Modified
- All HTTP routes in `packages/orchestrator/src/server/` — wrapped in auth middleware, ownership checks added on read/write.
- All web API routes in `packages/web/app/api/` — same.
- Existing rate limiters — switched from per-IP to per-user (Redis-backed).
- `SandboxManager` interface — remains, but `K8sSandboxManager` is the new default in production. Local Docker manager is kept for dev.

---

## Data Model Changes

### New Tables

```sql
-- Auth
users {
  id            uuid PK
  email         text UNIQUE NOT NULL
  name          text
  avatarUrl     text
  provider      text NOT NULL          -- 'google' | 'github'
  providerId    text NOT NULL
  plan          text NOT NULL DEFAULT 'free'  -- 'free' | 'pro' | 'team'
  createdAt     timestamp DEFAULT now()
  lastLoginAt   timestamp
  UNIQUE(provider, providerId)
}

sessions {
  id            uuid PK
  userId        uuid NOT NULL FK → users(id) ON DELETE CASCADE
  tokenHash     text UNIQUE NOT NULL  -- SHA-256 of session token
  expiresAt     timestamp NOT NULL
  createdAt     timestamp DEFAULT now()
}

-- BYOK
user_api_keys {
  id            uuid PK
  userId        uuid NOT NULL FK → users(id) ON DELETE CASCADE
  provider      text NOT NULL          -- 'anthropic' | 'openai' | 'google'
  encrypted     text NOT NULL          -- AES-256-GCM ciphertext (base64)
  dataKeyWrapped text NOT NULL         -- KMS-wrapped data key (base64)
  keyHint       text NOT NULL          -- last 4 chars for UI display
  validatedAt   timestamp              -- last successful API ping
  createdAt     timestamp DEFAULT now()
  UNIQUE(userId, provider)
}

-- Usage tracking (for cost transparency)
usage_records {
  id              uuid PK
  userId          uuid NOT NULL FK → users(id) ON DELETE CASCADE
  competitionId   uuid NOT NULL FK → competitions(id) ON DELETE CASCADE
  provider        text NOT NULL
  inputTokens     int NOT NULL DEFAULT 0
  outputTokens    int NOT NULL DEFAULT 0
  estimatedCostUsd numeric(10,4) NOT NULL DEFAULT 0
  recordedAt      timestamp DEFAULT now()
}

-- Billing
subscriptions {
  id                  uuid PK
  userId              uuid NOT NULL FK → users(id) ON DELETE CASCADE
  stripeCustomerId    text UNIQUE NOT NULL
  stripeSubscriptionId text UNIQUE
  status              text NOT NULL    -- 'active' | 'past_due' | 'canceled'
  currentPeriodEnd    timestamp
  plan                text NOT NULL    -- 'pro' | 'team'
  updatedAt           timestamp DEFAULT now()
}
```

### Modified Tables

Add a nullable `userId` column to:
- `competitions` (NOT NULL after migration; existing rows assigned to a system user)
- `tournaments` (NOT NULL after migration)
- `briefs` (nullable — `NULL` means public/system brief, e.g. yaml-seeded)
- `personas` (nullable — `NULL` means public/system persona)
- `agents` (nullable — `NULL` means public/system agent)

**Visibility rule:** a user can read a row if `userId IS NULL` OR `userId = currentUser.id`. Mutations require `userId = currentUser.id`. The `created_by` text field already on `personas`/`agents` is dropped in favor of `userId`.

---

## Auth Flow

1. User clicks "Sign in with Google" or "Sign in with GitHub" on the landing page.
2. Auth.js handles OAuth handshake, returns to `/api/auth/callback/{provider}`.
3. Callback inserts into `users` (or finds existing by `provider + providerId`), creates a session row, sets a JWT session cookie.
4. Subsequent requests → middleware decodes the JWT, looks up the session, attaches `req.user` (id, email, plan).
5. Mutation routes wrap with `requireAuth()`; resource routes wrap with `requireOwnership(table, idParam)`.
6. Logout clears the cookie and deletes the session row.

**No password reset, no email verification flow needed** — OAuth providers handle identity.

---

## BYOK — Key Storage and Use

### Storage
1. User pastes their key into `/settings/keys` and clicks save.
2. `POST /api/keys` — server makes a low-cost test call to the provider (e.g., list models for OpenAI). If it fails, return an error and don't store anything.
3. On success: generate a fresh AES-256-GCM data key, encrypt the plaintext, wrap the data key with the KMS master key, store both in `user_api_keys`.
4. The plaintext is wiped from server memory immediately after storage.
5. UI displays last-4 hint (`sk-...XYZ9`), validation timestamp, and rotate/delete buttons.

### Use at runtime
1. User starts a competition.
2. Arena pod loads the user's encrypted keys for the providers in use.
3. Decrypts each in memory.
4. Creates a Kubernetes Secret named `arena-keys-<competitionId>` containing the keys as env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`).
5. Spawns sandbox pods with `envFrom: secretRef: arena-keys-<competitionId>`.
6. Wipes the in-memory plaintext immediately after the secret is created.
7. On competition end (success or failure): delete the pod, then delete the secret.

### Trust commitments (public security page)
- Keys are never logged, never returned to the client after save, never written to disk in plaintext.
- KMS master key is held in a managed service (AWS KMS / GCP KMS / Vault Transit) that we cannot export.
- The encryption code is in the open-source repo so users can audit it.
- Per-competition usage records show estimated cost so users can reconcile against their provider dashboards.

---

## Sandboxing

### Pod spec (per agent team)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: arena-sandbox-<competitionId>-<teamId>
  labels:
    arena/competition: <competitionId>
    arena/team: <teamId>
spec:
  restartPolicy: Never
  activeDeadlineSeconds: 600  # 10-minute hard kill
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: agent
    image: arena-agent:latest
    imagePullPolicy: IfNotPresent
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
    resources:
      limits:
        cpu: "2"
        memory: "4Gi"
        ephemeral-storage: "5Gi"
      requests:
        cpu: "500m"
        memory: "1Gi"
    envFrom:
    - secretRef:
        name: arena-keys-<competitionId>
    volumeMounts:
    - name: workspace
      mountPath: /workspace
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: workspace
    emptyDir:
      medium: Memory
      sizeLimit: 2Gi
  - name: tmp
    emptyDir: {}
```

### NetworkPolicy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: arena-sandbox-egress
spec:
  podSelector:
    matchLabels:
      arena/role: sandbox
  policyTypes: ["Egress"]
  egress:
  # DNS only to kube-dns
  - to:
    - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: kube-system}}
      podSelector: {matchLabels: {k8s-app: kube-dns}}
    ports: [{port: 53, protocol: UDP}]
  # HTTPS only to provider APIs (resolved via CIDR or via DNS-based egress controller)
  - to:
    - ipBlock:
        cidr: 0.0.0.0/0
    ports: [{port: 443, protocol: TCP}]
  # Block all internal cluster traffic
```

(Note: a stricter implementation uses an egress gateway like Cilium FQDN-based policies. For v1, port-443-only egress with no internal access is acceptable.)

### Lifecycle
- **Spawn**: arena pod calls K8s API to create the Secret then the Pod.
- **Stream**: arena pod tails the sandbox pod's stdout via the K8s API for normalizer events.
- **Collect**: on agent completion, arena pod reads `/workspace` via `kubectl cp` (or equivalent client lib call) for deliverables.
- **Cleanup**: pod and secret are deleted whether competition succeeds, fails, or times out.

---

## Plans, Limits, Billing

### Plan tiers

| Feature | Free | Pro ($19/mo) | Team ($99/mo) |
|---|---|---|---|
| Competitions / month | 10 | 200 | unlimited |
| Teams per competition | 2 | 4 | 8 |
| Time limit | 5 min | 15 min | 30 min |
| Concurrent competitions | 1 | 3 | 5 |
| Private competitions | ❌ | ✅ | ✅ |
| Tournaments | ❌ | ✅ | ✅ |
| Forge artifacts | ❌ | ✅ | ✅ |
| Recap reels | ❌ | ✅ | ✅ |
| Adversarial judging | ❌ | ❌ | ✅ |
| API access | ❌ | ❌ | ✅ |
| Custom personas | ❌ | ✅ | ✅ |
| Support | community | email | priority |

### Rate limiting (Redis-backed, per user)

| Endpoint | Limit |
|---|---|
| `POST /competitions` | plan-aware monthly quota + concurrent cap |
| `POST /competitions/:id/forge` | 5/min |
| `POST /competitions/:id/synthesis` | 5/min |
| `POST /generate-brief` | 20/min |
| `POST /generate-persona` | 20/min |

Plus per-IP limits on auth endpoints (`POST /auth/*`: 10/min) to prevent unauthenticated abuse.

### Billing

- **Stripe Checkout** for new subscriptions, **Customer Portal** for plan changes / cancellations / invoice history.
- Webhook handler updates `users.plan` and `subscriptions.status` on `customer.subscription.*` and `invoice.payment_failed` events.
- 3-day grace period after a failed payment before downgrading to free.
- No usage-based billing in v1.

**Disclosure**: users still pay LLM providers directly via their own API keys. Arena fees cover infrastructure, sandboxing, and platform features only. Disclosed at sign-up and on the pricing page.

---

## Implementation Roadmap

The phases are sequenced so each one ships independently and the platform stays functional throughout.

### Phase 0 — Foundation
- Production multi-stage `Dockerfile` for the arena monolith.
- Helm chart: Deployment (2 replicas), Service, Ingress with cert-manager TLS, ConfigMap for non-secret config, Secret refs for DB URL and KMS credentials.
- GitHub Actions workflow: lint → typecheck → test → build → push image to registry → deploy via `helm upgrade`.
- Migration runner Job that runs on each deploy.
- Structured logging (pino), Sentry for errors, readiness/liveness probes.
- Set up managed PostgreSQL (RDS or Cloud SQL) and managed Redis.

### Phase 1 — Auth & Multi-tenancy
- Install Auth.js v5, configure Google + GitHub OAuth.
- Migrations for `users`, `sessions`.
- Add `userId` columns to existing tables (nullable initially, backfilled, then constraints tightened).
- `requireAuth` middleware on all mutation endpoints.
- `requireOwnership` middleware on resource routes (with public-fallback for `userId IS NULL`).
- Sign-in page, user menu in TopBar, `/settings` page shell.
- Migrate dev data to a "system" user (NULL userId for public resources).

### Phase 2 — BYOK Key Management
- `KeyStore` class with KMS provider abstraction.
- Migrations for `user_api_keys`, `usage_records`.
- `POST /api/keys` (validate + encrypt + store), `DELETE /api/keys/:provider`.
- `/settings/keys` UI: add key, validation status, last-4 hint, rotate/delete.
- Adapters read keys from request context when running in user mode (CLI mode keeps env-var behavior).

### Phase 3 — Sandbox Hardening
- New `K8sSandboxManager` implementing the same interface as the existing `SandboxManager`.
- Per-competition Secret create/cleanup logic.
- NetworkPolicy YAML in the Helm chart.
- PodSecurityContext, resource quotas, `activeDeadlineSeconds`.
- End-to-end test: spawn pod → run agent → collect deliverables → cleanup.

### Phase 4 — Billing & Plans
- Stripe account, Products/Prices for Pro and Team.
- Migrations for `subscriptions`.
- Stripe webhook handler.
- Stripe Checkout + Customer Portal integration.
- `PlanGate` middleware applied to feature routes (Forge, Reels, Tournaments, Adversarial).
- Per-user rate limits in Redis (replacing per-IP).
- Monthly quota tracking with reset job.
- `/settings/billing` page.

### Phase 5 — Polish & Launch
- Onboarding flow: sign-in → add first key → run first competition with a sample brief.
- Marketing landing page (currently the gallery is the landing page).
- Privacy policy, ToS, security page (with key handling disclosure).
- Status page.
- Email infrastructure (Resend or Postmark): welcome email, billing receipts.
- Load test: 50 concurrent competitions sustained for 1 hour.
- Soft launch to beta waitlist, monitor, then open public sign-up.

### Phase 6 — Future (post-launch, when needed)
- Refactor the competition runner into a Redis/BullMQ job queue.
- Split into web pod + worker pod deployments.
- WebSocket fan-out via Redis pub/sub.
- HPA autoscaling on worker pods based on queue depth.

---

## Open Questions

1. **Cloud provider** — AWS, GCP, or DigitalOcean for the K8s cluster? Affects KMS choice and managed-DB pricing.
2. **Domain & email** — is `arena4.ai` already registered? Need a transactional email provider too.
3. **Sample briefs** — onboarding needs 3-5 polished sample briefs that demonstrate value within the free tier limits.
4. **Egress control** — is the simple "all 443 outbound" NetworkPolicy acceptable for v1, or do we want a Cilium-style FQDN allowlist from day one?
5. **Image registry** — GitHub Container Registry (free for public), Docker Hub, or cloud-native (ECR/GCR)?

These don't block the design — they're decisions to make during Phase 0.
