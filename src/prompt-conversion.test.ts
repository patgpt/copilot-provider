import { describe, expect, it } from 'bun:test';

import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';

import { prepareCopilotPrompt } from './prompt-conversion';

function createCallOptions(
  overrides: Partial<LanguageModelV3CallOptions>,
): LanguageModelV3CallOptions {
  return {
    prompt: [],
    ...overrides,
  };
}

describe('prepareCopilotPrompt', () => {
  it('keeps a single user message as the direct Copilot prompt', () => {
    const prepared = prepareCopilotPrompt(
      createCallOptions({
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Explain quicksort in one paragraph.' }],
          },
        ],
      }),
    );

    expect(prepared.prompt).toBe('Explain quicksort in one paragraph.');
    expect(prepared.systemMessage).toBeUndefined();
    expect(prepared.attachments).toBeUndefined();
    expect(prepared.warnings).toHaveLength(0);
  });

  it('forwards the latest user file part as a Copilot blob attachment', () => {
    const prepared = prepareCopilotPrompt(
      createCallOptions({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              {
                type: 'file',
                filename: 'diagram.png',
                mediaType: 'image/png',
                data: new Uint8Array([1, 2, 3, 4]),
              },
            ],
          },
        ],
      }),
    );

    expect(prepared.attachments).toEqual([
      {
        type: 'blob',
        data: Buffer.from([1, 2, 3, 4]).toString('base64'),
        mimeType: 'image/png',
        displayName: 'diagram.png',
      },
    ]);
  });

  it('flattens multi-turn history into a transcript and warns about compatibility', () => {
    const prepared = prepareCopilotPrompt(
      createCallOptions({
        prompt: [
          { role: 'system', content: 'Answer crisply.' },
          {
            role: 'user',
            content: [{ type: 'text', text: 'What is Bun?' }],
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'A JavaScript runtime.' }],
          },
          {
            role: 'user',
            content: [{ type: 'text', text: 'Compare it with Node.js.' }],
          },
        ],
      }),
    );

    expect(prepared.systemMessage).toBe('Answer crisply.');
    expect(prepared.prompt).toContain('<conversation>');
    expect(prepared.prompt).toContain('<assistant>');
    expect(
      prepared.warnings.some(
        warning =>
          warning.type === 'compatibility' && warning.feature === 'prompt',
      ),
    ).toBe(true);
  });

  it('injects JSON instructions into the Copilot system message', () => {
    const prepared = prepareCopilotPrompt(
      createCallOptions({
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Return a person object.' }],
          },
        ],
        responseFormat: {
          type: 'json',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
      }),
    );

    expect(prepared.systemMessage).toContain('JSON schema:');
    expect(prepared.systemMessage).toContain(
      'You MUST answer with a JSON object',
    );
    expect(
      prepared.warnings.some(
        warning =>
          warning.type === 'compatibility' &&
          warning.feature === 'responseFormat',
      ),
    ).toBe(true);
  });
});
