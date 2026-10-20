import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import type { AgentApplicationPaths } from "../Core/AgentApplicationPaths.js";
import { parseAgentExtensionInputValue, type AgentExtensionInputValue } from "../Extensions/AgentExtensionInput.js";
import type {
  AgentExtensionValueBinding,
  AgentExtensionValueResolution,
  AgentExtensionValueResolver,
} from "../Extensions/AgentExtensionValueExpression.js";
import type { AgentMcpInputDefinition } from "../McpPackages/AgentMcpInputDefinition.js";
import { AgentMcpCredentialRepository } from "./AgentMcpCredentialRepository.js";
import type { AgentMcpCredentialResolution, AgentMcpInputStorageMutation } from "./AgentMcpCredentialRepository.js";
import type { AgentLegacySecretKeyRelocation } from "../Security/AgentSecretKeyRing.js";

export interface AgentMcpInputStatus {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly type: AgentMcpInputDefinition["type"];
  readonly required: boolean;
  readonly secret: boolean;
  readonly multiple: boolean;
  readonly configured: boolean;
  readonly stored: boolean;
  readonly source: "vault" | "configuration" | "environment" | "oauth" | "default" | "unresolved" | "missing";
  readonly provenance: AgentMcpInputDefinition["provenance"];
  readonly value?: AgentExtensionInputValue;
  readonly defaultValue?: AgentExtensionInputValue;
  readonly choices?: readonly AgentExtensionInputValue[];
  readonly placeholder?: string;
  readonly min?: number;
  readonly max?: number;
  readonly updatedAt?: string;
}

export interface AgentMcpInputBatchUpdate {
  readonly values: Readonly<Record<string, unknown>>;
  readonly deletes?: readonly string[];
}

type BindingProjection =
  | { readonly status: "value"; readonly resolution: AgentExtensionValueResolution }
  | { readonly status: "unresolved" }
  | { readonly status: "absent" };

function projectStoredCredential(stored: AgentMcpCredentialResolution): BindingProjection {
  if (stored.status === "resolved") return { status: "value", resolution: { value: stored.value, source: "vault" } };
  return stored.status === "unresolved" ? { status: "unresolved" } : { status: "absent" };
}

export class AgentMcpInputService implements AgentExtensionValueResolver {
  private readonly restartGenerations = new Map<string, number>();

