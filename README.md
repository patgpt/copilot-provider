# copilot-provider

An AI SDK `ProviderV3` that runs text generation through the GitHub Copilot SDK.

## What It Supports

- `generateText`
- `streamText`
- System prompts
- JSON output requests via prompt injection
- Latest-user-message file attachments via Copilot blob/file attachments

## Current Limits

- Conversation history is flattened into a transcript because Copilot sessions do not accept raw AI SDK message history.
- Tool calling is not exposed as AI SDK tool calls.
- Embeddings and image generation are not implemented.
- AI SDK sampling controls such as `temperature`, `topP`, `topK`, `seed`, and `maxOutputTokens` are not mapped to Copilot session settings, so the provider emits warnings when you use them.

## Install

```bash
bun install
```

## Usage

```ts
import { generateText } from 'ai';
import { copilot } from 'copilot-provider';

const result = await generateText({
  model: copilot('gpt-5'),
  prompt: 'Write a concise release note for a new SDK provider.',
});

console.log(result.text);
```

With explicit GitHub auth:

```ts
import { createCopilot } from 'copilot-provider';

const githubCopilot = createCopilot({
  githubToken: process.env.COPILOT_GITHUB_TOKEN,
  useLoggedInUser: false,
});
```

Streaming:

```ts
import { streamText } from 'ai';
import { copilot } from 'copilot-provider';

const result = streamText({
  model: copilot('gpt-5'),
  prompt: 'Explain how this provider works.',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

## Auth Notes

The GitHub Copilot SDK supports:

- Explicit `githubToken`
- Environment variables such as `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, and `GITHUB_TOKEN`
- Stored Copilot CLI login / `gh auth` when `useLoggedInUser` is left enabled
- BYOK session providers via the Copilot SDK `provider` session option

Reference: [GitHub Copilot SDK auth docs](https://github.com/github/copilot-sdk/blob/main/docs/auth/index.md)

## Provider Helpers

The exported provider also includes:

- `copilot.listModels()` to query models available to the current auth context
- `copilot.getAuthStatus()` to inspect Copilot auth state
- `copilot.createClient()` to access the raw `CopilotClient` when you need lower-level SDK features

## Development

```bash
bun test
bun run typecheck
```
