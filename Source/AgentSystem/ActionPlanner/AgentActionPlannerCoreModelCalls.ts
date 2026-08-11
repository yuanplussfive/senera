import { b as baml } from "../BamlClient/baml_client/index.js";
import type {
  ControllerDecision as BamlControllerDecision,
  PiToolArgumentsDraft as BamlPiToolArgumentsDraft,
  ToolRiskAudit as BamlToolRiskAudit,
  PiConversationSummary as BamlPiConversationSummary,
} from "../BamlClient/baml_client/types.js";
import type { AgentActionPlannerStructuredCaller } from "./AgentActionPlannerStructuredCaller.js";
import type {
  AgentPiControllerDecisionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../PiShared/AgentPiPlanningTypes.js";
import type { AgentBamlToolRiskAuditPromptInput } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";
import type { AgentPiCompactionPromptInput } from "../PiShared/AgentPiCompactionPrompt.js";

export class AgentActionPlannerCoreModelCalls {
  constructor(private readonly caller: AgentActionPlannerStructuredCaller) {}

  async evolveTurn(
    input: AgentPiControllerDecisionInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlControllerDecision> {
    return this.caller.run({
      functionName: "EvolveTurn",
      args: {
        functionName: "EvolveTurn",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.EvolveTurn(rawOutput),
      repair: (failure) => ({
        functionName: "RepairControllerDecision",
        input,
        invalidDecision: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairControllerDecision(
    options: {
      input: AgentPiControllerDecisionInput;
      invalidDecision: string;
      issues: string[];
    },
    requestOptions: { signal?: AbortSignal } = {},
  ): Promise<BamlControllerDecision> {
    return this.caller.repair({
      functionName: "RepairControllerDecision",
      args: {
        functionName: "RepairControllerDecision",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairControllerDecision(rawOutput),
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

  async summarizePiConversation(
    input: AgentPiCompactionPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlPiConversationSummary> {
    return this.caller.run({
      functionName: "SummarizePiConversation",
      args: { functionName: "SummarizePiConversation", input },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.SummarizePiConversation(rawOutput),
      repair: (failure) => ({
        functionName: "RepairPiConversationSummary",
        input,
        invalidSummary: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairPiConversationSummary(
    options: {
      input: AgentPiCompactionPromptInput;
      invalidSummary: string;
      issues: string[];
    },
    requestOptions: { signal?: AbortSignal } = {},
  ): Promise<BamlPiConversationSummary> {
    return this.caller.repair({
      functionName: "RepairPiConversationSummary",
      args: { functionName: "RepairPiConversationSummary", ...options },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairPiConversationSummary(rawOutput),
    });
  }
}
