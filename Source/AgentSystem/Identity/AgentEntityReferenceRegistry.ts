import {
  AgentSqliteDatabaseKernel,
  AgentSqliteSynchronousModes,
  DefaultAgentSqliteDatabaseProfile,
} from "../Database/AgentSqliteDatabaseKernel.js";
import { loadAgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import { agentSql } from "../Database/AgentSql.js";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";
import { allocateAgentShortId } from "./AgentShortIdAllocator.js";
import {
  isAgentShortId,
  type AgentEntityReferences,
  type AgentIdentityDomain,
  type AgentShortId,
} from "./AgentShortId.js";
import runtime from "./Database/runtime.json" with { type: "json" };

/** Durable public references. Internal ownership keys and authenticated bindings stay authoritative. */
export class AgentEntityReferenceRegistry implements AgentEntityReferences {
  private readonly kernel;
  private readonly find;
  private readonly insert;
  private readonly count;
  private readonly lookup;
  private readonly alias;

  constructor(databasePath: string, upgradeSession?: AgentUpgradeSession) {
    this.kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: loadAgentSqliteStoreContract(runtime),
      upgradeSession,
      extensions: [],
      recoveryPolicy: "fail",
      profile: { ...DefaultAgentSqliteDatabaseProfile, synchronous: AgentSqliteSynchronousModes.Full },
    });
    const db = this.kernel.connection;
    this.find = db.prepare<{ domain: string; entityId: string }, { reference: string }>(agentSql`
      SELECT reference FROM entity_references WHERE domain=@domain AND entity_id=@entityId
    `);
    this.insert = db.prepare(agentSql`
      INSERT INTO entity_references(domain,reference,entity_id)
      SELECT @domain,@reference,@entityId WHERE NOT EXISTS (
        SELECT 1 FROM entity_reference_aliases WHERE domain=@domain AND alias=@reference
      )
      ON CONFLICT(domain,reference) DO NOTHING
    `);
    this.count = db.prepare<{ domain: string }, { count: number }>(agentSql`
      SELECT count(*) AS count FROM (
        SELECT reference FROM entity_references WHERE domain=@domain
        UNION SELECT alias FROM entity_reference_aliases WHERE domain=@domain
      )
    `);
    this.lookup = db.prepare<{ domain: string; reference: string }, { entity_id: string }>(agentSql`
      SELECT entity_id FROM entity_references WHERE domain=@domain AND reference=@reference
      UNION ALL
      SELECT r.entity_id FROM entity_reference_aliases a
      JOIN entity_references r ON r.domain=a.domain AND r.reference=a.reference
      WHERE a.domain=@domain AND a.alias=@reference
    `);
    this.alias = db.prepare(agentSql`
      INSERT INTO entity_reference_aliases(domain,alias,reference) VALUES(@domain,@alias,@reference)
      ON CONFLICT(domain,alias) DO NOTHING
    `);
  }

  allocate<Domain extends AgentIdentityDomain>(
    domain: Domain,
    entityId: string,
    reference?: string,
  ): AgentShortId<Domain> {
    if (!entityId.trim()) throw new TypeError("An entity reference requires a stable identity.");
    if (reference !== undefined && !isAgentShortId(reference))
      throw new TypeError("Invalid public identity reference.");
    return this.kernel.connection
      .transaction(() => {
        const existing = this.find.get({ domain, entityId });
        if (existing) {
          if (reference !== undefined && reference !== existing.reference)
            throw new Error("A public identity reference has conflicting ownership.");
          return existing.reference as AgentShortId<Domain>;
        }
        if (reference !== undefined) {
          if (!this.insert.run({ domain, reference, entityId }).changes)
            throw new Error("A public identity reference is already reserved.");
          return reference as AgentShortId<Domain>;
        }
        return allocateAgentShortId(
          domain,
          (reference) => this.insert.run({ domain, reference, entityId }).changes !== 0,
          () => this.count.get({ domain })!.count,
        );
      })
      .immediate();
  }

  resolve(domain: AgentIdentityDomain, reference: string): string | undefined {
    return this.lookup.get({ domain, reference })?.entity_id;
  }

  /** Exact migration aliases only; an alias can never be reassigned to another entity. */
  adoptAlias(domain: AgentIdentityDomain, entityId: string, alias: string): void {
    if (!alias.trim()) throw new TypeError("An identity alias must not be empty.");
    this.kernel.connection
      .transaction(() => {
        const bound = this.resolve(domain, alias);
        if (bound !== undefined && bound !== entityId) throw new Error("An identity alias has conflicting ownership.");
        const reference = this.allocate(domain, entityId, isAgentShortId(alias) ? alias : undefined);
        this.alias.run({ domain, alias, reference });
      })
      .immediate();
  }

  close(): void {
    this.kernel.close();
  }
}
