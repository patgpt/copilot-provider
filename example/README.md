# copilot-provider example

This Bun app demonstrates the local `copilot-provider` package with an AI SDK `useChat` UI.

## What it does

- serves a Bun-powered frontend and API from `src/index.ts`
- exposes `POST /api/chat`
- streams responses with `streamText()` + `toUIMessageStreamResponse()`
- uses the repository root `.env` values for GitHub Copilot auth when launched from the repo root

## Run it

From the repository root:

```bash
bun install
cd example && bun install
cd ..
bun run example:dev
```

## Build it

```bash
bun run example:build
```

## Auth

Provide one of the following environment variables:

- `COPILOT_GITHUB_TOKEN`
- `GH_TOKEN`
- `GITHUB_TOKEN`

Optional:

- `BUN_PUBLIC_COPILOT_MODEL=gpt-5`

If the token is valid, the demo should work out of the box.
