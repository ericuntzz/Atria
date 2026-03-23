# Atria Cloudflare Deployment Readiness

## Current goal

Host the Atria customer-facing product on Cloudflare while keeping Mission Control separate.

This document focuses on the **customer-facing Atria product** at:

- `/Users/fin/.openclaw/workspace/Atria`

Mission Control remains separate at:

- `/Users/fin/Documents/atria-mission-control`

## Current status

### Mission Control

- Tunnel object created in Cloudflare
- Mac mini connector is online through `cloudflared`
- Local tunnel process is already targeting `http://127.0.0.1:4310`
- Remaining blocker is DNS activation for `atria.so` plus the `mc.atria.so` Access app / hostname route

### Atria product app

- No Cloudflare deployment config exists yet
- Current repo still documents deployment as `Replit`
- The app is a Next.js full-stack app with auth, database access, and API routes
- The mobile app depends on the product API, not Mission Control

## What Cloudflare supports

Cloudflare's current recommendation for full-stack Next.js is:

- deploy Next.js to **Cloudflare Workers**
- use the **OpenNext adapter**

Cloudflare also offers **Containers**, which can run more traditional Linux/containerized workloads when a pure Workers runtime is not the right fit.

## What we found in this repo

The Atria product is not just a static site or simple SSR app. It includes server-side vision and media-processing paths.

### Customer web app and API

Evidence:

- `src/app/page.tsx`
- `src/app/dashboard/page.tsx`
- `src/lib/auth.ts`
- `server/db.ts`
- `server/schema.ts`

This is the main product runtime for:

- account login
- customer dashboard
- property management
- inspections
- `/api/*` routes

### Mobile app

Evidence:

- `mobile/package.json`
- `mobile/src/lib/api.ts`

The mobile client signs in with Supabase and calls the Atria backend through `EXPO_PUBLIC_API_URL`.

### Mission Control integration

Evidence:

- `src/lib/mission-control.ts`
- `scripts/emit-mission-event.mjs`

The Atria product already treats Mission Control as a separate external operations system through `MISSION_CONTROL_URL`.

## Main deployment risk for Cloudflare Workers

The repo contains server-side paths that currently rely on Node-native or Node-heavy modules in request-serving code:

- `sharp`
- `onnxruntime-node`
- local filesystem access for model availability checks

Key files:

- `src/lib/vision/geometric-verify.ts`
- `src/lib/vision/embeddings.ts`
- `src/lib/vision/keyframe-dedupe.ts`
- `src/lib/vision/preflight-gate.ts`
- `src/app/api/vision/compare-stream/route.ts`
- `src/app/api/embeddings/route.ts`
- `src/app/api/properties/[id]/train/route.ts`

This does **not** automatically mean Cloudflare deployment is impossible.

It **does** mean:

- we should not assume the entire current app can be dropped onto Workers unchanged
- the vision/training paths need a dedicated compatibility pass
- the product deployment decision should be made intentionally, not by trial and error on production DNS

## Recommended deployment options

### Option 1 — Preferred long-term shape

Deploy the main Atria web app to **Cloudflare Workers** using the OpenNext adapter, but first split or adapt the Node-native vision/training paths.

Best when:

- we want the cleanest Cloudflare-native architecture
- we are willing to refactor server-native routes

Likely work:

- audit all server routes for Worker/runtime compatibility
- isolate `sharp` / `onnxruntime-node` logic behind a separate service boundary if needed
- run preview validation in the Cloudflare runtime before moving production DNS

### Option 2 — Best near-term fit if we want Cloudflare-hosted infrastructure without rewriting the vision stack first

Run the Atria product in **Cloudflare Containers** or another Cloudflare-fronted containerized runtime shape, where Node-native dependencies are a better fit.

Best when:

- we want to stay on Cloudflare
- we do not want to first rewrite media / ONNX server logic for Workers

Tradeoff:

- more operational complexity than a pure Workers deployment

### Option 3 — Cloudflare in front, app runtime elsewhere

Use Cloudflare for DNS, SSL, WAF, and protection while the current Atria app runtime stays on a Node-friendly host.

Best when:

- speed matters more than runtime consolidation
- we want a low-risk intermediate stage

Tradeoff:

- not "fully hosted on Cloudflare" in the strict runtime sense

## Recommendation right now

1. Finish `mc.atria.so` via Tunnel + Access first
2. Do **not** point `atria.so` production traffic at a Workers deployment until the Atria app has passed a Cloudflare compatibility check
3. Evaluate whether Atria's vision and training APIs should:
   - stay inside the Next app after adaptation, or
   - move into a separate Node/container service

## Immediate next engineering step

Prepare the Atria product repo for a **Cloudflare preview assessment**, not production cutover:

1. Add Cloudflare/OpenNext deployment scaffolding in a branch
2. Run a preview build
3. Identify which routes fail in the Workers runtime
4. Decide whether to:
   - keep pushing toward Workers, or
   - switch the product runtime plan to Cloudflare Containers
