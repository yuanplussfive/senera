import type { z } from "zod";
import { AgentHostCapabilityNames } from "../AgentDefaultHostCapabilities.js";
import { AskUserArgumentsSchema } from "../Conversation/AgentAskUserRuntime.js";
import { ArtifactMemoryReadArgumentsSchema } from "../Memory/AgentArtifactMemoryTypes.js";
import { MemoryRecallArgumentsSchema } from "../Memory/AgentMemoryRecallTypes.js";
import { MemoryWriteArgumentsSchema } from "../Memory/AgentMemoryWriteRuntime.js";
import {
  AgentStopArgumentsSchema,
  AgentContactSupervisorArgumentsSchema,
  AgentInputArgumentsSchema,
  AgentResumeArgumentsSchema,
  AgentSpawnArgumentsSchema,
  AgentWaitArgumentsSchema,
  AgentScheduleManageArgumentsSchema,
} from "../Orchestration/AgentOrchestrationHostTools.js";
import { ShellCommandArgumentsSchema } from "../ToolRuntime/AgentShellCommandRuntime.js";

export interface AgentBundledHostToolInputContract {
  readonly capability: (typeof AgentHostCapabilityNames)[keyof typeof AgentHostCapabilityNames];
  readonly input: z.ZodType<Record<string, unknown>>;
}

/**
 * Runtime-owned input contracts for bundled Host Tools whose handlers validate
 * arguments with Zod. Build-time generation discovers the matching extension
 * contribution by capability, so package paths and tool names are not repeated.
 */
export const AgentBundledHostToolInputContracts = Object.freeze([
  {
    capability: AgentHostCapabilityNames.ShellRun,
    input: ShellCommandArgumentsSchema,
  },
  {
    capability: AgentHostCapabilityNames.ArtifactMemoryRead,
    input: ArtifactMemoryReadArgumentsSchema,
  },
  {
    capability: AgentHostCapabilityNames.MemoryRecall,
    input: MemoryRecallArgumentsSchema,
  },
  {
    capability: AgentHostCapabilityNames.MemoryWrite,
    input: MemoryWriteArgumentsSchema,
  },
  {
    capability: AgentHostCapabilityNames.AskUser,
    input: AskUserArgumentsSchema,
  },
  {
    capability: AgentHostCapabilityNames.AgentSpawn,
    input: AgentSpawnArgumentsSchema,
  },
  {
    capability: AgentHostCapabilityNames.AgentWait,
    input: AgentWaitArgumentsSchema,
  },
  {
    capability: AgentHostCapabilityNames.AgentInput,
    input: AgentInputArgumentsSchema,
  },
  {
    capability: AgentHostCapabilityNames.AgentStop,
    input: AgentStopArgumentsSchema,
  },
  {
    capability: AgentHostCapabilityNames.AgentResume,
    input: AgentResumeArgumentsSchema,
  },
  {
    capability: AgentHostCapabilityNames.AgentContactSupervisor,
    input: AgentContactSupervisorArgumentsSchema,
  },
  {
    capability: AgentHostCapabilityNames.ScheduleManage,
    input: AgentScheduleManageArgumentsSchema,
  },
] satisfies readonly AgentBundledHostToolInputContract[]);
