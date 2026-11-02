import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { AgentInteractionIdentity } from "./AgentInteractionIdentity.js";
import { AgentInteractionIdentitySqlStatements } from "./AgentInteractionIdentitySqlStatements.js";
import { AgentIdentityDomains } from "../Identity/AgentShortId.js";
import type { AgentEntityReferenceRegistry } from "../Identity/AgentEntityReferenceRegistry.js";

/** Workspace-owned registry. Only authenticated adapters/console admission call this port. */
export class AgentInteractionIdentityStore {
  private readonly sql;
  constructor(
    private readonly db: Database.Database,
    private readonly references: AgentEntityReferenceRegistry,
  ) {
    this.sql = new AgentInteractionIdentitySqlStatements(db);
    // Migrate public references only. UUID ownership, memory subjects and account bindings are unchanged.
    db.transaction(() => {
      for (const principal of this.sql.all.all({})) {
        references.adoptAlias(AgentIdentityDomains.User, principal.id, principal.reference);
        const reference = references.allocate(AgentIdentityDomains.User, principal.id);
        if (reference !== principal.reference) this.sql.reference.run({ reference, id: principal.id });
      }
    }).immediate();
  }

  owner(): AgentInteractionIdentity {
    return this.resolve({ authority: "workspace-owner", account: "owner", legacySubjectId: "owner" });
  }

  canonicalSubject(subject: string): string {
    return this.sql.subject.get({ subject })?.principal_id ?? this.sql.byId.get({ id: subject })?.id ?? subject;
  }

  resolve(input: {
    readonly authority: string;
    readonly account: string;
    readonly kind?: "user" | "agent";
    readonly owner?: boolean;
    readonly legacySubjectId?: string;
  }): AgentInteractionIdentity {
    if (!input.authority.trim() || !input.account.trim())
      throw new Error("An identity requires its verified authority and account.");
    return this.db.transaction(() => {
      let principal = this.sql.find.get(input);
      if (!principal) {
        if (input.owner) principal = this.owner();
        else {
          const id = randomUUID();
          const reference = this.references.allocate(AgentIdentityDomains.User, id);
          this.sql.create.run({ id, reference, kind: input.kind ?? "user" });
          principal = { id, reference, kind: input.kind ?? "user" };
        }
        this.sql.bind.run({ ...input, id: principal.id });
      }
      if (input.owner && principal.id !== this.owner().id)
        throw new Error("This account is already bound to another identity.");
      if (input.kind && principal.kind !== input.kind) throw new Error("An identity cannot change its actor kind.");
      if (input.legacySubjectId) {
        this.sql.adopt.run({ subject: input.legacySubjectId, id: principal.id });
        if (this.sql.subject.get({ subject: input.legacySubjectId })?.principal_id !== principal.id)
          throw new Error("A historical memory subject has an ambiguous identity binding.");
      }
      return {
        ...principal,
        legacySubjectIds: this.sql.aliases.all({ id: principal.id }).map((row) => row.subject_id),
      };
    })();
  }
}