  constructor(
    protected readonly repository: AgentMcpCredentialRepository,
    protected readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  static open(
    workspaceRoot: string,
    environment: NodeJS.ProcessEnv = process.env,
    secretKeysRoot?: string,
    applicationPaths?: AgentApplicationPaths,
  ): AgentMcpInputService {
    const layout = resolveAgentWorkspaceLayout(workspaceRoot);
    return new AgentMcpInputService(
      new AgentMcpCredentialRepository(layout.databases.credentials, {
        workspaceRoot,
        secretKeysRoot,
        applicationPaths,
        environment,
      }),
      environment,
    );
  }

  /** Key files this host moved out of the workspace while opening the vault, plus any it could not move. */
  relocatedLegacyKeys(): readonly AgentLegacySecretKeyRelocation[] {
    return this.repository.relocatedLegacyKeys();
  }

  resolve(serverId: string, binding: AgentExtensionValueBinding): AgentExtensionValueResolution | undefined {
    const projected = this.projectBinding(serverId, binding);
    return projected.status === "value" ? projected.resolution : undefined;
  }

  /** One lookup per binding: a stored secret this host cannot open is a state of its own, not absence. */
  private projectBinding(serverId: string, binding: AgentExtensionValueBinding): BindingProjection {
    switch (binding.source) {
      case "secret":
        return projectStoredCredential(this.repository.resolve(serverId, binding.inputId));
      case "config": {
        const value = this.repository.resolveInput(serverId, binding.inputId);
        return value === undefined
          ? { status: "absent" }
          : { status: "value", resolution: { value, source: "configuration" } };
      }
      case "oauth":
        return { status: "absent" };
      case "hostEnvironment": {
        const value = this.environment[binding.name];
        return value === undefined
          ? { status: "absent" }
          : { status: "value", resolution: { value, source: "environment" } };
      }
      case "legacyEnvironment": {
        const stored = this.repository.resolve(serverId, binding.inputId ?? binding.name);
        // An unreadable stored credential keeps its slot: substituting a host variable the user never
        // chose would launch the server with a different secret than the one shown as saved.
        if (stored.status !== "missing") return projectStoredCredential(stored);
        const inherited = this.environment[binding.name];
        return inherited === undefined
          ? { status: "absent" }
          : { status: "value", resolution: { value: inherited, source: "environment" } };
      }
      case "runtime":
        return { status: "absent" };
    }
  }

  statuses(serverId: string, definitions: readonly AgentMcpInputDefinition[]): readonly AgentMcpInputStatus[] {
    const secretMetadata = new Map(this.repository.list(serverId).map((entry) => [entry.name, entry]));
    const configMetadata = new Map(this.repository.listInputs(serverId).map((entry) => [entry.inputId, entry]));
    return definitions.map((definition) => {
      const projected = this.projectBinding(serverId, definition.binding);
      const resolved = projected.status === "value" ? projected.resolution : undefined;
      const effectiveValue = resolved?.value ?? definition.defaultValue;
      const secretStored = secretMetadata.get(definition.id);
      const configStored = configMetadata.get(definition.id);
      const metadata = secretStored ?? configStored;
      const source =
        resolved?.source ??
        (projected.status === "unresolved"
          ? "unresolved"
          : definition.defaultValue !== undefined
            ? "default"
            : "missing");
      return {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        type: definition.type,
        required: definition.required,
        secret: definition.secret,
        multiple: definition.multiple,
        configured: effectiveValue !== undefined,
        stored: Boolean(metadata),
        source,
        provenance: definition.provenance,
        ...(!definition.secret && effectiveValue !== undefined ? { value: effectiveValue } : {}),
        ...(definition.defaultValue !== undefined ? { defaultValue: definition.defaultValue } : {}),
        ...(definition.choices ? { choices: definition.choices } : {}),
        ...(definition.placeholder !== undefined ? { placeholder: definition.placeholder } : {}),
        ...(definition.min !== undefined ? { min: definition.min } : {}),
        ...(definition.max !== undefined ? { max: definition.max } : {}),
        ...(metadata ? { updatedAt: metadata.updatedAt } : {}),
      };
    });
  }

  set(serverId: string, definition: AgentMcpInputDefinition, value: unknown): void {
    const parsed = parseAgentExtensionInputValue(definition, value);
    if (definition.secret && parsed === "") throw new Error(`Secret input ${definition.id} cannot be empty.`);
    if (definition.binding.source === "secret" || definition.binding.source === "legacyEnvironment") {
      if (typeof parsed !== "string") throw new Error(`Secret input ${definition.id} must be a string.`);
      this.repository.upsert(serverId, definition.id, parsed);
      return;
    }
    if (definition.binding.source !== "config") {
      throw new Error(`MCP input ${definition.id} is managed by ${definition.binding.source} and cannot be stored.`);
    }
    this.repository.upsertInput(serverId, definition.id, parsed);
  }

  delete(serverId: string, definition: AgentMcpInputDefinition): boolean {
    if (definition.binding.source === "secret" || definition.binding.source === "legacyEnvironment") {
      return this.repository.delete(serverId, definition.id);
    }
    if (definition.binding.source === "config") return this.repository.deleteInput(serverId, definition.id);
    throw new Error(`MCP input ${definition.id} is managed by ${definition.binding.source} and cannot be deleted.`);
  }

  update(serverId: string, definitions: readonly AgentMcpInputDefinition[], update: AgentMcpInputBatchUpdate): void {
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const valueIds = Object.keys(update.values);
    const deleteIds = [...new Set(update.deletes ?? [])];
    const duplicates = valueIds.filter((inputId) => deleteIds.includes(inputId));
    if (duplicates.length > 0) {
      throw new Error(`MCP inputs cannot be set and deleted together: ${duplicates.sort().join(", ")}.`);
    }
    const mutations: AgentMcpInputStorageMutation[] = [];
    for (const inputId of valueIds.sort()) {
      const definition = definitionsById.get(inputId);
      if (!definition) throw new Error(`MCP server ${serverId} does not declare input ${inputId}.`);
      const parsed = parseAgentExtensionInputValue(definition, update.values[inputId]);
      if (definition.secret && parsed === "") throw new Error(`Secret input ${definition.id} cannot be empty.`);
      if (definition.binding.source === "secret" || definition.binding.source === "legacyEnvironment") {
        if (typeof parsed !== "string") throw new Error(`Secret input ${definition.id} must be a string.`);
        mutations.push({ kind: "set_secret", inputId, value: parsed });
      } else if (definition.binding.source === "config") {
        mutations.push({ kind: "set_value", inputId, value: parsed });
      } else {
        throw new Error(`MCP input ${definition.id} is managed by ${definition.binding.source} and cannot be stored.`);
      }
    }
    for (const inputId of deleteIds.sort()) {
      const definition = definitionsById.get(inputId);
      if (!definition) throw new Error(`MCP server ${serverId} does not declare input ${inputId}.`);
      if (definition.binding.source === "secret" || definition.binding.source === "legacyEnvironment") {
        mutations.push({ kind: "delete_secret", inputId });
      } else if (definition.binding.source === "config") {
        mutations.push({ kind: "delete_value", inputId });
      } else {
        throw new Error(`MCP input ${definition.id} is managed by ${definition.binding.source} and cannot be deleted.`);
      }
    }
    this.repository.updateInputs(serverId, mutations);
  }

  restart(serverId: string): void {
    this.restartGenerations.set(serverId, (this.restartGenerations.get(serverId) ?? 0) + 1);
  }

  revision(): string {
    const restartRevision = [...this.restartGenerations]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([serverId, generation]) => `${encodeURIComponent(serverId)}=${generation}`)
      .join("&");
    return `${this.repository.revision()}:${this.repository.inputRevision()}:${restartRevision}`;
  }

  close(): void {
    this.repository.close();
  }
}
