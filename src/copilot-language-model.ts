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
} from "@ai-sdk/provider";
import { isAbortError, removeUndefinedEntries } from "@ai-sdk/provider-utils";
import {
	type AssistantMessageEvent,
	approveAll,
	type CopilotClient,
	type CopilotSession,
	type SessionConfig,
	type SessionEvent,
} from "@github/copilot-sdk";

import type {
	CopilotLanguageModelSettings,
	CopilotProviderSettings,
} from "./copilot-types";
import { prepareCopilotPrompt } from "./prompt-conversion";

type CopilotLanguageModelConfig = {
	createClient: (overrides?: Partial<CopilotProviderSettings>) => CopilotClient;
	defaultSettings: CopilotLanguageModelSettings;
	generateId: () => string;
	provider: string;
};

export class CopilotLanguageModel implements LanguageModelV3 {
	readonly specificationVersion = "v3" as const;
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
		let lastUsageEvent:
			| Extract<SessionEvent, { type: "assistant.usage" }>
			| undefined;
		let lastErrorEvent:
			| Extract<SessionEvent, { type: "session.error" }>
			| undefined;

		const client = this.config.createClient();
		let session: CopilotSession | undefined;
		let removeAbortHandler = () => {};

		try {
			throwIfAborted(options.abortSignal);

			await client.start();
			session = await client.createSession(
				this.createSessionConfig(
					preparedPrompt.systemMessage,
					false,
					(event) => {
						if (
							event.type === "assistant.message" &&
							event.data.parentToolCallId == null
						) {
							lastMessage = event;
						}

						if (
							event.type === "assistant.usage" &&
							event.data.parentToolCallId == null &&
							event.data.initiator == null
						) {
							lastUsageEvent = event;
						}

						if (event.type === "session.error") {
							lastErrorEvent = event;
						}
					},
				),
			);

			removeAbortHandler = bindAbortSignal(options.abortSignal, session);

			lastMessage = await session.sendAndWait(
				{
					attachments: preparedPrompt.attachments,
					mode: "immediate",
					prompt: preparedPrompt.prompt,
				},
				undefined,
			);

			if (lastMessage == null) {
				throw createCopilotError({
					errorEvent: lastErrorEvent,
					message: "Copilot completed without returning an assistant message.",
					requestBody,
				});
			}

			return {
				content: toGeneratedContent(lastMessage),
				finishReason: toFinishReason(lastMessage, lastErrorEvent),
				request: { body: requestBody },
				response: {
					...toResponseMetadata(lastMessage, lastUsageEvent),
					body: removeUndefinedEntries({
						error: lastErrorEvent,
						message: lastMessage,
						usage: lastUsageEvent,
					}),
				},
				usage: toUsage(lastUsageEvent, lastMessage),
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
				cause: error,
				errorEvent: lastErrorEvent,
				requestBody,
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
		let lastUsageEvent:
			| Extract<SessionEvent, { type: "assistant.usage" }>
			| undefined;
		let lastErrorEvent:
			| Extract<SessionEvent, { type: "session.error" }>
			| undefined;
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
			cancel: async () => {
				try {
					await session?.abort();
				} finally {
					await cleanup();
				}
			},
			start: async (controller) => {
				const finalize = async () => {
					if (finalized) {
						return;
					}

					finalized = true;

					if (textPartId != null) {
						controller.enqueue({
							id: textPartId,
							type: "text-end",
						});
					}

					if (
						lastMessage?.data.reasoningText != null &&
						lastMessage.data.reasoningText.length > 0
					) {
						reasoningPartId ??= this.config.generateId();
						controller.enqueue({
							id: reasoningPartId,
							type: "reasoning-start",
						});
						controller.enqueue({
							delta: lastMessage.data.reasoningText,
							id: reasoningPartId,
							type: "reasoning-delta",
						});
						controller.enqueue({
							id: reasoningPartId,
							type: "reasoning-end",
						});
					}

					controller.enqueue({
						type: "response-metadata",
						...toResponseMetadata(lastMessage, lastUsageEvent),
					});
					controller.enqueue({
						finishReason: toFinishReason(lastMessage, lastErrorEvent),
						type: "finish",
						usage: toUsage(lastUsageEvent, lastMessage),
					});

					controller.close();
					await cleanup();
				};

				const handleEvent = (event: SessionEvent) => {
					if (options.includeRawChunks) {
						controller.enqueue({
							rawValue: event,
							type: "raw",
						});
					}

					switch (event.type) {
						case "assistant.message_delta": {
							if (event.data.parentToolCallId != null) {
								return;
							}

							textPartId ??= this.config.generateId();

							if (textPartId != null && event.data.deltaContent.length > 0) {
								if (!textStarted) {
									controller.enqueue({
										id: textPartId,
										type: "text-start",
									});
									textStarted = true;
								}

								controller.enqueue({
									delta: event.data.deltaContent,
									id: textPartId,
									type: "text-delta",
								});
							}

							return;
						}
						case "assistant.message": {
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
									id: textPartId,
									type: "text-start",
								});
								textStarted = true;
								controller.enqueue({
									delta: event.data.content,
									id: textPartId,
									type: "text-delta",
								});
							}

							return;
						}
						case "assistant.usage": {
							if (
								event.data.parentToolCallId == null &&
								event.data.initiator == null
							) {
								lastUsageEvent = event;
							}
							return;
						}
						case "session.error": {
							lastErrorEvent = event;
							controller.enqueue({
								error: createCopilotError({
									errorEvent: event,
									requestBody,
								}),
								type: "error",
							});
							return;
						}
						case "session.idle": {
							void finalize();
							return;
						}
					}
				};

