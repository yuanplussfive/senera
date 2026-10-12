import { ClientRegistry } from "@boundaryml/baml";
import { b as baml } from "../BamlClient/baml_client/index.js";
import type { AgentBamlModelRequest } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import type {
  AgentLanguageModelCacheOptions,
  AgentLanguageModelImageAttachment,
  AgentLanguageModelMessage,
} from "../ModelEndpoints/AgentLanguageModel.js";
import type {
  AgentPiControllerDecisionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../PiShared/AgentPiPlanningTypes.js";
import type { AgentBamlToolRiskAuditPromptInput } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";
import { buildBamlToolRiskAuditPromptWire } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";
import { projectActionPlannerBamlRequestBody } from "./AgentActionPlannerPromptProjector.js";
import { renderAgentPromptInputWire } from "../Prompt/AgentPromptContextWireRenderer.js";

export type AgentActionPlannerBamlFunctionArgs =
  | {
      functionName: "EvolveTurn";
      input: AgentPiControllerDecisionInput;
    }
  | {
      functionName: "RepairControllerDecision";
      input: AgentPiControllerDecisionInput;
      invalidDecision: string;
      issues: string[];
    }
  | {
      functionName: "FillPiToolArguments";
      input: AgentPiToolArgumentsInput;
    }
  | {
      functionName: "RepairPiToolArguments";
      input: AgentPiToolArgumentsRepairInput;
    }
  | {
      functionName: "AuditToolRisk";
      input: AgentBamlToolRiskAuditPromptInput;
    }
  | {
      functionName: "RepairToolRiskAudit";
      input: AgentBamlToolRiskAuditPromptInput;
      invalidAudit: string;
      issues: string[];
    }

export class AgentActionPlannerBamlPromptFactory {
  private readonly promptRegistry = createAgentBamlPromptBuilderRegistry();

  async buildPrompt(
    args: AgentActionPlannerBamlFunctionArgs,
    options: {
      attachments?: readonly AgentLanguageModelImageAttachment[];
      cache?: AgentLanguageModelCacheOptions;
    } = {},
  ): Promise<AgentBamlModelRequest> {
    const request = await this.buildBamlRequest(args);
    const prompt = projectPromptForBamlFunction(args.functionName, request.body.json() as Record<string, unknown>);
    return {
      requestId: `action-planner:${args.functionName}`,
      step: 0,
      systemPrompt: prompt.systemPrompt,
      messages: attachPlannerImages(prompt.messages, options.attachments),
      cache: options.cache,
    };
  }

  private buildBamlRequest(args: AgentActionPlannerBamlFunctionArgs) {
    const options = {
      clientRegistry: this.promptRegistry,
    };

    switch (args.functionName) {
      case "EvolveTurn":
        return baml.request.EvolveTurn(
          buildPiPromptWire(args.input, {
            stage: "evolveTurn",
          }),
          options,
        );
      case "RepairControllerDecision":
        return baml.request.RepairControllerDecision(
          buildPiPromptWire(args.input, {
            stage: "repairControllerDecision",
            invalidDecision: args.invalidDecision,
            issues: args.issues,
          }),
          options,
        );
      case "FillPiToolArguments":
        return baml.request.FillPiToolArguments(
          buildPiPromptWire(args.input, {
            stage: "fillPiToolArguments",
          }),
          options,
        );
      case "RepairPiToolArguments":
        return baml.request.RepairPiToolArguments(
          buildPiPromptWire(args.input, {
            stage: "repairPiToolArguments",
            invalidArguments: args.input.invalidArguments,
            issues: args.input.issues,
          }),
          options,
        );
      case "AuditToolRisk":
        return baml.request.AuditToolRisk(buildBamlToolRiskAuditPromptWire(args.input), options);
      case "RepairToolRiskAudit":
        return baml.request.RepairToolRiskAudit(
          buildBamlToolRiskAuditPromptWire(args.input, {
            stage: "repairToolRiskAudit",
            invalidAudit: args.invalidAudit,
            issues: args.issues,
          }),
          options,
        );
    }
  }
}

function attachPlannerImages(
  messages: readonly AgentLanguageModelMessage[],
  attachments: readonly AgentLanguageModelImageAttachment[] | undefined,
): AgentLanguageModelMessage[] {
  if (!attachments?.length) return [...messages];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    return messages.map((candidate, candidateIndex) =>
      candidateIndex === index
        ? {
            ...candidate,
            attachments: [...(candidate.attachments ?? []), ...attachments],
          }
        : candidate,
    );
  }

  return [...messages];
}

function projectPromptForBamlFunction(
  functionName: AgentActionPlannerBamlFunctionArgs["functionName"],
  body: Record<string, unknown>,
) {
  void functionName;
  return projectActionPlannerBamlRequestBody(body);
}

function buildPiPromptWire(input: object, directive: Record<string, unknown>): string {
  return renderAgentPromptInputWire(
    {
      kind: "planner_input",
      context: { ...input },
      directive,
    },
    { estimateTokens: (text) => text.length },
  ).text;
}

export function createAgentBamlPromptBuilderRegistry(): ClientRegistry {
  const registry = new ClientRegistry();
  registry.addLlmClient("SeneraActionPlannerPromptBuilder", "openai-generic", {
    base_url: "https://example.invalid/v1",
    model: "prompt-builder",
    temperature: 0,
  });
  registry.setPrimary("SeneraActionPlannerPromptBuilder");
  return registry;
}
