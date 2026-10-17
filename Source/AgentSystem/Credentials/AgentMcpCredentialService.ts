import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import type {
  AgentMcpCredentialResolver,
  AgentMcpCredentialValue,
} from "../McpPackages/AgentMcpEnvironmentTemplate.js";
import { AgentMcpCredentialRepository } from "./AgentMcpCredentialRepository.js";

export interface AgentMcpCredentialStatus {
  readonly name: string;
  readonly required: boolean;
  readonly configured: boolean;
  readonly source: "vault" | "environment" | "default" | "missing";
  readonly updatedAt?: string;
}

export class AgentMcpCredentialService implements AgentMcpCredentialResolver {
  private readonly restartGenerations = new Map<string, number>();

  constructor(
    private readonly repository: AgentMcpCredentialRepository,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  static open(workspaceRoot: string, environment: NodeJS.ProcessEnv = process.env): AgentMcpCredentialService {
    const layout = resolveAgentWorkspaceLayout(workspaceRoot);
    return new AgentMcpCredentialService(
      new AgentMcpCredentialRepository(layout.databases.credentials, {
        secretKeyPath: layout.credentialSecretKey,
        environment,
      }),
      environment,
    );
  }

  resolve(serverId: string, name: string): AgentMcpCredentialValue | undefined {
    const stored = this.repository.resolve(serverId, name);
    if (stored !== undefined) return { value: stored, source: "vault" };
    const inherited = this.environment[name];
    return inherited === undefined ? undefined : { value: inherited, source: "environment" };
  }

  statuses(
    serverId: string,
    references: readonly { name: string; required: boolean; hasDefault: boolean }[],
  ): readonly AgentMcpCredentialStatus[] {
    const stored = new Map(this.repository.list(serverId).map((entry) => [entry.name, entry]));
    return references.map((reference) => {
      const metadata = stored.get(reference.name);
      if (metadata) {
        return {
          name: reference.name,
          required: reference.required,
          configured: true,
          source: "vault",
          updatedAt: metadata.updatedAt,
        };
      }
      if (this.environment[reference.name] !== undefined) {
        return { name: reference.name, required: reference.required, configured: true, source: "environment" };
      }
      return {
        name: reference.name,
        required: reference.required,
        configured: reference.hasDefault,
        source: reference.hasDefault ? "default" : "missing",
      };
    });
  }

  set(serverId: string, name: string, value: string): void {
    this.repository.upsert(serverId, name, value);
  }

  delete(serverId: string, name: string): boolean {
    return this.repository.delete(serverId, name);
  }

  restart(serverId: string): void {
    this.restartGenerations.set(serverId, (this.restartGenerations.get(serverId) ?? 0) + 1);
  }

  revision(): string {
    const restartRevision = [...this.restartGenerations]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([serverId, generation]) => `${encodeURIComponent(serverId)}=${generation}`)
      .join("&");
    return `${this.repository.revision()}:${restartRevision}`;
  }

  close(): void {
    this.repository.close();
  }
}
