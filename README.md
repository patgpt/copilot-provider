# copilot-provider

`copilot-provider` is an AI SDK-compatible provider that sends `generateText()` and `streamText()` requests through the GitHub Copilot SDK.

It is set up to publish from `dist/`, includes a Bun-powered example app, and ships GitHub issue/publish automation for a clean npm release flow.

## What it supports

- `generateText`
- `streamText`
- system prompts
- JSON output requests via prompt injection
- latest-user-message file attachments via Copilot blob/file attachments
- provider helpers such as `listModels()`, `getAuthStatus()`, and `createClient()`

## Current limitations

- Conversation history is flattened into a transcript because Copilot sessions do not accept raw AI SDK message history.
- Tool calling is not currently surfaced as AI SDK tool calls.
- Embeddings and image generation are not implemented.
- AI SDK sampling controls such as `temperature`, `topP`, `topK`, `seed`, and `maxOutputTokens` are not mapped directly to Copilot session settings, so the provider emits warnings when you use them.

## Install

```bash
bun add copilot-provider ai
```

or:

```bash
npm install copilot-provider ai
```

## Quick start

```ts
import { generateText } from "ai";
import { copilot } from "copilot-provider";

const result = await generateText({
  model: copilot("gpt-5"),
  prompt: "Write a concise release note for a new SDK provider.",
});

console.log(result.text);
```

Streaming:

```ts
import { streamText } from "ai";
import { copilot } from "copilot-provider";

const result = streamText({
  model: copilot("gpt-5"),
  prompt: "Explain how this provider works.",
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

With explicit GitHub auth:

```ts
import { createCopilot } from "copilot-provider";

const githubCopilot = createCopilot({
  githubToken: process.env.COPILOT_GITHUB_TOKEN,
  useLoggedInUser: false,
});
```

## Authentication

The GitHub Copilot SDK can authenticate with:

- `COPILOT_GITHUB_TOKEN`
- `GH_TOKEN`
- `GITHUB_TOKEN`
- a previously authenticated Copilot CLI / `gh auth` session when `useLoggedInUser` stays enabled
- BYOK session providers via the Copilot SDK `provider` session option

For local development, a placeholder `.env` and tracked `.env.example` are included at the repo root:

```bash
COPILOT_GITHUB_TOKEN=your_github_token_here
BUN_PUBLIC_COPILOT_MODEL=gpt-5
```

## Local example app

The Bun chat demo lives in `example/` and uses `useChat` with the local provider over `POST /api/chat`.

To run it from the repository root:

```bash
bun install
cd example && bun install
bun run example:dev
```

Then open the local Bun server URL printed in the terminal.

If a user provides a valid GitHub token, yes — the example should work and stream responses through the provider.

## Package scripts

- `bun run build` — build the publishable library into `dist/`
- `bun run dev` — rebuild the library on file changes
- `bun test` — run Bun tests from `tests/`
- `bun run typecheck` — type-check the library sources
- `bun run example:dev` — run the Bun example server
- `bun run example:build` — build the example app
- `bun run check:all` — lint, test, type-check, and build both the library and example

## npm publish flow

This repository now includes:

- a publish-ready `package.json` that exports `dist/index.js` and `dist/index.d.ts`
- a GitHub Actions CI workflow
- a GitHub Actions npm publish workflow that runs on `main`

To enable publishing, add this repository secret:

- `NPM_TOKEN`

The publish workflow skips `npm publish` when the current `package.json` version is already available on npm.

## Development

```bash
bun test
bun run typecheck
bun run build
bun run example:build
```

## Issue reporting

See `ISSUES.md` for triage guidance and the repository issue templates for bug reports and feature requests.
