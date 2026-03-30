import {
  APICallError,
  type LanguageModelV3,
  type LanguageModelV3CallOptions,
  type LanguageModelV3Content,
  type LanguageModelV3FinishReason,
  type LanguageModelV3GenerateResult,
  type LanguageModelV3ResponseMetadata,
  type LanguageModelV3StreamPart,
  type LanguageModelV3StreamResult,
  type LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { isAbortError, removeUndefinedEntries } from '@ai-sdk/provider-utils';
import {
  CopilotClient,
  approveAll,
  type AssistantMessageEvent,
  type CopilotSession,
  type SessionConfig,
  type SessionEvent,
} from '@github/copilot-sdk';

import type {
  CopilotLanguageModelSettings,
  CopilotProviderSettings,
} from './copilot-types';
import { prepareCopilotPrompt } from './prompt-conversion';

type CopilotLanguageModelConfig = {
  createClient: (overrides?: Partial<CopilotProviderSettings>) => CopilotClient;
  defaultSettings: CopilotLanguageModelSettings;
  generateId: () => string;
  provider: string;
};

export class CopilotLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly supportedUrls = {};

  constructor(
    readonly modelId: string,
    private readonly settings: CopilotLanguageModelSettings,
    private readonly config: CopilotLanguageModelConfig,
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const preparedPrompt = prepareCopilotPrompt(options);
    const requestBody = this.createRequestBody(preparedPrompt, false);

    let lastMessage: AssistantMessageEvent | undefined;
    let lastUsageEvent: Extract<SessionEvent, { type: 'assistant.usage' }> | undefined;
    let lastErrorEvent: Extract<SessionEvent, { type: 'session.error' }> | undefined;

    const client = this.config.createClient();
    let session: CopilotSession | undefined;
    let removeAbortHandler = () => {};

    try {
      throwIfAborted(options.abortSignal);

      await client.start();
      session = await client.createSession(
        this.createSessionConfig(preparedPrompt.systemMessage, false, event => {
          if (event.type === 'assistant.message' && event.data.parentToolCallId == null) {
            lastMessage = event;
          }

          if (
            event.type === 'assistant.usage' &&
            event.data.parentToolCallId == null &&
            event.data.initiator == null
          ) {
            lastUsageEvent = event;
          }

          if (event.type === 'session.error') {
            lastErrorEvent = event;
          }
        }),
      );

      removeAbortHandler = bindAbortSignal(options.abortSignal, session);

      lastMessage = await session.sendAndWait(
        {
          prompt: preparedPrompt.prompt,
          attachments: preparedPrompt.attachments,
          mode: 'immediate',
        },
        undefined,
      );

      if (lastMessage == null) {
        throw createCopilotError({
          errorEvent: lastErrorEvent,
          requestBody,
          message: 'Copilot completed without returning an assistant message.',
        });
      }

      return {
        content: toGeneratedContent(lastMessage),
        finishReason: toFinishReason(lastMessage, lastErrorEvent),
        usage: toUsage(lastUsageEvent, lastMessage),
        request: { body: requestBody },
        response: {
          ...toResponseMetadata(lastMessage, lastUsageEvent),
          body: removeUndefinedEntries({
            message: lastMessage,
            usage: lastUsageEvent,
            error: lastErrorEvent,
          }),
        },
        warnings: preparedPrompt.warnings,
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      if (APICallError.isInstance(error)) {
        throw error;
      }

      throw createCopilotError({
        errorEvent: lastErrorEvent,
        requestBody,
        cause: error,
      });
    } finally {
      removeAbortHandler();
      await cleanupSession(client, session);
    }
  }

  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const preparedPrompt = prepareCopilotPrompt(options);
    const requestBody = this.createRequestBody(preparedPrompt, true);

    let client: CopilotClient | undefined;
    let session: CopilotSession | undefined;
    let removeAbortHandler = () => {};
    let cleanedUp = false;
    let finalized = false;

    let lastMessage: AssistantMessageEvent | undefined;
    let lastUsageEvent: Extract<SessionEvent, { type: 'assistant.usage' }> | undefined;
    let lastErrorEvent: Extract<SessionEvent, { type: 'session.error' }> | undefined;
    let textPartId: string | undefined;
    let reasoningPartId: string | undefined;
    let textStarted = false;

    const cleanup = async () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      removeAbortHandler();

      if (client != null) {
        await cleanupSession(client, session);
      }
    };

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: async controller => {
        const finalize = async () => {
          if (finalized) {
            return;
          }

          finalized = true;

          if (textPartId != null) {
            controller.enqueue({
              type: 'text-end',
              id: textPartId,
            });
          }

          if (
            lastMessage?.data.reasoningText != null &&
            lastMessage.data.reasoningText.length > 0
          ) {
            reasoningPartId ??= this.config.generateId();
            controller.enqueue({
              type: 'reasoning-start',
              id: reasoningPartId,
            });
            controller.enqueue({
              type: 'reasoning-delta',
              id: reasoningPartId,
              delta: lastMessage.data.reasoningText,
            });
            controller.enqueue({
              type: 'reasoning-end',
              id: reasoningPartId,
            });
          }

          controller.enqueue({
            type: 'response-metadata',
            ...toResponseMetadata(lastMessage, lastUsageEvent),
          });
          controller.enqueue({
            type: 'finish',
            usage: toUsage(lastUsageEvent, lastMessage),
            finishReason: toFinishReason(lastMessage, lastErrorEvent),
          });

          controller.close();
          await cleanup();
        };

        const handleEvent = (event: SessionEvent) => {
          if (options.includeRawChunks) {
            controller.enqueue({
              type: 'raw',
              rawValue: event,
            });
          }

          switch (event.type) {
            case 'assistant.message_delta': {
              if (event.data.parentToolCallId != null) {
                return;
              }

              textPartId ??= this.config.generateId();

              if (textPartId != null && event.data.deltaContent.length > 0) {
                if (!textStarted) {
                  controller.enqueue({
                    type: 'text-start',
                    id: textPartId,
                  });
                  textStarted = true;
                }

                controller.enqueue({
                  type: 'text-delta',
                  id: textPartId,
                  delta: event.data.deltaContent,
                });
              }

              return;
            }
            case 'assistant.message': {
              if (event.data.parentToolCallId != null) {
                return;
              }

              lastMessage = event;

              if (
                textPartId == null &&
                event.data.content != null &&
                event.data.content.length > 0
              ) {
                textPartId = this.config.generateId();
                controller.enqueue({
                  type: 'text-start',
                  id: textPartId,
                });
                textStarted = true;
                controller.enqueue({
                  type: 'text-delta',
                  id: textPartId,
                  delta: event.data.content,
                });
              }

              return;
            }
            case 'assistant.usage': {
              if (
                event.data.parentToolCallId == null &&
                event.data.initiator == null
              ) {
                lastUsageEvent = event;
              }
              return;
            }
            case 'session.error': {
              lastErrorEvent = event;
              controller.enqueue({
                type: 'error',
                error: createCopilotError({
                  errorEvent: event,
                  requestBody,
                }),
              });
              return;
            }
            case 'session.idle': {
              void finalize();
              return;
            }
          }
        };

        try {
          throwIfAborted(options.abortSignal);

          controller.enqueue({
            type: 'stream-start',
            warnings: preparedPrompt.warnings,
          });

          client = this.config.createClient();
          await client.start();
          session = await client.createSession(
            this.createSessionConfig(
              preparedPrompt.systemMessage,
              true,
              handleEvent,
            ),
          );

          removeAbortHandler = bindAbortSignal(options.abortSignal, session);

          await session.send({
            prompt: preparedPrompt.prompt,
            attachments: preparedPrompt.attachments,
            mode: 'immediate',
          });
        } catch (error) {
          controller.enqueue({
            type: 'error',
            error: APICallError.isInstance(error)
              ? error
              : createCopilotError({
                  errorEvent: lastErrorEvent,
                  requestBody,
                  cause: error,
                }),
          });
          controller.close();
          await cleanup();
        }
      },
      cancel: async () => {
        try {
          await session?.abort();
        } finally {
          await cleanup();
        }
      },
    });

    return {
      stream,
      request: {
        body: requestBody,
      },
    };
  }

  private createRequestBody(
    preparedPrompt: ReturnType<typeof prepareCopilotPrompt>,
    streaming: boolean,
  ) {
    const systemMessage = joinNonEmpty([
      this.config.defaultSettings.systemMessage,
      this.settings.systemMessage,
      preparedPrompt.systemMessage,
    ]);

    return removeUndefinedEntries({
      model: this.modelId,
      prompt: preparedPrompt.prompt,
      attachments: preparedPrompt.attachments,
      systemMessage,
      reasoningEffort:
        this.settings.reasoningEffort ?? this.config.defaultSettings.reasoningEffort,
      provider: this.settings.provider ?? this.config.defaultSettings.provider,
      streaming,
      workingDirectory:
        this.settings.workingDirectory ??
        this.config.defaultSettings.workingDirectory,
      clientName: this.settings.clientName ?? this.config.defaultSettings.clientName,
    });
  }

  private createSessionConfig(
    promptSystemMessage: string | undefined,
    streaming: boolean,
    onEvent: (event: SessionEvent) => void,
  ): SessionConfig {
    const sessionConfig: SessionConfig = {
      model: this.modelId,
      streaming,
      availableTools: [],
      infiniteSessions: { enabled: false },
      onPermissionRequest: approveAll,
      onEvent,
    };

    const clientName =
      this.settings.clientName ?? this.config.defaultSettings.clientName;
    const provider = this.settings.provider ?? this.config.defaultSettings.provider;
    const reasoningEffort =
      this.settings.reasoningEffort ?? this.config.defaultSettings.reasoningEffort;
    const workingDirectory =
      this.settings.workingDirectory ??
      this.config.defaultSettings.workingDirectory;
    const systemMessage = toSystemMessageConfig(
      joinNonEmpty([
        this.config.defaultSettings.systemMessage,
        this.settings.systemMessage,
        promptSystemMessage,
      ]),
    );

    if (clientName != null) {
      sessionConfig.clientName = clientName;
    }

    if (provider != null) {
      sessionConfig.provider = provider;
    }

    if (reasoningEffort != null) {
      sessionConfig.reasoningEffort = reasoningEffort;
    }

    if (workingDirectory != null) {
      sessionConfig.workingDirectory = workingDirectory;
    }

    if (systemMessage != null) {
      sessionConfig.systemMessage = systemMessage;
    }

    return sessionConfig;
  }
}

