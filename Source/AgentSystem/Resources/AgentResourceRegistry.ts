import path from "node:path";
import { allocateAgentResourceId, withAgentResourceDatabase } from "./AgentResourceIdAllocator.js";
import { createAgentResourceUri, parseAgentResourceId } from "./AgentResourceUri.js";
import { currentAgentTimeIso } from "../Time/AgentTime.js";

export interface AgentResourceRecord {
  readonly resource_id: string;
  readonly kind: "artifact" | "file";
  readonly entity_id: string;
  readonly locator: string;
  readonly state: "pending" | "ready" | "deleted";
}

/** Identity metadata is authoritative; content and checksums stay with the storage owner. */
export function findAgentResourceRecord(workspaceRoot: string, reference: string): AgentResourceRecord | undefined {
  const id = parseAgentResourceId(reference) ?? reference;
  return withAgentResourceDatabase(workspaceRoot, (database) =>
    database
      .prepare<unknown[], AgentResourceRecord>(
        `SELECT r.* FROM resource_records r
       WHERE r.resource_id = ? OR r.entity_id = ? OR r.resource_id IN
         (SELECT resource_id FROM resource_uri_aliases WHERE alias = ?)`,
      )
      .get(id, id, reference),
  );
}

export function registerAgentArtifactResource(
  workspaceRoot: string,
  input: { readonly artifactId: string; readonly artifactUri: string; readonly manifestPath: string },
): string {
  const nativeId = parseAgentResourceId(input.artifactUri);
  const resourceId = nativeId ?? allocateAgentResourceId(workspaceRoot, `artifact:${input.artifactId}`);
  const locator = path.relative(workspaceRoot, input.manifestPath).replaceAll("\\", "/");
  if (path.isAbsolute(locator) || locator === ".." || locator.startsWith("../")) {
    throw new Error("Resource manifest must remain inside its workspace.");
  }
  return withAgentResourceDatabase(workspaceRoot, (database) =>
    database
      .transaction(() => {
        // Imported identities also reserve their IDs permanently. A conflicting
        // owner is rejected rather than allowing a resource to change identity.
        const reservation = database
          .prepare<unknown[], { owner_key: string | null }>(
            "SELECT owner_key FROM resource_id_reservations WHERE resource_id = ?",
          )
          .get(resourceId);
        if (reservation && !reservation.owner_key?.startsWith("artifact:")) {
          throw new Error(`Resource identity belongs to another publisher: ${resourceId}.`);
        }
        if (!reservation)
          database
            .prepare("INSERT INTO resource_id_reservations(resource_id, owner_key, allocated_at) VALUES (?, ?, ?)")
            .run(resourceId, `artifact:${input.artifactId}`, currentAgentTimeIso());
        const existing = database
          .prepare<unknown[], AgentResourceRecord>("SELECT * FROM resource_records WHERE resource_id = ?")
          .get(resourceId);
        if (
          existing &&
          (existing.kind !== "artifact" || existing.entity_id !== input.artifactId || existing.locator !== locator)
        ) {
          throw new Error(`Resource identity conflict: ${resourceId}.`);
        }
        if (existing?.state === "deleted") throw new Error(`Resource has been deleted: ${resourceId}.`);
        database
          .prepare(
            `INSERT INTO resource_records(resource_id, kind, entity_id, locator, state)
       VALUES (?, 'artifact', ?, ?, 'ready')
         ON CONFLICT(resource_id) DO UPDATE SET state = 'ready' WHERE resource_records.state = 'pending'`,
          )
          .run(resourceId, input.artifactId, locator);
        for (const alias of [input.artifactUri, `urn:senera:artifact:${input.artifactId}`]) {
          database
            .prepare("INSERT INTO resource_uri_aliases(alias, resource_id) VALUES (?, ?) ON CONFLICT(alias) DO NOTHING")
            .run(alias, resourceId);
          const bound = database
            .prepare<unknown[], { resource_id: string }>("SELECT resource_id FROM resource_uri_aliases WHERE alias = ?")
            .get(alias);
          if (bound?.resource_id !== resourceId) throw new Error(`Resource alias conflict: ${alias}.`);
        }
        return createAgentResourceUri(resourceId);
      })
      .immediate(),
  );
}

export function markAgentResourceDeleted(workspaceRoot: string, reference: string): void {
  const record = findAgentResourceRecord(workspaceRoot, reference);
  if (!record) return;
  withAgentResourceDatabase(workspaceRoot, (database) => {
    database.prepare("UPDATE resource_records SET state = 'deleted' WHERE resource_id = ?").run(record.resource_id);
  });
}
