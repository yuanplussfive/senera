import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveServerConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import {
  AgentLocalAdminAccountStore,
  normalizeDisplayName,
  normalizeLoginName,
  validateAdminPassword,
} from "../../../Source/AgentSystem/Auth/AgentLocalAdminAccount.js";
import { AgentAdminSessionStore } from "../../../Source/AgentSystem/Auth/AgentAdminSessionStore.js";
import { AgentTokenBucket } from "../../../Source/AgentSystem/Auth/AgentTokenBucket.js";
import { AgentServerAccessGuard } from "../../../Source/AgentSystem/Auth/AgentServerAccessGuard.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("local administrator account", () => {
  test("normalizes login names without changing their stable semantics", () => {
    expect(normalizeLoginName("  Senera.Owner  ")).toBe("senera.owner");
  });

  test("rejects login names that can be confused or are too short", () => {
    expect(() => normalizeLoginName("ab")).toThrow();
    expect(() => normalizeLoginName("owner name")).toThrow();
    expect(() => normalizeLoginName("管理员")).toThrow();
  });

  test("keeps display names independent from ASCII login names", () => {
    expect(normalizeDisplayName("  王小明  ")).toBe("王小明");
  });

  test("requires a long administrator password", () => {
    expect(() => validateAdminPassword("short-password")).toThrow();
    expect(() => validateAdminPassword("a".repeat(15))).not.toThrow();
  });

  test("stores only a password hash and verifies the original credentials", async () => {
    const store = createAccountStore();
    const password = "a long administrator password";
    const account = await store.initialize({
      loginName: "Senera.Owner",
      displayName: "Senera Owner",
      password,
    });

    expect(account.loginName).toBe("senera.owner");
    expect(readFileSync(store.filePath, "utf8")).not.toContain(password);
    await expect(store.verify("senera.owner", password)).resolves.toMatchObject({ id: account.id });
    await expect(store.verify("senera.owner", "wrong password value")).resolves.toBeUndefined();
  });

  test("does not allow initialization to overwrite an existing account", async () => {
    const store = createAccountStore();
    await store.initialize({ loginName: "owner", displayName: "Owner", password: "a long administrator password" });
    await expect(
      store.initialize({ loginName: "other", displayName: "Other", password: "another long administrator password" }),
    ).rejects.toThrow();
  });

  test("requires the stable login name when resetting a password", async () => {
    const store = createAccountStore();
    await store.initialize({ loginName: "owner", displayName: "Owner", password: "a long administrator password" });
    await expect(
      store.resetPassword({
        loginName: "other",
        displayName: "Other",
        password: "another long administrator password",
      }),
    ).rejects.toThrow();
  });
});