function toGeneratedContent(
  message: AssistantMessageEvent,
): LanguageModelV3Content[] {
  const content: LanguageModelV3Content[] = [];

  if (message.data.reasoningText != null && message.data.reasoningText.length > 0) {
    content.push({
      type: 'reasoning',
      text: message.data.reasoningText,
    });
  }

  if (message.data.content != null && message.data.content.length > 0) {
    content.push({
      type: 'text',
      text: message.data.content,
    });
  }

  return content;
}

function toUsage(
  usageEvent:
    | Extract<SessionEvent, { type: 'assistant.usage' }>
    | undefined,
  message: AssistantMessageEvent | undefined,
): LanguageModelV3Usage {
  const inputTotal = usageEvent?.data.inputTokens;
  const cacheRead = usageEvent?.data.cacheReadTokens;
  const cacheWrite = usageEvent?.data.cacheWriteTokens;
  const outputTotal = usageEvent?.data.outputTokens ?? message?.data.outputTokens;

  return {
    inputTokens: {
      total: inputTotal,
      noCache:
        inputTotal != null ? Math.max(inputTotal - (cacheRead ?? 0), 0) : undefined,
      cacheRead,
      cacheWrite,
    },
    outputTokens: {
      total: outputTotal,
      text: outputTotal,
      reasoning: undefined,
    },
    raw:
      usageEvent == null
        ? undefined
        : removeUndefinedEntries({
            model: usageEvent.data.model,
            inputTokens: usageEvent.data.inputTokens,
            outputTokens: usageEvent.data.outputTokens,
            cacheReadTokens: usageEvent.data.cacheReadTokens,
            cacheWriteTokens: usageEvent.data.cacheWriteTokens,
            cost: usageEvent.data.cost,
            duration: usageEvent.data.duration,
            apiCallId: usageEvent.data.apiCallId,
            providerCallId: usageEvent.data.providerCallId,
            quotaSnapshots: usageEvent.data.quotaSnapshots,
            copilotUsage: usageEvent.data.copilotUsage,
            reasoningEffort: usageEvent.data.reasoningEffort,
          }),
  };
}

