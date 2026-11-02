import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { allocateAgentResourceId } from "../../../Source/AgentSystem/Resources/AgentResourceIdAllocator.js";
import { createAgentResourceUri } from "../../../Source/AgentSystem/Resources/AgentResourceUri.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { AgentUploadStore } from "../../../Source/AgentSystem/Uploads/AgentUploadStore.js";
import { resolveUploadsConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import {
  registerAgentArtifactResource,
  findAgentResourceRecord,
  markAgentResourceDeleted,
} from "../../../Source/AgentSystem/Resources/AgentResourceRegistry.js";
import { createAgentArtifactLocator } from "../../../Source/AgentSystem/Artifacts/AgentArtifactLocator.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { AgentEntityReferenceRegistry } from "../../../Source/AgentSystem/Identity/AgentEntityReferenceRegistry.js";
import { AgentIdentityDomains } from "../../../Source/AgentSystem/Identity/AgentShortId.js";
import { AgentChannelsDatabase } from "../../../Source/AgentSystem/Channels/AgentChannelsDatabase.js";
import { AgentInteractionIdentityStore } from "../../../Source/AgentSystem/Interaction/AgentInteractionIdentityStore.js";

const roots: string[] = [];
const workspace = () => {
  const root = createTemporaryDirectory("senera-resource-identities");
  roots.push(root);
  return root;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) removeDirectory(root);
});

