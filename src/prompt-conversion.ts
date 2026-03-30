import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FilePart,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  SharedV3Warning,
} from '@ai-sdk/provider';
import {
  injectJsonInstructionIntoMessages,
  mediaTypeToExtension,
  removeUndefinedEntries,
} from '@ai-sdk/provider-utils';
import type { MessageOptions } from '@github/copilot-sdk';

import { fileURLToPath } from 'node:url';

type CopilotAttachment = NonNullable<MessageOptions['attachments']>[number];

export interface PreparedCopilotPrompt {
  prompt: string;
  attachments?: MessageOptions['attachments'];
  systemMessage?: string;
  warnings: SharedV3Warning[];
}

export function prepareCopilotPrompt(
  options: LanguageModelV3CallOptions,
): PreparedCopilotPrompt {
  const warnings: SharedV3Warning[] = [];
  const warningKeys = new Set<string>();

  const warn = (warning: SharedV3Warning) => {
    const details =
      'details' in warning && warning.details != null
        ? `:${warning.details}`
        : 'message' in warning
          ? `:${warning.message}`
          : '';
    const key =
      warning.type === 'other'
        ? `${warning.type}:${warning.message}`
        : `${warning.type}:${warning.feature}${details}`;

    if (warningKeys.has(key)) {
      return;
    }

    warningKeys.add(key);
    warnings.push(warning);
  };

  const prompt =
    options.responseFormat?.type === 'json'
      ? injectJsonInstructionIntoMessages({
          messages: options.prompt,
          schema: options.responseFormat.schema,
        })
      : options.prompt;

  if (options.responseFormat?.type === 'json') {
    warn({
      type: 'compatibility',
      feature: 'responseFormat',
      details:
        'JSON output is requested via system-prompt injection because Copilot does not expose a native JSON mode through the SDK.',
    });
  }

  for (const feature of unsupportedCallSettings(options)) {
    warn({
      type: 'unsupported',
      feature,
      details:
        'GitHub Copilot sessions do not expose this AI SDK setting directly.',
    });
  }

  if (
    options.providerOptions != null &&
    Object.keys(options.providerOptions).length > 0
  ) {
    warn({
      type: 'unsupported',
      feature: 'providerOptions',
      details:
        'Call-level provider options are not supported by this compatibility layer.',
    });
  }

  const systemMessage = joinNonEmpty(
    prompt
      .filter(message => message.role === 'system')
      .map(message => message.content),
  );

  const conversationalMessages = prompt.filter(message => message.role !== 'system');

  const lastUserIndex = findLastIndex(
    conversationalMessages,
    message => message.role === 'user',
  );

  const renderedMessages = conversationalMessages.map((message, index) =>
    renderMessage(message, {
      allowAttachments: index === lastUserIndex,
      warn,
    }),
  );

  const attachments = renderedMessages.flatMap(message => message.attachments);
  const directUserMessage =
    conversationalMessages.length === 1 &&
    conversationalMessages[0]?.role === 'user'
      ? renderedMessages[0]
      : undefined;

  if (conversationalMessages.length > 1) {
    warn({
      type: 'compatibility',
      feature: 'prompt',
      details:
        'Structured conversation history is flattened into a single Copilot prompt.',
    });
  }

  const renderedPrompt =
    directUserMessage != null
      ? directUserMessage.content
      : buildConversationPrompt(renderedMessages);

  return {
    prompt:
      renderedPrompt.trim().length > 0
        ? renderedPrompt
        : 'Continue from the conversation above.',
    attachments: attachments.length > 0 ? attachments : undefined,
    systemMessage: systemMessage || undefined,
    warnings,
  };
}

function unsupportedCallSettings(
  options: LanguageModelV3CallOptions,
): string[] {
  const features: string[] = [];

  if (options.maxOutputTokens != null) features.push('maxOutputTokens');
  if (options.temperature != null) features.push('temperature');
  if (options.stopSequences?.length) features.push('stopSequences');
  if (options.topP != null) features.push('topP');
  if (options.topK != null) features.push('topK');
  if (options.presencePenalty != null) features.push('presencePenalty');
  if (options.frequencyPenalty != null) features.push('frequencyPenalty');
  if (options.seed != null) features.push('seed');
  if (options.tools?.length) features.push('tools');
  if (options.toolChoice != null) features.push('toolChoice');

  return features;
}

function buildConversationPrompt(
  messages: Array<{ role: string; content: string }>,
): string {
  const renderedMessages = messages
    .map(
      message =>
        `<${message.role}>\n${message.content || '[no textual content]'}\n</${message.role}>`,
    )
    .join('\n\n');

  return [
    'Continue the conversation below and answer the most recent user request.',
    '',
    '<conversation>',
    renderedMessages,
    '</conversation>',
  ].join('\n');
}

function renderMessage(
  message: LanguageModelV3Message,
  context: {
    allowAttachments: boolean;
    warn: (warning: SharedV3Warning) => void;
  },
): { role: string; content: string; attachments: NonNullable<MessageOptions['attachments']> } {
  switch (message.role) {
    case 'user':
      return renderUserMessage(message, context);
    case 'assistant':
      return {
        role: 'assistant',
        content: renderAssistantMessage(message, context.warn),
        attachments: [],
      };
    case 'tool':
      return {
        role: 'tool',
        content: renderToolMessage(message, context.warn),
        attachments: [],
      };
    default:
      return {
        role: message.role,
        content: '',
        attachments: [],
      };
  }
}