				try {
					throwIfAborted(options.abortSignal);

					controller.enqueue({
						type: "stream-start",
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
						attachments: preparedPrompt.attachments,
						mode: "immediate",
						prompt: preparedPrompt.prompt,
					});
				} catch (error) {
					controller.enqueue({
						error: APICallError.isInstance(error)
							? error
							: createCopilotError({
									cause: error,
									errorEvent: lastErrorEvent,
									requestBody,
								}),
						type: "error",
					});
					controller.close();
					await cleanup();
				}
			},
		});

		return {
			request: {
				body: requestBody,
			},
			stream,
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
			attachments: preparedPrompt.attachments,
			clientName:
				this.settings.clientName ?? this.config.defaultSettings.clientName,
			model: this.modelId,
			prompt: preparedPrompt.prompt,
			provider: this.settings.provider ?? this.config.defaultSettings.provider,
			reasoningEffort:
				this.settings.reasoningEffort ??
				this.config.defaultSettings.reasoningEffort,
			streaming,
			systemMessage,
			workingDirectory:
				this.settings.workingDirectory ??
				this.config.defaultSettings.workingDirectory,
		});
	}

	private createSessionConfig(
		promptSystemMessage: string | undefined,
		streaming: boolean,
		onEvent: (event: SessionEvent) => void,
	): SessionConfig {
		const sessionConfig: SessionConfig = {
			availableTools: [],
			infiniteSessions: { enabled: false },
			model: this.modelId,
			onEvent,
			onPermissionRequest: approveAll,
			streaming,
		};

		const clientName =
			this.settings.clientName ?? this.config.defaultSettings.clientName;
		const provider =
			this.settings.provider ?? this.config.defaultSettings.provider;
		const reasoningEffort =
			this.settings.reasoningEffort ??
			this.config.defaultSettings.reasoningEffort;
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

	if (
		message.data.reasoningText != null &&
		message.data.reasoningText.length > 0
	) {
		content.push({
			text: message.data.reasoningText,
			type: "reasoning",
		});
	}

	if (message.data.content != null && message.data.content.length > 0) {
		content.push({
			text: message.data.content,
			type: "text",
		});
	}

	return content;
}

