import { z } from "zod";
import { AgentCliConfigSchema } from "./AgentCliConfigSchema.js";
import { FrontendSchema } from "./AgentAppConfigSchema.js";
import { AgentDelegationSchema } from "./AgentDelegationConfigSchema.js";
import {
  ModelGroupSchema,
  ModelProviderEndpointSchema,
  ModelProviderSchema,
} from "./AgentModelConfigSchema.js";
import { ActionPlannerSchema } from "./AgentPlannerConfigSchema.js";
import {
  AgentLoopSchema,
  ArtifactsSchema,
  ConfigStoreSchema,
  PersistenceSchema,
  PluginDiscoverySchema,
  PluginRootsSchema,
  PresetsSchema,
  ServerSchema,
  ToolExecutionSchema,
  UploadsSchema,
} from "./AgentRuntimeConfigSchema.js";
import {
  MemoryLearningSchema,
  ToolLearningSchema,
  ToolSearchSchema,
  VectorModelsSchema,
} from "./AgentToolMemoryConfigSchema.js";

const AgentDefaultsSchema = z
  .object({
    PluginRoots: PluginRootsSchema.optional(),
    PluginDiscovery: PluginDiscoverySchema.optional(),
    Cli: AgentCliConfigSchema.optional(),
    ToolExecution: ToolExecutionSchema.optional(),
    AgentLoop: AgentLoopSchema.optional(),
    AgentDelegation: AgentDelegationSchema.optional(),
    ToolSearch: ToolSearchSchema.optional(),
    VectorModels: VectorModelsSchema.optional(),
    ToolLearning: ToolLearningSchema.optional(),
    MemoryLearning: MemoryLearningSchema.optional(),
    Presets: PresetsSchema.optional(),
    Artifacts: ArtifactsSchema.optional(),
    Uploads: UploadsSchema.optional(),
    ActionPlanner: ActionPlannerSchema.optional(),
    Frontend: FrontendSchema.optional(),
    Server: ServerSchema.optional(),
    Persistence: PersistenceSchema.optional(),
    ConfigStore: ConfigStoreSchema.optional(),
  })
  .strict();

export const AgentSystemConfigSchema = z
  .object({
    Defaults: AgentDefaultsSchema.optional(),
    PluginRoots: PluginRootsSchema.optional(),
    PluginDiscovery: PluginDiscoverySchema.optional(),
    XmlProtocol: z
      .object({
        MaxDepth: z.number().int().min(1).optional(),
        MaxTextLength: z.number().int().min(1).optional(),
        MaxDecisionTokens: z.number().int().min(1).optional(),
        MaxToolCalls: z.number().int().min(1).optional(),
        ArrayElementNames: z.array(z.string().min(1)).optional(),
        ArrayElementNameSuffix: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    ToolExecution: ToolExecutionSchema.optional(),
    PluginDocumentation: z
      .object({
        Markdown: z
          .object({
            MinNonEmptyLines: z.number().int().min(1),
            ExcludePathFragments: z.array(z.string().min(1)),
          })
          .strict()
          .optional(),
        ToolDescription: z
          .object({
            MinNonEmptyLines: z.number().int().min(1),
            SummarySection: z.string().min(1),
            TriggerSection: z.string().min(1),
            AvoidSection: z.string().min(1),
            RequiredSections: z.array(z.string().min(1)),
          })
          .strict(),
        DecisionActionDescription: z
          .object({
            MinNonEmptyLines: z.number().int().min(1),
            SummarySection: z.string().min(1),
            TriggerSection: z.string().min(1),
            AvoidSection: z.string().min(1),
            RequiredSections: z.array(z.string().min(1)),
          })
          .strict()
          .optional(),
        PromptXml: z
          .object({
            XmlFenceLanguages: z.array(z.string().min(1)).optional(),
            CodeFenceLanguages: z.array(z.string().min(1)).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    DefaultModelProviderId: z.string().min(1).optional(),
    ModelProviderEndpoints: z.array(ModelProviderEndpointSchema).optional(),
    ModelProviders: z.array(ModelProviderSchema).min(1),
    ModelGroups: z.array(ModelGroupSchema).optional(),
    Cli: AgentCliConfigSchema.optional(),
    AgentLoop: AgentLoopSchema.optional(),
    AgentDelegation: AgentDelegationSchema.optional(),
    ToolSearch: ToolSearchSchema.optional(),
    VectorModels: VectorModelsSchema.optional(),
    ToolLearning: ToolLearningSchema.optional(),
    MemoryLearning: MemoryLearningSchema.optional(),
    Presets: PresetsSchema.optional(),
    Artifacts: ArtifactsSchema.optional(),
    Uploads: UploadsSchema.optional(),
    ActionPlanner: ActionPlannerSchema.optional(),
    Frontend: FrontendSchema.optional(),
    Server: ServerSchema.optional(),
    Persistence: PersistenceSchema.optional(),
    ConfigStore: ConfigStoreSchema.optional(),
  })
  .strict();
