import { b as baml } from "../BamlClient/baml_client/index.js";
import type {
  ActionPlanInput,
  InteractionRoute as BamlInteractionRoute,
  PiControllerAction as BamlPiControllerAction,
  PiToolArgumentsDraft as BamlPiToolArgumentsDraft,
  ToolRiskAudit as BamlToolRiskAudit,
  TurnUnderstanding as BamlTurnUnderstanding,
} from "../BamlClient/baml_client/types.js";
import type { AgentActionPlannerStructuredCaller } from "./AgentActionPlannerStructuredCaller.js";
import type {
  AgentPiControllerActionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../PiProxy/AgentPiAssistantMessageTypes.js";
import type { AgentBamlToolRiskAuditPromptInput } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";

export class AgentActionPlannerCoreModelCalls {
  constructor(private readonly caller: AgentActionPlannerStructuredCaller) {}

  async understandUserTurn(
    input: ActionPlanInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlTurnUnderstanding> {
    return this.caller.run({
      functionName: "UnderstandUserTurn",
      args: {
        functionName: "UnderstandUserTurn",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.UnderstandUserTurn(rawOutput),
      repair: (failure) => ({
        functionName: "RepairTurnUnderstanding",
        input,
        invalidUnderstanding: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async routeInteraction(
    input: ActionPlanInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlInteractionRoute> {
    return this.caller.run({
      functionName: "RouteInteraction",
      args: {
        functionName: "RouteInteraction",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.RouteInteraction(rawOutput),
      repair: (failure) => ({
        functionName: "RepairInteractionRoute",
        input,
        invalidRoute: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairTurnUnderstanding(options: {
    input: ActionPlanInput;
    invalidUnderstanding: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlTurnUnderstanding> {
    return this.caller.repair({
      functionName: "RepairTurnUnderstanding",
      args: {
        functionName: "RepairTurnUnderstanding",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairTurnUnderstanding(rawOutput),
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

  async repairPiAction(options: {
    input: AgentPiControllerActionInput;
    invalidAction: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlPiControllerAction> {
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

  async repairToolRiskAudit(options: {
    input: AgentBamlToolRiskAuditPromptInput;
    invalidAudit: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlToolRiskAudit> {
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
}
