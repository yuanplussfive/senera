import { createRequire } from "node:module";
import { z } from "zod";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessRunner.js";
import {
  toolProcessFailureResult,
  toolProcessSuccessResult,
} from "../ToolRuntime/AgentToolProcessEnvelope.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "../Xml/AgentXmlStatus.js";
import { parsePluginTomlConfig } from "../ToolRuntime/AgentToolPluginConfig.js";
import {
  normalizeToolArrayArgument,
  normalizeToolNumberArgument,
} from "../ToolRuntime/AgentToolArgumentNormalization.js";
import {
  resolveActionPlannerConfig,
  resolveModelProviderConfig,
} from "../AgentDefaults.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import type {
  AgentFastContextScoutPlannerPromptInput,
} from "../ActionPlanner/AgentFastContextScoutPlannerPromptJson.js";
import {
  parseFastContextScoutPlannerDecision,
  type AgentFastContextScoutPlannerDecision,
} from "../ActionPlanner/AgentFastContextScoutPlannerSchema.js";
import {
  isRepairablePlanningFailure,
  issueMessages,
  normalizePlanningFailure,
  stringifyIssueValue,
} from "../ActionPlanner/AgentActionPlannerFailure.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";

const nodeRequire = createRequire(__filename);
const workspaceContextCore = nodeRequire("@senera/workspace-context-core") as WorkspaceContextCoreModule;
const ripgrep = nodeRequire("@vscode/ripgrep") as { rgPath: string };

interface WorkspaceContextCoreModule {
  createContext(options: {
    pluginRoot: string;
    workspaceRoot: string;
    configFileName?: string;
  }): unknown;
  readConfigFromToml(context: unknown, parseTomlConfig: (input: string) => unknown, toml: string): unknown;
  scoutWorkspace(
    context: unknown,
    config: unknown,
    args: FastContextScoutArguments,
    deps: Record<string, unknown>,
  ): Promise<unknown>;
}

type AgentExecutionErrorCode =
  typeof AgentExecutionErrorCodes[keyof typeof AgentExecutionErrorCodes];

const StringArraySchema = z.preprocess(
  normalizeToolArrayArgument,
  z.array(z.string().trim().min(1)).min(1).transform((item) => ({ item })),
);

const BooleanLikeSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" ? true : normalized === "false" ? false : value;
}, z.boolean());

const ScoutArgumentsSchema = z
  .object({
    question: z.string().trim().min(1),
    hints: StringArraySchema.optional(),
    roots: StringArraySchema.optional(),
    exclude: StringArraySchema.optional(),
    maxQueries: z.preprocess(normalizeToolNumberArgument, z.number().int().positive()).optional(),
    maxResults: z.preprocess(normalizeToolNumberArgument, z.number().int().positive()).optional(),
    maxFiles: z.preprocess(normalizeToolNumberArgument, z.number().int().positive()).optional(),
    contextLines: z.preprocess(normalizeToolNumberArgument, z.number().int().nonnegative()).optional(),
    readLineWindow: z.preprocess(normalizeToolNumberArgument, z.number().int().positive()).optional(),
    refreshIndex: BooleanLikeSchema.optional(),
    planningMode: z.enum(["deterministic", "llm"]).optional(),
  })
  .strict();

type FastContextScoutArguments = z.infer<typeof ScoutArgumentsSchema>;

export const fastContextScoutHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = ScoutArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return scoutFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "FastContextScoutTool 参数无效。",
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => typeof entry === "number" ? entry : String(entry)),
      })),
    });
  }

  try {
    throwIfAborted(context.signal);
    const coreContext = workspaceContextCore.createContext({
      pluginRoot: context.tool.plugin.rootPath,
      workspaceRoot: context.workspaceRoot,
      configFileName: context.tool.plugin.config.fileName,
    });
    const coreConfig = workspaceContextCore.readConfigFromToml(
      coreContext,
      parsePluginTomlConfig,
      context.tool.plugin.config.toml,
    );
    const result = await workspaceContextCore.scoutWorkspace(
      coreContext,
      coreConfig,
      parsed.data,
      {
        rgPath: ripgrep.rgPath,
        signal: context.signal,
        ...llmPlannerDependency(parsed.data, coreConfig, context),
      },
    );
    return toolProcessSuccessResult(result);
  } catch (error) {
    return scoutFailure({
      code: AgentExecutionErrorCodes.PluginExecutionError,
      message: error instanceof Error ? error.message : String(error),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
      },
    });
  }
};

