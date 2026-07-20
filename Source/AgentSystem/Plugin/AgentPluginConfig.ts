import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseToml, type TomlTableWithoutBigInt } from "smol-toml";
import { resolvePluginDiscoveryConfig } from "../AgentDefaults.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { LoadedPluginConfig, LoadedPluginConfigDiagnostic } from "../Types/PluginConfigTypes.js";
import {
  defaultPluginConfigToml,
  ensureFinalNewline,
  resolvePluginConfigSchemaPath,
  resolvePluginConfigTemplatePath,
  setTomlValueAtPath,
  stringifyPluginConfigToml,
  type EditableTomlTable,
} from "./AgentPluginConfigDocument.js";
import {
  projectPluginConfigSections,
  projectStrictPathDiagnostics,
  validatePluginConfigSections,
} from "./AgentPluginConfigFormProjector.js";
import {
  AgentPluginConfigDefaults,
  formatZodIssue,
  parsePluginConfigSchema,
  PluginConfigDocumentSchema,
  type ParseLoadedPluginConfigTomlOptions,
} from "./AgentPluginConfigSchema.js";
import { disabledPluginRuntimeConfig, projectPluginRuntimeConfig } from "./AgentPluginConfigRuntime.js";

export {
  defaultPluginConfigToml,
  resolvePluginConfigSchemaPath,
  resolvePluginConfigTemplatePath,
} from "./AgentPluginConfigDocument.js";
export { AgentPluginConfigDefaults } from "./AgentPluginConfigSchema.js";
export {
  isLoadedPluginAvailable,
  isLoadedPluginToolEnabled,
  projectPluginConfigSnapshot,
} from "./AgentPluginConfigRuntime.js";

export function resolvePluginConfigFileName(config: AgentSystemConfig): string {
  return resolvePluginDiscoveryConfig(config).ConfigFileName;
}

export function readLoadedPluginConfig(pluginRootPath: string, config: AgentSystemConfig): LoadedPluginConfig {
  const fileName = resolvePluginConfigFileName(config);
  const configPath = path.join(pluginRootPath, fileName);
  const templatePath = resolvePluginConfigTemplatePath(pluginRootPath, fileName);
  const schemaPath = resolvePluginConfigSchemaPath(pluginRootPath, fileName);
  const exists = fs.existsSync(configPath);
  const templateExists = fs.existsSync(templatePath);
  const schemaExists = fs.existsSync(schemaPath);
  const source = exists ? "file" : templateExists ? "example" : "default";
  const toml = exists
    ? fs.readFileSync(configPath, "utf8")
    : templateExists
      ? fs.readFileSync(templatePath, "utf8")
      : defaultPluginConfigToml();
  const parsed = parseLoadedPluginConfigToml(toml, {
    schemaPath,
    schemaToml: schemaExists ? fs.readFileSync(schemaPath, "utf8") : undefined,
    requireSchema: source !== "default",
  });

  return {
    fileName,
    path: configPath,
    exists,
    source,
    templatePath: templateExists ? templatePath : undefined,
    templateExists,
    needsUserConfig: source === "example",
    toml,
    ...parsed,
  };
}

export function parseLoadedPluginConfigToml(
  toml: string,
  options: ParseLoadedPluginConfigTomlOptions = {},
): Pick<LoadedPluginConfig, "runtime" | "sections" | "diagnostics"> {
  const schemaResult = parsePluginConfigSchema(options);
  const parsed = parsePluginConfigDocument(toml, schemaResult.diagnostics);
  if (parsed.kind === "error") {
    return parsed.result;
  }

  const root = PluginConfigDocumentSchema.safeParse(parsed.document);
  if (!root.success) {
    return {
      runtime: disabledPluginRuntimeConfig(),
      sections: [],
      diagnostics: [
        ...schemaResult.diagnostics,
        {
          severity: "error",
          message: root.error.issues.map(formatZodIssue).join("; "),
        },
      ],
    };
  }

  const sections = schemaResult.schema ? projectPluginConfigSections(parsed.document, schemaResult.schema) : [];
  const diagnostics: LoadedPluginConfigDiagnostic[] = [
    ...schemaResult.diagnostics,
    ...projectStrictPathDiagnostics(parsed.document, schemaResult.schema),
    ...validatePluginConfigSections(sections).map((message) => ({
      severity: "error" as const,
      message,
    })),
  ];

  return {
    runtime: projectPluginRuntimeConfig(root.data[AgentPluginConfigDefaults.FrameworkSection]),
    sections,
    diagnostics,
  };
}

export function validatePluginConfigTomlForWrite(toml: string, configPath?: string): void {
  const schemaPath = configPath
    ? resolvePluginConfigSchemaPath(path.dirname(configPath), path.basename(configPath))
    : undefined;
  const schemaToml = schemaPath && fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, "utf8") : undefined;
  if (configPath && !schemaToml) {
    throw new Error(
      agentErrorMessage("plugin.configTomlInvalidMissingSchema", {
        schemaPath: schemaPath ?? configPath,
      }),
    );
  }

  const parsed = parseLoadedPluginConfigToml(toml, {
    schemaPath,
    schemaToml,
    requireSchema: Boolean(configPath),
  });
  const error = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (error) {
    throw new Error(agentErrorMessage("plugin.configTomlInvalid", { message: error.message }));
  }
}

export function writePluginConfigToml(configPath: string, toml: string): boolean {
  validatePluginConfigTomlForWrite(toml, configPath);
  const next = ensureFinalNewline(toml);
  if (fs.existsSync(configPath) && fs.readFileSync(configPath, "utf8") === next) return false;

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(configPath), `.${path.basename(configPath)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, next, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaryPath, configPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return true;
}

export function setPluginConfigEnabled(
  pluginConfig: LoadedPluginConfig,
  target: { enabled: boolean; toolName?: string },
): string {
  const source = pluginConfig.toml || defaultPluginConfigToml();
  const document = parseToml(source) as EditableTomlTable;
  setTomlValueAtPath(document, pluginEnabledPath(target), target.enabled);

  const nextToml = stringifyPluginConfigToml(document);
  validatePluginConfigTomlForWrite(nextToml, pluginConfig.path);
  return nextToml;
}

function parsePluginConfigDocument(
  toml: string,
  schemaDiagnostics: readonly LoadedPluginConfigDiagnostic[],
):
  | {
      kind: "ok";
      document: TomlTableWithoutBigInt;
    }
  | {
      kind: "error";
      result: Pick<LoadedPluginConfig, "runtime" | "sections" | "diagnostics">;
    } {
  try {
    return {
      kind: "ok",
      document: parseToml(toml || defaultPluginConfigToml()) as TomlTableWithoutBigInt,
    };
  } catch (error) {
    return {
      kind: "error",
      result: {
        runtime: disabledPluginRuntimeConfig(),
        sections: [],
        diagnostics: [
          ...schemaDiagnostics,
          {
            severity: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      },
    };
  }
}

function pluginEnabledPath(target: { toolName?: string }): string[] {
  return target.toolName
    ? [AgentPluginConfigDefaults.FrameworkSection, "tools", target.toolName, "enabled"]
    : [AgentPluginConfigDefaults.FrameworkSection, "enabled"];
}
