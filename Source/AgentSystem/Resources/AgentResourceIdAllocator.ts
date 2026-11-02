import type Database from "better-sqlite3";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import {
  AgentSqliteDatabaseKernel,
  AgentSqliteSynchronousModes,
  DefaultAgentSqliteDatabaseProfile,
} from "../Database/AgentSqliteDatabaseKernel.js";
import { loadAgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import { currentAgentTimeIso } from "../Time/AgentTime.js";
import runtimeContract from "./Database/runtime.json" with { type: "json" };
import { AgentShortIdContract, AgentIdentityDomains } from "../Identity/AgentShortId.js";
import { allocateAgentShortId } from "../Identity/AgentShortIdAllocator.js";

/** Crockford Base32, lowercase: no case folding or look-alike substitutions. */
export const AgentResourceIdAllocation = AgentShortIdContract;

const contract = loadAgentSqliteStoreContract(runtimeContract);

/**
 * The workspace's sole resource identity authority. Reservations outlive the
 * bytes and are never garbage-collected. An owner key makes an immutable
 * publication idempotent; it is not another externally addressable identity.
 * Connections are operation-scoped so runtime replacement cannot leak them.
 */
export function allocateAgentResourceId(workspaceRoot: string, ownerKey?: string): string {
  if (ownerKey !== undefined && ownerKey.trim().length === 0) {
    throw new TypeError("A resource publication owner key must not be empty.");
  }
  return withAgentResourceDatabase(workspaceRoot, (database) => {
    return database
      .transaction(() => {
        if (ownerKey !== undefined) {
          const existing = database
            .prepare("SELECT resource_id FROM resource_id_reservations WHERE owner_key=?")
            .get(ownerKey) as { resource_id: string } | undefined;
          if (existing) return existing.resource_id;
        }
        const insert = database.prepare(
          "INSERT INTO resource_id_reservations(resource_id,owner_key,allocated_at) VALUES (?,?,?) ON CONFLICT(resource_id) DO NOTHING",
        );
        return allocateAgentShortId(
          AgentIdentityDomains.Resource,
          (id) => insert.run(id, ownerKey ?? null, currentAgentTimeIso()).changes !== 0,
          () =>
            (database.prepare("SELECT count(*) AS count FROM resource_id_reservations").get() as { count: number })
              .count,
        );
      })
      .immediate();
  });
}

export function withAgentResourceDatabase<T>(workspaceRoot: string, operation: (database: Database.Database) => T): T {
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: resolveAgentWorkspaceLayout(workspaceRoot).databases.resources,
    contract,
    extensions: [],
    recoveryPolicy: "fail",
    profile: { ...DefaultAgentSqliteDatabaseProfile, synchronous: AgentSqliteSynchronousModes.Full },
  });
  try {
    return operation(kernel.connection);
  } finally {
    kernel.close();
  }
}
