# Vercel Deployment

This repo is the public Atria product application that should serve `atria.so`.
It is separate from Mission Control, which stays on the Mac mini behind
Cloudflare Tunnel and Access at `mc.atria.so`.

## Recommended Architecture

- `atria.so` and `www.atria.so`: Vercel-hosted public Next.js app
- `mc.atria.so`: Cloudflare Access + Tunnel to the Mac mini
- Cloudflare: authoritative DNS for the `atria.so` zone
- Mobile app: points `EXPO_PUBLIC_API_URL` at the hosted Atria origin

## Why Vercel

This codebase is a Node-heavy Next.js application that currently depends on
`sharp` and `onnxruntime-node` in live server paths. Vercel is the lower-friction
host for that stack today because it runs the app in a Node runtime without the
Cloudflare Workers compatibility work that this repo would otherwise need.

## Verified Readiness

On March 23, 2026, the app completed a production-style `npm run build` under
Node `22.22.1` with deployment placeholder environment variables. The remaining
launch work is platform configuration and secrets, not a code portability
problem.

## Vercel Project Settings

- Framework preset: `Next.js`
- Root directory: repo root
- Install command: default
- Build command: default (`npm run build`)
- Output directory: default
- Node.js version: `22.x`
- Production branch: `main`

## Required Vercel Environment Variables

Set these in Vercel for `Production`, `Preview`, and `Development` unless noted
otherwise:

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLAUDE_API_KEY`
- `MISSION_CONTROL_URL=https://mc.atria.so`
- `MISSION_CONTROL_ENABLED=true`

Recommended production-only value:

- `CORS_ALLOWED_ORIGIN=https://atria.so,https://www.atria.so`

Optional:

- `ANTHROPIC_VISION_MODEL`
- `ALLOW_PLACEHOLDER_EMBEDDINGS=0`

## Cloudflare DNS

Keep Cloudflare as the DNS provider for `atria.so`, then attach the custom
domain to the Vercel project:

- `atria.so`
- `www.atria.so`

Cloudflare should point those hostnames to Vercel using the Vercel domain setup
flow. Mission Control should stay on the existing tunnel-backed `mc.atria.so`
hostname.

## Agent-Friendly Deployment Model

To support Codex, Fin, Claude Code, and automation safely:

- Set Vercel production to deploy only from `main`
- Send agent work to `development`, `codex/*`, `claude/*`, or `automation/*`
- Let Vercel create preview deployments for non-production branches
- Protect `main` in GitHub with required checks and reviews
- Treat preview deployments as the automatic landing zone for AI-generated work

This keeps automatic agent shipping fast without letting unattended pushes go
straight to production.

## Launch Checklist

1. Create the Vercel project for this repo.
2. Set the Node version to `22.x`.
3. Add the required environment variables from `.env.example`.
4. Set the production branch to `main`.
5. Confirm preview deployments work from a non-production branch.
6. Attach `atria.so` and `www.atria.so` to the Vercel project.
7. Update the mobile production API URL to the hosted domain.
8. Keep `mc.atria.so` separate on Cloudflare Tunnel + Access.
