import { b as baml } from "../BamlClient/baml_client/index.js";
import type {
  ActionPlanInput,
  PiControllerAction as BamlPiControllerAction,
  PiToolArgumentsDraft as BamlPiToolArgumentsDraft,
  ToolRiskAudit as BamlToolRiskAudit,
  PiCompactionSummary as BamlPiCompactionSummary,
} from "../BamlClient/baml_client/types.js";
import type { AgentActionPlannerStructuredCaller } from "./AgentActionPlannerStructuredCaller.js";
import type {
  AgentPiControllerActionInput,
  AgentPiToolCard,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../PiProxy/AgentPiAssistantMessageTypes.js";
import type { AgentBamlToolRiskAuditPromptInput } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";
import type { AgentPiCompactionPromptInput } from "../Pi/AgentPiCompactionPrompt.js";
import { parseInteractionPreparation, type ParsedInteractionPreparation } from "./AgentActionPlannerSchema.js";

export class AgentActionPlannerCoreModelCalls {
  constructor(private readonly caller: AgentActionPlannerStructuredCaller) {}

  async prepareInteraction(
    input: ActionPlanInput,
    options: { candidateTools?: readonly AgentPiToolCard[]; signal?: AbortSignal } = {},
  ): Promise<ParsedInteractionPreparation> {
    return this.caller.run({
      functionName: "PrepareInteraction",
      args: {
        functionName: "PrepareInteraction",
        input,
        candidateTools: options.candidateTools?.map((tool) => structuredClone(tool)) ?? [],
      },
      signal: options.signal,
      parse: (rawOutput) =>
        parseInteractionPreparation(
          baml.parse.PrepareInteraction(rawOutput),
          input,
          options.candidateTools?.map((tool) => tool.name) ?? [],
        ),
      repair: (failure) => ({
        functionName: "RepairInteractionPreparation",
        input,
        candidateTools: options.candidateTools?.map((tool) => structuredClone(tool)) ?? [],
        invalidPreparation: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async selectPiAction(
    input: AgentPiControllerActionInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlPiControllerAction> {
    return this.caller.run({
      functionName: "SelectPiAction",
      args: {
        functionName: "SelectPiAction",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.SelectPiAction(rawOutput),
      repair: (failure) => ({
        functionName: "RepairPiAction",
        input,
        invalidAction: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairPiAction(
    options: {
      input: AgentPiControllerActionInput;
      invalidAction: string;
      issues: string[];
    },
    requestOptions: { signal?: AbortSignal } = {},
  ): Promise<BamlPiControllerAction> {
    return this.caller.repair({
      functionName: "RepairPiAction",
      args: {
        functionName: "RepairPiAction",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairPiAction(rawOutput),
    });
  }

  async fillPiToolArguments(
    input: AgentPiToolArgumentsInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlPiToolArgumentsDraft> {
    return this.caller.run({
      functionName: "FillPiToolArguments",
      args: {
        functionName: "FillPiToolArguments",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.FillPiToolArguments(rawOutput),
      repair: (failure) => ({
        functionName: "RepairPiToolArguments",
        input: {
          ...input,
          invalidArguments: failure.invalidOutput,
          issues: failure.issues,
        },
      }),
    });
  }

  async repairPiToolArguments(
    input: AgentPiToolArgumentsRepairInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlPiToolArgumentsDraft> {
    return this.caller.repair({
      functionName: "RepairPiToolArguments",
      args: {
        functionName: "RepairPiToolArguments",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.RepairPiToolArguments(rawOutput),
    });
  }

  async auditToolRisk(
    input: AgentBamlToolRiskAuditPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlToolRiskAudit> {
    return this.caller.run({
      functionName: "AuditToolRisk",
      args: {
        functionName: "AuditToolRisk",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.AuditToolRisk(rawOutput),
      repair: (failure) => ({
        functionName: "RepairToolRiskAudit",
        input,
        invalidAudit: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairToolRiskAudit(
    options: {
      input: AgentBamlToolRiskAuditPromptInput;
      invalidAudit: string;
      issues: string[];
    },
    requestOptions: { signal?: AbortSignal } = {},
  ): Promise<BamlToolRiskAudit> {
    return this.caller.repair({
      functionName: "RepairToolRiskAudit",
      args: {
        functionName: "RepairToolRiskAudit",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairToolRiskAudit(rawOutput),
    });
  }

  async compactPiSession(
    input: AgentPiCompactionPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlPiCompactionSummary> {
    return this.caller.run({
      functionName: "CompactPiSession",
      args: {
        functionName: "CompactPiSession",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.CompactPiSession(rawOutput),
      repair: (failure) => ({
        functionName: "RepairPiCompaction",
        input,
        invalidSummary: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairPiCompaction(
    options: {
      input: AgentPiCompactionPromptInput;
      invalidSummary: string;
      issues: string[];
    },
    requestOptions: { signal?: AbortSignal } = {},
  ): Promise<BamlPiCompactionSummary> {
    return this.caller.repair({
      functionName: "RepairPiCompaction",
      args: {
        functionName: "RepairPiCompaction",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairPiCompaction(rawOutput),
    });
  }
}