describe("administrator sessions", () => {
  const account = {
    id: "account_01",
    loginName: "owner",
    displayName: "Owner",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  test("uses opaque unguessable tokens and never returns their digest", () => {
    const store = createSessionStore();
    const issued = store.issue(account);
    expect(issued.token.length).toBeGreaterThanOrEqual(40);
    expect(issued.session).not.toHaveProperty("digest");
  });

  test("expires sessions at the configured idle deadline", () => {
    let now = 0;
    const store = createSessionStore(() => now);
    const issued = store.issue(account);
    now = 1_001;
    expect(store.read(issued.token)).toBeUndefined();
  });

  test("extends idle activity without exceeding the absolute deadline", () => {
    let now = 0;
    const store = new AgentAdminSessionStore({
      absoluteTtlMs: 2_000,
      idleTtlMs: 1_000,
      maxSessions: 2,
      now: () => now,
    });
    const issued = store.issue(account);
    now = 900;
    expect(store.read(issued.token, true)?.idleExpiresAt).toBe(1_900);
    now = 2_000;
    expect(store.read(issued.token)).toBeUndefined();
  });

  test("binds CSRF values to the issued session", () => {
    const store = createSessionStore();
    const issued = store.issue(account);
    expect(store.verifyCsrf(issued.session, issued.session.csrfToken)).toBe(true);
    expect(store.verifyCsrf(issued.session, "other-token")).toBe(false);
  });

  test("revokes a session by its client token", () => {
    const store = createSessionStore();
    const issued = store.issue(account);
    store.revoke(issued.token);
    expect(store.read(issued.token)).toBeUndefined();
  });
});

describe("bounded rate limiting", () => {
  test("refills a token bucket over its configured period", () => {
    let now = 0;
    const bucket = new AgentTokenBucket({ capacity: 2, refillPeriodMs: 1_000, maxEntries: 2, now: () => now });
    expect(bucket.consume("client").allowed).toBe(true);
    expect(bucket.consume("client").allowed).toBe(true);
    expect(bucket.consume("client").allowed).toBe(false);
    now = 500;
    expect(bucket.consume("client").allowed).toBe(true);
  });

  test("evicts the least recently seen key when tracking is bounded", () => {
    const bucket = new AgentTokenBucket({ capacity: 1, refillPeriodMs: 1_000, maxEntries: 1, now: () => 0 });
    bucket.consume("first");
    expect(bucket.consume("second").allowed).toBe(true);
  });
});

describe("server access guard", () => {
  test("fails closed when a remote server has no Origin allowlist", () => {
    const root = createTemporaryRoot();
    expect(
      () =>
        new AgentServerAccessGuard({
          workspaceRoot: root,
          server: resolveServerConfig({
            ...minimalConfig(),
            Server: {
              Host: "0.0.0.0",
              AccessControl: {
                Mode: "required",
                AccountFile: "admin-account.json",
              },
            },
          }),
        }),
    ).toThrow(/AllowedOrigins/);
  });

  test("fails closed when remote access control is explicitly disabled", () => {
    const root = createTemporaryRoot();
    expect(
      () =>
        new AgentServerAccessGuard({
          workspaceRoot: root,
          server: resolveServerConfig({
            ...minimalConfig(),
            Server: {
              Host: "0.0.0.0",
              AccessControl: { Mode: "disabled" },
            },
          }),
        }),
    ).toThrow(/公网监听/);
  });

  test("requires a valid local administrator session for protected HTTP requests", async () => {
    const { guard, store } = await createRequiredGuard();
    const login = await guard.login(request({ origin: "http://app.test" }), {
      loginName: "owner",
      password: "a long administrator password",
    });
    expect(login.ok).toBe(true);
    if (!login.ok) return;

    const missing = guard.authorizeHttp(request({ origin: "http://app.test" }), { requireCsrf: false });
    expect(missing.ok).toBe(false);

    const accepted = guard.authorizeHttp(
      request({ origin: "http://app.test", cookie: `senera_local_session=${login.token}` }),
      { requireCsrf: false },
    );
    expect(accepted).toMatchObject({ ok: true, access: { principal: { id: store.require().id } } });
  });

  test("requires the same origin and session-bound CSRF value for mutations", async () => {
    const { guard } = await createRequiredGuard();
    const login = await guard.login(request({ origin: "http://app.test" }), {
      loginName: "owner",
      password: "a long administrator password",
    });
    if (!login.ok) throw new Error("Expected administrator login to succeed.");
    const headers = { origin: "http://app.test", cookie: `senera_local_session=${login.token}` };

    expect(guard.authorizeHttp(request(headers), { requireCsrf: true })).toMatchObject({
      ok: false,
      failure: { code: "csrf_required" },
    });
    expect(
      guard.authorizeHttp(request({ ...headers, "x-senera-csrf": login.session.csrfToken }), { requireCsrf: true }),
    ).toMatchObject({ ok: true });
  });

  test("rejects WebSocket upgrades from an untrusted browser origin", async () => {
    const { guard } = await createRequiredGuard();
    const login = await guard.login(request({ origin: "http://app.test" }), {
      loginName: "owner",
      password: "a long administrator password",
    });
    if (!login.ok) throw new Error("Expected administrator login to succeed.");
    expect(
      guard.authorizeWebSocket(
        request({ origin: "https://attacker.example", cookie: `senera_local_session=${login.token}` }),
      ),
    ).toMatchObject({ ok: false, failure: { code: "forbidden_origin" } });
  });

  test("binds WebSocket messages to a live administrator session", async () => {
    const { guard, store } = await createRequiredGuard();
    const login = await guard.login(request({ origin: "http://app.test" }), {
      loginName: "owner",
      password: "a long administrator password",
    });
    if (!login.ok) throw new Error("Expected administrator login to succeed.");
    const upgrade = guard.authorizeWebSocket(
      request({ origin: "http://app.test", cookie: `senera_local_session=${login.token}` }),
    );
    if (!upgrade.ok) throw new Error("Expected WebSocket authorization to succeed.");

    const socket = {} as never;
    guard.registerConnection(socket, upgrade.access);
    expect(guard.authorizeMessage(socket)).toMatchObject({
      ok: true,
      access: { principal: { id: store.require().id } },
    });
    guard.unregisterConnection(socket);
  });
});

function createAccountStore(): AgentLocalAdminAccountStore {
  const root = createTemporaryRoot();
  return new AgentLocalAdminAccountStore(path.join(root, "admin-account.json"));
}

function createSessionStore(now: () => number = () => 0): AgentAdminSessionStore {
  return new AgentAdminSessionStore({
    absoluteTtlMs: 10_000,
    idleTtlMs: 1_000,
    maxSessions: 2,
    now,
  });
}

async function createRequiredGuard(): Promise<{
  guard: AgentServerAccessGuard;
  store: AgentLocalAdminAccountStore;
}> {
  const root = createTemporaryRoot();
  const store = new AgentLocalAdminAccountStore(path.join(root, "admin-account.json"));
  await store.initialize({
    loginName: "owner",
    displayName: "Owner",
    password: "a long administrator password",
  });
  const guard = new AgentServerAccessGuard({
    workspaceRoot: root,
    server: resolveServerConfig({
      ...minimalConfig(),
      Server: {
        Host: "127.0.0.1",
        AccessControl: {
          Mode: "required",
          AccountFile: "admin-account.json",
          AllowedOrigins: ["http://app.test"],
          Limits: {
            LoginAttemptsPerMinute: 20,
          },
        },
      },
    }),
  });
  return { guard, store };
}

function request(headers: Record<string, string> = {}): import("node:http").IncomingMessage {
  return {
    headers,
    socket: {
      remoteAddress: "127.0.0.1",
    },
  } as import("node:http").IncomingMessage;
}

function minimalConfig(): AgentSystemConfig {
  return { ModelProviders: [] };
}

function createTemporaryRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "senera-auth-"));
  temporaryRoots.push(root);
  return root;
}