function toFinishReason(
  message: AssistantMessageEvent | undefined,
  errorEvent: Extract<SessionEvent, { type: 'session.error' }> | undefined,
): LanguageModelV3FinishReason {
  if (message?.data.toolRequests?.length) {
    return {
      unified: 'tool-calls',
      raw: 'tool-calls',
    };
  }

  if (errorEvent != null && message == null) {
    return {
      unified: 'error',
      raw: errorEvent.data.errorType,
    };
  }

  return {
    unified: 'stop',
    raw: 'stop',
  };
}

function toResponseMetadata(
  message: AssistantMessageEvent | undefined,
  usageEvent:
    | Extract<SessionEvent, { type: 'assistant.usage' }>
    | undefined,
): LanguageModelV3ResponseMetadata {
  return removeUndefinedEntries({
    id:
      usageEvent?.data.apiCallId ??
      message?.data.interactionId ??
      message?.data.messageId,
    timestamp: message != null ? new Date(message.timestamp) : undefined,
    modelId: usageEvent?.data.model,
  });
}

function toSystemMessageConfig(content: string | undefined) {
  return content == null
    ? undefined
    : {
        content,
      };
}

function bindAbortSignal(
  signal: AbortSignal | undefined,
  session: CopilotSession,
): () => void {
  if (signal == null) {
    return () => {};
  }

  const onAbort = () => {
    void session.abort();
  };

  signal.addEventListener('abort', onAbort);

  return () => {
    signal.removeEventListener('abort', onAbort);
  };
}

