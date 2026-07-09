import { z } from "zod";

export const LoadedToolsSchema = z.union([
  z.literal("all"),
  z.literal("dynamic"),
  z.array(z.string().min(1)),
]);

export const AgentLoopSchema = z
  .object({
    LoadedTools: LoadedToolsSchema.optional(),
    PiSessionCreateTimeoutSeconds: z.number().positive().optional(),
    PiSessions: z
      .object({
        RootDir: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ToolExecutionSchema = z
  .object({
    TimeoutSeconds: z.number().positive().optional(),
    MaxStdoutBytes: z.number().int().min(1).optional(),
    MaxStderrBytes: z.number().int().min(1).optional(),
  })
  .strict();

export const SandboxRuntimeSchema = z
  .object({
    BaseDir: z.string().min(1).optional(),
    BundleDir: z.string().min(1).optional(),
    ImportBundlesOnStartup: z.boolean().optional(),
    PrepareImagesOnInstall: z.boolean().optional(),
    Images: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const PresetsSchema = z
  .object({
    Enabled: z.boolean().optional(),
    RootDir: z.string().min(1).optional(),
    StateFile: z.string().min(1).optional(),
  })
  .strict();

export const ArtifactsSchema = z
  .object({
    RootDir: z.string().min(1).optional(),
    SummaryMaxChars: z.number().int().min(256).optional(),
    RawJsonMaxBytes: z.number().int().min(1024).optional(),
    TextFileMaxBytes: z.number().int().min(1024).optional(),
  })
  .strict();

export const UploadsSchema = z
  .object({
    RootDir: z.string().min(1).optional(),
    MaxFileBytes: z.number().int().min(1).optional(),
  })
  .strict();

export const ConfigStoreSchema = z
  .object({
    Enabled: z.boolean().optional(),
    Kind: z.literal("sqlite").optional(),
    DatabasePath: z.string().min(1).optional(),
    MirrorJson: z.boolean().optional(),
  })
  .strict();

export const ServerSchema = z
  .object({
    Host: z.string().min(1).optional(),
    Port: z.number().int().min(1).max(65535).optional(),
    HotReload: z.boolean().optional(),
    RequestMaxBytes: z.number().int().min(1).optional(),
  })
  .strict();

export const PersistenceSchema = z
  .object({
    Kind: z.union([z.literal("sqlite"), z.literal("memory")]).optional(),
    DatabasePath: z.string().min(1).optional(),
  })
  .strict();

export const PluginRootsSchema = z
  .object({
    System: z.array(z.string().min(1)).optional(),
    User: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const PluginDiscoverySchema = z
  .object({
    ManifestFileName: z.string().min(1).optional(),
    ConfigFileName: z.string().min(1).optional(),
  })
  .strict();
