import type { ProviderV3 } from '@ai-sdk/provider';
import type {
  CopilotClient,
  CopilotClientOptions,
  GetAuthStatusResponse,
  ModelInfo,
} from '@github/copilot-sdk';
import type { IdGenerator } from '@ai-sdk/provider-utils';

import type { CopilotLanguageModel } from './copilot-language-model';

export type CopilotReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface CopilotSessionProviderConfig {
  type?: 'openai' | 'azure' | 'anthropic';
  wireApi?: 'completions' | 'responses';
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
  azure?: {
    apiVersion?: string;
  };
}

export interface CopilotLanguageModelSettings {
  clientName?: string;
  provider?: CopilotSessionProviderConfig;
  reasoningEffort?: CopilotReasoningEffort;
  systemMessage?: string;
  workingDirectory?: string;
}

export interface CopilotProviderSettings
  extends Omit<CopilotClientOptions, 'autoStart'>,
    CopilotLanguageModelSettings {
  generateId?: IdGenerator;
}

export interface CopilotProvider extends ProviderV3 {
  (modelId: string, settings?: CopilotLanguageModelSettings): CopilotLanguageModel;
  chat(
    modelId: string,
    settings?: CopilotLanguageModelSettings,
  ): CopilotLanguageModel;
  languageModel(
    modelId: string,
    settings?: CopilotLanguageModelSettings,
  ): CopilotLanguageModel;
  createClient(overrides?: Partial<CopilotClientOptions>): CopilotClient;
  listModels(): Promise<ModelInfo[]>;
  getAuthStatus(): Promise<GetAuthStatusResponse>;
}