function renderUserMessage(
  message: Extract<LanguageModelV3Message, { role: 'user' }>,
  context: {
    allowAttachments: boolean;
    warn: (warning: SharedV3Warning) => void;
  },
): { role: string; content: string; attachments: NonNullable<MessageOptions['attachments']> } {
  const attachments: NonNullable<MessageOptions['attachments']> = [];
  const parts: string[] = [];

  for (const [index, part] of message.content.entries()) {
    if (part.type === 'text') {
      parts.push(part.text);
      continue;
    }

    if (part.type === 'file') {
      if (context.allowAttachments) {
        const attachment = toCopilotAttachment(part, index);

        if (attachment != null) {
          attachments.push(attachment);
          continue;
        }
      } else {
        context.warn({
          type: 'compatibility',
          feature: 'attachments',
          details:
            'Only attachments from the latest user message are forwarded as Copilot attachments.',
        });
      }

      parts.push(describeFilePart(part));
    }
  }

  if (attachments.length > 0 && parts.length === 0) {
    parts.push('Please inspect the attached file(s) and respond to the user.');
  }

  return {
    role: 'user',
    content: joinNonEmpty(parts) ?? '',
    attachments,
  };
}

function renderAssistantMessage(
  message: Extract<LanguageModelV3Message, { role: 'assistant' }>,
  warn: (warning: SharedV3Warning) => void,
): string {
  const parts: string[] = [];

  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        parts.push(part.text);
        break;
      case 'reasoning':
        warn({
          type: 'compatibility',
          feature: 'reasoning',
          details:
            'Reasoning history is flattened into transcript text for Copilot sessions.',
        });
        parts.push(`<reasoning>\n${part.text}\n</reasoning>`);
        break;
      case 'tool-call':
        warn({
          type: 'compatibility',
          feature: 'tool-call-history',
          details:
            'Assistant tool calls are serialized into text because Copilot sessions do not accept structured tool history.',
        });
        parts.push(
          [
            `<tool-call name="${part.toolName}" id="${part.toolCallId}">`,
            stringifyStructuredValue(part.input),
            '</tool-call>',
          ].join('\n'),
        );
        break;
      case 'tool-result':
        warn({
          type: 'compatibility',
          feature: 'assistant-tool-results',
          details:
            'Assistant tool results are serialized into text for Copilot prompt replay.',
        });
        parts.push(
          [
            `<tool-result name="${part.toolName}" id="${part.toolCallId}">`,
            stringifyToolOutput(part.output),
            '</tool-result>',
          ].join('\n'),
        );
        break;
      case 'file':
        warn({
          type: 'compatibility',
          feature: 'assistant-files',
          details:
            'Assistant file outputs are serialized into text for Copilot prompt replay.',
        });
        parts.push(describeFilePart(part));
        break;
    }
  }

  return joinNonEmpty(parts) ?? '[no textual content]';
}

function renderToolMessage(
  message: Extract<LanguageModelV3Message, { role: 'tool' }>,
  warn: (warning: SharedV3Warning) => void,
): string {
  warn({
    type: 'compatibility',
    feature: 'tool-results',
    details:
      'Tool result history is serialized into text because Copilot sessions do not accept structured tool messages.',
  });

  const parts = message.content.map(part =>
    part.type === 'tool-approval-response'
      ? `<tool-approval-response id="${part.approvalId}" approved="${String(part.approved)}"${part.reason != null ? ` reason="${part.reason}"` : ''} />`
      : [
          `<tool-result name="${part.toolName}" id="${part.toolCallId}">`,
          stringifyToolOutput(part.output),
          '</tool-result>',
        ].join('\n'),
  );

  return joinNonEmpty(parts) ?? '[no textual content]';
}

function toCopilotAttachment(
  part: LanguageModelV3FilePart,
  index: number,
): CopilotAttachment | undefined {
  if (part.data instanceof URL) {
    if (part.data.protocol === 'file:') {
      return {
        type: 'file',
        path: fileURLToPath(part.data),
        displayName: part.filename ?? createAttachmentName(part, index),
      };
    }

    return undefined;
  }

  return {
    type: 'blob',
    data:
      part.data instanceof Uint8Array
        ? Buffer.from(part.data).toString('base64')
        : part.data,
    mimeType: part.mediaType,
    displayName: part.filename ?? createAttachmentName(part, index),
  };
}

function stringifyToolOutput(output: { type: string; value?: unknown; reason?: string }) {
  switch (output.type) {
    case 'text':
    case 'json':
    case 'error-text':
    case 'error-json':
      return stringifyStructuredValue(output.value);
    case 'execution-denied':
      return output.reason ?? 'Execution denied by the user.';
    default:
      return stringifyStructuredValue(output);
  }
}

function createAttachmentName(
  part: LanguageModelV3FilePart,
  index: number,
): string {
  const extension = mediaTypeToExtension(part.mediaType);
  return extension == null
    ? `attachment-${index + 1}`
    : `attachment-${index + 1}.${extension}`;
}

function describeFilePart(part: Pick<LanguageModelV3FilePart, 'filename' | 'mediaType'>) {
  const details = removeUndefinedEntries({
    filename: part.filename,
    mediaType: part.mediaType,
  });

  return `[file omitted during prompt replay: ${JSON.stringify(details)}]`;
}

function stringifyStructuredValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function joinNonEmpty(values: Array<string | undefined | null>): string | undefined {
  const filtered = values
    .map(value => value?.trim())
    .filter((value): value is string => value != null && value.length > 0);

  return filtered.length > 0 ? filtered.join('\n\n') : undefined;
}

function findLastIndex<T>(
  values: T[],
  predicate: (value: T) => boolean,
): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) {
      return index;
    }
  }

  return -1;
}
