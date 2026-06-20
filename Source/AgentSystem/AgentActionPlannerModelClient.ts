import { ClientRegistry } from "@boundaryml/baml";
import { b as baml } from "./BamlClient/baml_client/index.js";
import type {
  ActionPlanInput,
  EvidenceVerification as BamlEvidenceVerification,
  TaskFrame as BamlTaskFrame,
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
import {
  buildActionPlannerPromptJson,
  buildEvidenceVerificationPromptJson,
} from "./AgentActionPlannerPromptJson.js";
import { throwIfAborted } from "./AgentCancellation.js";

interface PlannerModelRequest {
  requestId: string;
  step: number;
  systemPrompt: string;
  messages: AgentLanguageModelMessage[];
  signal?: AbortSignal;
}

type PlannerBamlFunctionArgs =
  | {
      functionName: "BuildTaskFrame";
      input: ActionPlanInput;
    }
  | {
      functionName: "RepairTaskFrame";
      input: ActionPlanInput;
      invalidTaskFrame: string;
      issues: string[];
    }
  | {
      functionName: "VerifyTaskEvidence";
      input: ActionPlanInput;
      taskFrame: BamlTaskFrame;
    };

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

  async buildTaskFrame(
    input: ActionPlanInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlTaskFrame> {
    const prompt = await this.buildPrompt({
      functionName: "BuildTaskFrame",
      input,
    });
    return baml.parse.BuildTaskFrame(await this.complete(prompt, options.signal));
  }

  async verifyTaskEvidence(options: {
    input: ActionPlanInput;
    taskFrame: BamlTaskFrame;
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlEvidenceVerification> {
    const prompt = await this.buildPrompt({
      functionName: "VerifyTaskEvidence",
      ...options,
    });
    return baml.parse.VerifyTaskEvidence(await this.complete(prompt, requestOptions.signal));
  }

  async repairTaskFrame(options: {
    input: ActionPlanInput;
    invalidTaskFrame: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlTaskFrame> {
    const prompt = await this.buildPrompt({
      functionName: "RepairTaskFrame",
      ...options,
    });
    return baml.parse.RepairTaskFrame(await this.complete(prompt, requestOptions.signal));
  }

  private async complete(request: PlannerModelRequest, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const stream = await this.endpoint.stream({
      ...request,
      signal,
    });
    let text = "";
    const abort = (): void => stream.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      for await (const chunk of stream) {
        throwIfAborted(signal);
        text = chunk.accumulatedText;
      }
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    throwIfAborted(signal);
    return text;
  }

  private async buildPrompt(args: PlannerBamlFunctionArgs): Promise<PlannerModelRequest> {
    const request = await this.buildBamlRequest(args);
    const prompt = projectBamlPrompt(request.body.json() as Record<string, unknown>);
    return {
      requestId: `action-planner:${args.functionName}`,
      step: 0,
      systemPrompt: prompt.systemPrompt,
      messages: prompt.messages,
    };
  }

  private buildBamlRequest(args: PlannerBamlFunctionArgs) {
    const options = {
      clientRegistry: this.promptRegistry,
    };

    switch (args.functionName) {
      case "BuildTaskFrame":
        return baml.request.BuildTaskFrame(
          buildActionPlannerPromptJson(args.input, {
            stage: "buildTaskFrame",
          }),
          options,
        );
      case "RepairTaskFrame":
        return baml.request.RepairTaskFrame(
          buildActionPlannerPromptJson(args.input, {
            stage: "repairTaskFrame",
            invalidTaskFrame: args.invalidTaskFrame,
            issues: args.issues,
          }),
          options,
        );
      case "VerifyTaskEvidence":
        return baml.request.VerifyTaskEvidence(
          buildEvidenceVerificationPromptJson(args.input, args.taskFrame),
          options,
        );
    }
  }
}

function createPromptRegistry(): ClientRegistry {
  const registry = new ClientRegistry();
  registry.addLlmClient("SeneraActionPlannerPromptBuilder", "openai-generic", {
    base_url: "https://example.invalid/v1",
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
