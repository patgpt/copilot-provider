import {
	type EmbeddingModelV3,
	type ImageModelV3,
	NoSuchModelError,
} from "@ai-sdk/provider";
import { generateId, type IdGenerator } from "@ai-sdk/provider-utils";
import { CopilotClient, type CopilotClientOptions } from "@github/copilot-sdk";

import { CopilotLanguageModel } from "./copilot-language-model";
import type {
	CopilotLanguageModelSettings,
	CopilotProvider,
	CopilotProviderSettings,
} from "./copilot-types";

export function createCopilot(
	options: CopilotProviderSettings = {},
): CopilotProvider {
	const {
		clientName,
		provider,
		reasoningEffort,
		systemMessage,
		workingDirectory,
		generateId: generateIdOverride = generateId,
		...clientOptions
	} = options;

	const modelDefaults: CopilotLanguageModelSettings = {
		clientName,
		provider,
		reasoningEffort,
		systemMessage,
		workingDirectory,
	};

	const createClient = (overrides: Partial<CopilotClientOptions> = {}) =>
		new CopilotClient({
			...clientOptions,
			...overrides,
		});

	const createLanguageModel = (
		modelId: string,
		settings: CopilotLanguageModelSettings = {},
	) =>
		new CopilotLanguageModel(modelId, settings, {
			createClient,
			defaultSettings: modelDefaults,
			generateId: generateIdOverride as IdGenerator,
			provider: "copilot",
		});

	const providerFactory = Object.assign(
		function (modelId: string, settings?: CopilotLanguageModelSettings) {
			if (new.target != null) {
				throw new Error(
					"The Copilot model factory cannot be called with the new keyword.",
				);
			}

			return createLanguageModel(modelId, settings);
		},
		{
			chat: createLanguageModel,
			createClient,
			embeddingModel: createUnsupportedEmbeddingModelFactory(),
			getAuthStatus: async () => {
				const client = createClient();

				try {
					await client.start();
					return await client.getAuthStatus();
				} finally {
					await client.stop().catch(() => []);
				}
			},
			imageModel: createUnsupportedImageModelFactory(),
			languageModel: createLanguageModel,
			listModels: async () => {
				const client = createClient();

				try {
					await client.start();
					return await client.listModels();
				} finally {
					await client.stop().catch(() => []);
				}
			},
			specificationVersion: "v3" as const,
		},
	) as CopilotProvider;

	return providerFactory;
}

export const copilot = createCopilot();

function createUnsupportedEmbeddingModelFactory() {
	return (modelId: string): EmbeddingModelV3 => {
		throw new NoSuchModelError({ modelId, modelType: "embeddingModel" });
	};
}

function createUnsupportedImageModelFactory() {
	return (modelId: string): ImageModelV3 => {
		throw new NoSuchModelError({ modelId, modelType: "imageModel" });
	};
}
