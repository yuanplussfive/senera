import { ClientRegistry } from "@boundaryml/baml";
import { b as baml } from "./BamlClient/baml_client/index.js";
import type {
  ActionDecision as BamlActionDecision,
  ActionPlanInput,
} from "./BamlClient/baml_client/types.js";
import { createModelProviderMetadata } from "./AgentModelMetadata.js";
import { createModelEndpoint } from "./ModelEndpoints/ModelEndpointTypes.js";
import type { TextGenerationEndpoint } from "./ModelEndpoints/ModelEndpointTypes.js";
import { ModelHttpClient } from "./ModelEndpoints/ModelHttpClient.js";
import type {
  AgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
} from "./Types.js";
import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";

interface PlannerModelRequest {
  requestId: string;
  step: number;
  systemPrompt: string;
  messages: AgentLanguageModelMessage[];
}

export class AgentActionPlannerModelClient {
  readonly providerConfig: ResolvedAgentModelProviderConfig;
  private readonly provider: ResolvedAgentModelProviderConfig;
  private readonly endpoint: TextGenerationEndpoint;
  private readonly promptRegistry = createPromptRegistry();

  constructor(
    model: ResolvedAgentModelProviderConfig,
    overrides: AgentActionPlannerClientConfig,
  ) {
    this.provider = resolvePlannerProvider(model, overrides);
    this.providerConfig = this.provider;
    this.endpoint = createModelEndpoint(this.provider.Endpoint, {
      config: this.provider,
      http: new ModelHttpClient(
        this.provider,
        createModelProviderMetadata(this.provider),
      ),
    });
  }

  async plan(input: ActionPlanInput): Promise<BamlActionDecision> {
    const prompt = await this.buildPrompt("PlanAction", { input });
    return baml.parse.PlanAction(await this.complete(prompt));
  }

  async repair(options: {
    input: ActionPlanInput;
    invalidDecision: string;
    issues: string[];
  }): Promise<BamlActionDecision> {
    const prompt = await this.buildPrompt("RepairActionDecision", options);
    return baml.parse.RepairActionDecision(await this.complete(prompt));
  }

  private async complete(request: PlannerModelRequest): Promise<string> {
    const stream = await this.endpoint.stream(request);
    let text = "";
    for await (const chunk of stream) {
      text = chunk.accumulatedText;
    }
    return text;
  }

  private async buildPrompt(
    functionName: "PlanAction" | "RepairActionDecision",
    args: {
      input: ActionPlanInput;
      invalidDecision?: string;
      issues?: string[];
    },
  ): Promise<PlannerModelRequest> {
    const request = functionName === "PlanAction"
      ? await baml.request.PlanAction(args.input, {
          clientRegistry: this.promptRegistry,
        })
      : await baml.request.RepairActionDecision(
          args.input,
          args.invalidDecision ?? "",
          args.issues ?? [],
          {
            clientRegistry: this.promptRegistry,
          },
        );
    const prompt = projectBamlPrompt(request.body.json() as Record<string, unknown>);
    return {
      requestId: `action-planner:${functionName}`,
      step: 0,
      systemPrompt: prompt.systemPrompt,
      messages: prompt.messages,
    };
  }
}

function createPromptRegistry(): ClientRegistry {
  const registry = new ClientRegistry();
  registry.addLlmClient("SeneraActionPlannerPromptBuilder", "openai-generic", {
    base_url: "https://example.invalid/v1",
    api_key: "prompt-builder",
    model: "prompt-builder",
    temperature: 0,
  });
  registry.setPrimary("SeneraActionPlannerPromptBuilder");
  return registry;
}

function resolvePlannerProvider(
  model: ResolvedAgentModelProviderConfig,
  overrides: AgentActionPlannerClientConfig,
): ResolvedAgentModelProviderConfig {
  return {
    ...model,
    Endpoint: resolvePlannerEndpoint(model.Endpoint, overrides.Provider),
    BaseUrl: overrides.BaseUrl ?? model.BaseUrl,
    ApiKey: overrides.ApiKey ?? model.ApiKey,
    Model: overrides.Model ?? model.Model,
    Temperature: overrides.Temperature ?? 0.1,
    MaxOutputTokens: overrides.MaxTokens ?? -1,
    Stream: false,
  };
}

function resolvePlannerEndpoint(
  endpoint: ResolvedAgentModelProviderConfig["Endpoint"],
  provider: AgentActionPlannerClientConfig["Provider"],
): ResolvedAgentModelProviderConfig["Endpoint"] {
  return provider && provider !== "auto"
    ? ProviderEndpointMap[provider]
    : endpoint;
}

const ProviderEndpointMap = {
  "openai-generic": "ChatCompletions",
  "openai-responses": "Responses",
  anthropic: "ClaudeMessages",
  "google-ai": "GoogleGenerateContent",
} as const satisfies Record<
  Exclude<NonNullable<AgentActionPlannerClientConfig["Provider"]>, "auto">,
  ResolvedAgentModelProviderConfig["Endpoint"]
>;

function projectBamlPrompt(body: Record<string, unknown>): {
  systemPrompt: string;
  messages: AgentLanguageModelMessage[];
} {
  const messages = readBamlMessages(body);
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const conversation = messages.flatMap((message) => {
    if (message.role === "system") {
      return [];
    }
    return {
      role: message.role,
      content: message.content,
    };
  });

  if (conversation.length === 0) {
    throw new Error("BAML action planner prompt did not contain a user message.");
  }

  return {
    systemPrompt,
    messages: conversation,
  };
}

function readBamlMessages(body: Record<string, unknown>): Array<{
  role: "system" | "user" | "assistant";
  content: string;
}> {
  const messages = body.messages;
  if (Array.isArray(messages)) {
    return messages.map(readBamlMessage).filter((message) => message.content.length > 0);
  }

  const input = body.input;
  if (Array.isArray(input)) {
    return input.map(readBamlMessage).filter((message) => message.content.length > 0);
  }

  throw new Error("BAML action planner request did not contain a text prompt.");
}

function readBamlMessage(value: unknown): {
  role: "system" | "user" | "assistant";
  content: string;
} {
  if (!value || typeof value !== "object") {
    return {
      role: "user",
      content: "",
    };
  }

  const message = value as Record<string, unknown>;
  return {
    role: readRole(message.role),
    content: readTextContent(message.content),
  };
}

function readRole(value: unknown): "system" | "user" | "assistant" {
  return value === "system" || value === "assistant" ? value : "user";
}

function readTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(readTextPart).join("");
  }

  return "";
}

function readTextPart(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const part = value as Record<string, unknown>;
  return typeof part.text === "string" ? part.text : "";
}
