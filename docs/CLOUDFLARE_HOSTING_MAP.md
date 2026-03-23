# Atria Surface Map and Cloudflare Hosting Plan

## Product surfaces

### 1. `atria.so` — customer-facing web app

This is the main Atria product for end users and account holders.

Codebase:

- Repo root: `/Users/fin/.openclaw/workspace/Atria`
- Framework: Next.js App Router + React
- Auth: Supabase Auth
- Data: PostgreSQL via Drizzle
- API surface: Next.js `/api/*` routes inside the same app

What lives here:

- login flow
- customer dashboard
- properties
- inspections
- user profile / account access
- upload and vision API routes

This is the product website and application runtime that should own:

- `https://atria.so`
- `https://www.atria.so`

## 2. Mobile app — inspection client

This is the phone-based inspection app used in the field.

Codebase:

- Repo path: `/Users/fin/.openclaw/workspace/Atria/mobile`
- Framework: Expo / React Native

What it does:

- signs into the same Atria account system
- calls the same Atria backend API
- captures inspections, photos, and property data from the phone

Important note:

The mobile app is **not** "hosted on Cloudflare" in the same way a website is. It is distributed through mobile app channels, but its backend API should point to the Cloudflare-hosted Atria web/API origin.

## 3. `mc.atria.so` — Mission Control

This is the business operations console, not the customer product.

Codebase:

- Repo path: `/Users/fin/Documents/atria-mission-control`
- Runtime: local Node/Express app on the Mac mini

What lives here:

- operational command center
- schedulers
- repo checks
- OpenClaw / Fin / Codex / Claude workflows
- approvals, incidents, support escalations, QA status

This should not be merged into the customer-facing `atria.so` deployment.

Recommended hostname:

- `https://mc.atria.so`

Recommended exposure model:

- Cloudflare Tunnel + Access to the Mac mini

## Relationship between the three

### Atria web app -> Mission Control

The main Atria app already treats Mission Control as a separate integration.

- The Atria product repo emits operational events to Mission Control through `MISSION_CONTROL_URL`
- Mission Control receives incidents, support tickets, CI failures, and release requests as operations signals

### Mobile app -> Atria web/API

The mobile app authenticates against Supabase and then calls the Atria backend API using Bearer tokens.

That means the mobile app depends on the customer-facing Atria backend, not on Mission Control.

## Cloudflare hosting map

### `atria.so`

- Deploy the Next.js product app from `/Users/fin/.openclaw/workspace/Atria`
- Use Cloudflare Workers for the full-stack Next.js deployment path
- Keep product auth, API routes, and customer dashboard on this origin

### `www.atria.so`

- Redirect to `atria.so` or serve the same product app

### `mc.atria.so`

- Keep Mission Control running on the Mac mini
- Expose it through Cloudflare Tunnel
- Protect it with Cloudflare Access

### Mobile app

- Keep building with Expo / EAS / native app distribution
- Point production API config to the Cloudflare-hosted Atria backend

## Operating rule

Keep these planes separate:

- product plane: `atria.so`
- operations plane: `mc.atria.so`
- device client: mobile app

Do not collapse Mission Control into the customer product deployment.

## Next prep steps

1. Finish DNS propagation for `atria.so`
2. Complete `mc.atria.so` tunnel + Access on Cloudflare
3. Prepare the Atria Next.js app for Cloudflare Workers deployment
4. Decide whether product API stays on `atria.so/api/*` or moves to `api.atria.so`
5. Update mobile production API config to match the final hosted Atria backend