describe("workspace resource identity authority", () => {
  test("entity references remain stable across restart and domain collisions cannot cross ownership", () => {
    const file = resolveAgentWorkspaceLayout(workspace()).databases.identities;
    let registry = new AgentEntityReferenceRegistry(file);
    try {
      const random = vi.spyOn(crypto, "randomBytes").mockImplementation(() => Buffer.alloc(6));
      const user = registry.allocate(AgentIdentityDomains.User, "user-uuid");
      const agent = registry.allocate(AgentIdentityDomains.Agent, "agent-uuid");
      expect(user).toBe("000000");
      expect(agent).toBe(user);
      expect(registry.resolve(AgentIdentityDomains.User, agent)).toBe("user-uuid");
      expect(registry.resolve(AgentIdentityDomains.Agent, user)).toBe("agent-uuid");
      registry.adoptAlias(AgentIdentityDomains.User, "user-uuid", "u1");
      expect(() => registry.adoptAlias(AgentIdentityDomains.User, "another-uuid", "u1")).toThrow();
      random.mockRestore();
      registry.close();
      registry = new AgentEntityReferenceRegistry(file);
      expect(registry.allocate(AgentIdentityDomains.User, "user-uuid")).toBe(user);
      expect(registry.resolve(AgentIdentityDomains.User, "u1")).toBe("user-uuid");
      expect(() => registry.allocate(AgentIdentityDomains.User, "user-uuid", "111111")).toThrow();
    } finally {
      registry.close();
    }
  });

  test("migrating participant references preserves authenticated accounts and memory subject UUIDs", () => {
    const layout = resolveAgentWorkspaceLayout(workspace());
    const registry = new AgentEntityReferenceRegistry(layout.databases.identities);
    const channels = new AgentChannelsDatabase(layout.databases.channels);
    try {
      channels.connection
        .prepare("INSERT INTO interaction_principals(id,reference,kind) VALUES(?,?,?)")
        .run("owner-uuid", "u1", "user");
      channels.connection
        .prepare("INSERT INTO interaction_identity_bindings(authority,account,principal_id) VALUES(?,?,?)")
        .run("workspace-owner", "owner", "owner-uuid");
      channels.connection
        .prepare("INSERT INTO interaction_legacy_subjects(subject_id,principal_id) VALUES(?,?)")
        .run("owner", "owner-uuid");
      const identities = new AgentInteractionIdentityStore(channels.connection, registry);
      const owner = identities.owner();
      expect(owner.id).toBe("owner-uuid");
      expect(owner.reference).toMatch(/^[0-9a-hjkmnp-tv-z]{6}$/u);
      expect(identities.canonicalSubject("owner")).toBe(owner.id);
      expect(registry.resolve(AgentIdentityDomains.User, "u1")).toBe(owner.id);
      expect(new AgentInteractionIdentityStore(channels.connection, registry).owner()).toEqual(owner);
      expect(identities.resolve({ authority: "onebot", account: "123" }).id).not.toBe(owner.id);
    } finally {
      channels.close();
      registry.close();
    }
  });
  test("Artifact bundles share allocation, retry identity and permanent tombstones with file resources", () => {
    const root = workspace();
    const input = {
      workspaceRoot: root,
      requestId: "request-1",
      step: 1,
      callIndex: 1,
      callId: "call-1",
      toolName: "Reader",
      argsHash: "a",
      resultHash: "b",
    };
    const first = createAgentArtifactLocator(input);
    expect(createAgentArtifactLocator(input).artifactUri).toBe(first.artifactUri);
    expect(first.artifactId).toMatch(/^[0-9a-hjkmnp-tv-z]{6}$/u);
    const publication = {
      artifactId: first.artifactId,
      artifactUri: first.artifactUri,
      manifestPath: first.files.manifest!,
    };
    expect(registerAgentArtifactResource(root, publication)).toBe(first.artifactUri);
    expect(findAgentResourceRecord(root, first.artifactUri)).toMatchObject({
      kind: "artifact",
      state: "ready",
      entity_id: first.artifactId,
    });
    markAgentResourceDeleted(root, first.artifactUri);
    expect(() => registerAgentArtifactResource(root, publication)).toThrow(/deleted/u);
    expect(findAgentResourceRecord(root, first.artifactUri)?.state).toBe("deleted");
    const uploadId = allocateAgentResourceId(root, "upload:first");
    expect(() =>
      registerAgentArtifactResource(root, {
        ...publication,
        artifactId: uploadId,
        artifactUri: createAgentResourceUri(uploadId),
      }),
    ).toThrow(/another publisher/u);
  });
  test("reserves colliding candidates atomically and retains immutable publication identities after reopening", () => {
    const root = workspace();
    const random = vi.spyOn(crypto, "randomBytes");
    random
      .mockImplementationOnce(() => Buffer.alloc(6))
      .mockImplementationOnce(() => Buffer.alloc(6))
      .mockImplementationOnce(() => Buffer.alloc(6, 1));
    expect(allocateAgentResourceId(root, "publication:first")).toBe("000000");
    expect(allocateAgentResourceId(root, "publication:second")).toBe("111111");
    expect(allocateAgentResourceId(root, "publication:first")).toBe("000000");
    expect(random).toHaveBeenCalledTimes(3);
  });

  test("uploads share the authority and deleting bytes cannot release an allocated ID", async () => {
    const root = workspace();
    const store = new AgentUploadStore({ workspaceRoot: root, config: resolveUploadsConfig({ ModelProviders: [] }) });
    const random = vi.spyOn(crypto, "randomBytes");
    random.mockImplementationOnce(() => Buffer.alloc(6));
    const first = await store.publishBytes({ bytes: Buffer.from("first"), name: "first.txt", mime: "text/plain" });
    expect(first.resourceUri).toBe(createAgentResourceUri("000000"));
    expect(await store.delete(first.resourceUri)).toBe(true);
    random.mockImplementationOnce(() => Buffer.alloc(6)).mockImplementationOnce(() => Buffer.alloc(6, 2));
    expect(allocateAgentResourceId(root, "artifact:second")).toBe("222222");
    await expect(store.resolve(first.resourceUri)).rejects.toMatchObject({ code: "ENOENT" });
    const database = new Database(resolveAgentWorkspaceLayout(root).databases.resources);
    try {
      expect(database.prepare("SELECT resource_id FROM resource_id_reservations ORDER BY resource_id").all()).toEqual([
        { resource_id: "000000" },
        { resource_id: "222222" },
      ]);
    } finally {
      database.close();
    }
  });

  test("separate publishing processes allocate from the same durable namespace", async () => {
    const root = workspace();
    allocateAgentResourceId(root, "initialize");
    const module = new URL("../../../Source/AgentSystem/Resources/AgentResourceIdAllocator.ts", import.meta.url).href;
    const source = `import { allocateAgentResourceId } from ${JSON.stringify(module)};
      const ids = Array.from({length: 12}, () => allocateAgentResourceId(process.argv[1]));
      console.log(JSON.stringify(ids));`;
    const results = await Promise.all(
      [0, 1].map(() =>
        promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source, root], {
          windowsHide: true,
        }),
      ),
    );
    const ids = results.flatMap(({ stdout }) => JSON.parse(stdout) as string[]);
    expect(ids).toHaveLength(24);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{6}$/u);
  }, 30_000);

  test("keeps a damaged identity ledger intact instead of restarting allocation", () => {
    const root = workspace();
    const file = resolveAgentWorkspaceLayout(root).databases.resources;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const damaged = Buffer.from("not a sqlite database");
    fs.writeFileSync(file, damaged);
    expect(() => allocateAgentResourceId(root)).toThrow();
    expect(fs.readFileSync(file)).toEqual(damaged);
  });
});