async function cleanupSession(
  client: CopilotClient,
  session: CopilotSession | undefined,
): Promise<void> {
  if (session != null) {
    try {
      await session.disconnect();
    } catch {
      // Best effort cleanup only.
    }

    try {
      await client.deleteSession(session.sessionId);
    } catch {
      // Session data cleanup is optional.
    }
  }

  try {
    await client.stop();
  } catch {
    // Best effort cleanup only.
  }
}

function createCopilotError({
  requestBody,
  errorEvent,
  message,
  cause,
}: {
  requestBody: unknown;
  errorEvent?: Extract<SessionEvent, { type: 'session.error' }>;
  message?: string;
  cause?: unknown;
}) {
  return new APICallError({
    message: message ?? errorEvent?.data.message ?? 'Copilot request failed.',
    url: 'copilot://session',
    requestBodyValues: requestBody,
    statusCode: errorEvent?.data.statusCode,
    responseBody: errorEvent?.data.message,
    isRetryable:
      errorEvent?.data.statusCode != null
        ? errorEvent.data.statusCode === 429 ||
          errorEvent.data.statusCode >= 500
        : false,
    data:
      errorEvent == null
        ? undefined
        : removeUndefinedEntries({
            errorType: errorEvent.data.errorType,
            providerCallId: errorEvent.data.providerCallId,
            url: errorEvent.data.url,
          }),
    cause,
  });
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

function joinNonEmpty(values: Array<string | undefined>): string | undefined {
  const parts = values
    .map(value => value?.trim())
    .filter((value): value is string => value != null && value.length > 0);

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