function toUsage(
	usageEvent: Extract<SessionEvent, { type: "assistant.usage" }> | undefined,
	message: AssistantMessageEvent | undefined,
): LanguageModelV3Usage {
	const inputTotal = usageEvent?.data.inputTokens;
	const cacheRead = usageEvent?.data.cacheReadTokens;
	const cacheWrite = usageEvent?.data.cacheWriteTokens;
	const outputTotal =
		usageEvent?.data.outputTokens ?? message?.data.outputTokens;

	return {
		inputTokens: {
			cacheRead,
			cacheWrite,
			noCache:
				inputTotal != null
					? Math.max(inputTotal - (cacheRead ?? 0), 0)
					: undefined,
			total: inputTotal,
		},
		outputTokens: {
			reasoning: undefined,
			text: outputTotal,
			total: outputTotal,
		},
		raw:
			usageEvent == null
				? undefined
				: removeUndefinedEntries({
						apiCallId: usageEvent.data.apiCallId,
						cacheReadTokens: usageEvent.data.cacheReadTokens,
						cacheWriteTokens: usageEvent.data.cacheWriteTokens,
						copilotUsage: usageEvent.data.copilotUsage,
						cost: usageEvent.data.cost,
						duration: usageEvent.data.duration,
						inputTokens: usageEvent.data.inputTokens,
						model: usageEvent.data.model,
						outputTokens: usageEvent.data.outputTokens,
						providerCallId: usageEvent.data.providerCallId,
						quotaSnapshots: usageEvent.data.quotaSnapshots,
						reasoningEffort: usageEvent.data.reasoningEffort,
					}),
	};
}

function toFinishReason(
	message: AssistantMessageEvent | undefined,
	errorEvent: Extract<SessionEvent, { type: "session.error" }> | undefined,
): LanguageModelV3FinishReason {
	if (message?.data.toolRequests?.length) {
		return {
			raw: "tool-calls",
			unified: "tool-calls",
		};
	}

	if (errorEvent != null && message == null) {
		return {
			raw: errorEvent.data.errorType,
			unified: "error",
		};
	}

	return {
		raw: "stop",
		unified: "stop",
	};
}

function toResponseMetadata(
	message: AssistantMessageEvent | undefined,
	usageEvent: Extract<SessionEvent, { type: "assistant.usage" }> | undefined,
): LanguageModelV3ResponseMetadata {
	return removeUndefinedEntries({
		id:
			usageEvent?.data.apiCallId ??
			message?.data.interactionId ??
			message?.data.messageId,
		modelId: usageEvent?.data.model,
		timestamp: message != null ? new Date(message.timestamp) : undefined,
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

	signal.addEventListener("abort", onAbort);

	return () => {
		signal.removeEventListener("abort", onAbort);
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
	errorEvent?: Extract<SessionEvent, { type: "session.error" }>;
	message?: string;
	cause?: unknown;
}) {
	return new APICallError({
		cause,
		data:
			errorEvent == null
				? undefined
				: removeUndefinedEntries({
						errorType: errorEvent.data.errorType,
						providerCallId: errorEvent.data.providerCallId,
						url: errorEvent.data.url,
					}),
		isRetryable:
			errorEvent?.data.statusCode != null
				? errorEvent.data.statusCode === 429 ||
					errorEvent.data.statusCode >= 500
				: false,
		message: message ?? errorEvent?.data.message ?? "Copilot request failed.",
		requestBodyValues: requestBody,
		responseBody: errorEvent?.data.message,
		statusCode: errorEvent?.data.statusCode,
		url: "copilot://session",
	});
}

function throwIfAborted(signal: AbortSignal | undefined) {
	if (signal?.aborted) {
		throw new DOMException("The operation was aborted.", "AbortError");
	}
}

function joinNonEmpty(values: Array<string | undefined>): string | undefined {
	const parts = values
		.map((value) => value?.trim())
		.filter((value): value is string => value != null && value.length > 0);

	return parts.length > 0 ? parts.join("\n\n") : undefined;
}