function llmPlannerDependency(
  args: FastContextScoutArguments,
  config: unknown,
  context: Parameters<AgentHostToolHandler>[1],
): Record<string, unknown> {
  if (!requiresLlmPlanner(args, config)) {
    return {};
  }

  const model = resolveModelProviderConfig(context.config);
  const plannerConfig = resolveActionPlannerConfig(context.config);
  const client = new AgentActionPlannerModelClient(model, plannerConfig.Client, {
    maxRepairAttempts: plannerConfig.MaxRepairAttempts,
  });
  return {
    llmScoutPlanner: {
      plan: async (
        input: AgentFastContextScoutPlannerPromptInput,
        options: { signal?: AbortSignal } = {},
      ) => planFastContextScout({
        client,
        input,
        maxRepairAttempts: plannerConfig.MaxRepairAttempts,
        signal: options.signal ?? context.signal,
      }),
    },
  };
}

function requiresLlmPlanner(args: FastContextScoutArguments, config: unknown): boolean {
  if (args.planningMode) {
    return args.planningMode === "llm";
  }

  const scout = readRecord(readRecord(config).scout);
  const planner = readRecord(scout.llmPlanner);
  return planner.mode === "llm";
}

async function planFastContextScout(options: {
  client: AgentActionPlannerModelClient;
  input: AgentFastContextScoutPlannerPromptInput;
  maxRepairAttempts: number;
  signal?: AbortSignal;
}): Promise<{
  decision: AgentFastContextScoutPlannerDecision;
  repaired: boolean;
}> {
  try {
    return {
      decision: parseFastContextScoutPlannerDecision(
        await options.client.planFastContextScout(options.input, { signal: options.signal }),
        options.input,
      ),
      repaired: false,
    };
  } catch (error) {
    return repairFastContextScoutPlanUntilParsed(options, error);
  }
}

async function repairFastContextScoutPlanUntilParsed(options: {
  client: AgentActionPlannerModelClient;
  input: AgentFastContextScoutPlannerPromptInput;
  maxRepairAttempts: number;
  signal?: AbortSignal;
}, initialError: unknown): Promise<{
  decision: AgentFastContextScoutPlannerDecision;
  repaired: boolean;
}> {
  let currentError = initialError;
  for (let attempt = 1; attempt <= options.maxRepairAttempts; attempt += 1) {
    throwIfAborted(options.signal);
    const failure = normalizePlanningFailure(currentError);
    if (!isRepairablePlanningFailure(failure.error)) {
      throw currentError;
    }

    try {
      const repaired = await options.client.repairFastContextScoutPlan({
        input: options.input,
        invalidDecision: stringifyIssueValue(failure.invalidOutput ?? failure.error),
        issues: issueMessages(failure.error),
      }, { signal: options.signal });
      return {
        decision: parseFastContextScoutPlannerDecision(repaired, options.input),
        repaired: true,
      };
    } catch (error) {
      currentError = error;
    }
  }

  throw currentError;
}

function readRecord(value: unknown = {}): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function scoutFailure(input: {
  code: AgentExecutionErrorCode;
  message: string;
  details?: Record<string, unknown>;
  diagnostics?: Array<{
    message: string;
    pointer?: string;
    path?: Array<string | number>;
  }>;
}): AgentToolProcessRunResult {
  return toolProcessFailureResult({
    code: input.code,
    message: input.message,
    diagnostics: input.diagnostics,
    details: input.details,
  });
}
