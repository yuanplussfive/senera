import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DockerAdminAccountEnvironment, synchronizeDockerAdminAccount } from "../../../Apps/DockerAdminAccountSync.js";
import { AgentLocalAdminAccountStore } from "../../../Source/AgentSystem/Auth/AgentLocalAdminAccount.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Docker administrator account synchronization", () => {
  test("creates the declared account without persisting its plaintext password", async () => {
    const accountFile = await createAccountFilePath();
    const password = "a long docker administrator password";

    const result = await synchronizeDockerAdminAccount({
      accountFile,
      environment: createEnvironment({ password }),
    });

    expect(result).toMatchObject({ kind: "created", account: { loginName: "owner", displayName: "Owner" } });
    await expect(new AgentLocalAdminAccountStore(accountFile).verify("owner", password)).resolves.toMatchObject({
      loginName: "owner",
    });
    await expect(readFile(accountFile, "utf8")).resolves.not.toContain(password);
  });

  test("requires every Compose account value on every container start", async () => {
    const accountFile = await createAccountFilePath();
    await new AgentLocalAdminAccountStore(accountFile).initialize({
      loginName: "owner",
      displayName: "Owner",
      password: "a long original administrator password",
    });

    await expect(synchronizeDockerAdminAccount({ accountFile, environment: {} })).rejects.toThrow(
      DockerAdminAccountEnvironment.LoginName,
    );
  });

  test("applies changed login, display name, and password from Compose", async () => {
    const accountFile = await createAccountFilePath();
    const originalPassword = "a long original administrator password";
    const nextPassword = "a different long administrator password";
    await synchronizeDockerAdminAccount({
      accountFile,
      environment: createEnvironment({ password: originalPassword }),
    });

    const result = await synchronizeDockerAdminAccount({
      accountFile,
      environment: createEnvironment({ loginName: "other", displayName: "Other", password: nextPassword }),
    });

    const store = new AgentLocalAdminAccountStore(accountFile);
    expect(result).toMatchObject({ kind: "updated", account: { loginName: "other", displayName: "Other" } });
    await expect(store.verify("other", nextPassword)).resolves.toMatchObject({ loginName: "other" });
    await expect(store.verify("owner", originalPassword)).resolves.toBeUndefined();
  });

  test("does not rewrite the account when the Compose declaration is unchanged", async () => {
    const accountFile = await createAccountFilePath();
    const environment = createEnvironment({ password: "a stable long administrator password" });
    await synchronizeDockerAdminAccount({ accountFile, environment });
    const before = await readFile(accountFile, "utf8");

    const result = await synchronizeDockerAdminAccount({ accountFile, environment });

    expect(result.kind).toBe("unchanged");
    await expect(readFile(accountFile, "utf8")).resolves.toBe(before);
  });
});

async function createAccountFilePath(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "senera-docker-admin-account-"));
  temporaryRoots.push(root);
  return path.join(root, "access", "admin-account.json");
}

function createEnvironment(input: { loginName?: string; displayName?: string; password: string }): NodeJS.ProcessEnv {
  return {
    [DockerAdminAccountEnvironment.LoginName]: input.loginName ?? "owner",
    [DockerAdminAccountEnvironment.DisplayName]: input.displayName ?? "Owner",
    [DockerAdminAccountEnvironment.Password]: input.password,
  };
}
