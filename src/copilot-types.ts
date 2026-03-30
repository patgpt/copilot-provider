import type { ProviderV3 } from "@ai-sdk/provider";
import type { IdGenerator } from "@ai-sdk/provider-utils";
import type {
	CopilotClient,
	CopilotClientOptions,
	GetAuthStatusResponse,
	ModelInfo,
} from "@github/copilot-sdk";

import type { CopilotLanguageModel } from "./copilot-language-model";

export type CopilotReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface CopilotSessionProviderConfig {
	apiKey?: string;
	azure?: {
		apiVersion?: string;
	};
	baseUrl: string;
	bearerToken?: string;
	type?: "openai" | "azure" | "anthropic";
	wireApi?: "completions" | "responses";
}

export interface CopilotLanguageModelSettings {
	clientName?: string;
	provider?: CopilotSessionProviderConfig;
	reasoningEffort?: CopilotReasoningEffort;
	systemMessage?: string;
	workingDirectory?: string;
}

export interface CopilotProviderSettings
	extends Omit<CopilotClientOptions, "autoStart">,
		CopilotLanguageModelSettings {
	generateId?: IdGenerator;
}

export interface CopilotProvider extends ProviderV3 {
	chat(
		modelId: string,
		settings?: CopilotLanguageModelSettings,
	): CopilotLanguageModel;
	createClient(overrides?: Partial<CopilotClientOptions>): CopilotClient;
	getAuthStatus(): Promise<GetAuthStatusResponse>;
	languageModel(
		modelId: string,
		settings?: CopilotLanguageModelSettings,
	): CopilotLanguageModel;
	listModels(): Promise<ModelInfo[]>;
	(
		modelId: string,
		settings?: CopilotLanguageModelSettings,
	): CopilotLanguageModel;
}
