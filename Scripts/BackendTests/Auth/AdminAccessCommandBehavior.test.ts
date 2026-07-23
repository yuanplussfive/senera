import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import {
  AdminAccessUsage,
  parseAdminAccessInvocation,
  readAdminAccessPassword,
} from "../../../Apps/AdminAccessCommand.js";

describe("administrator access command arguments", () => {
  test("parses the administrator command and named paths", () => {
    expect(
      parseAdminAccessInvocation(["--workspace", "/srv/senera", "init", "--account-file", ".private/admin.json"]),
    ).toEqual({
      command: "init",
      workspace: "/srv/senera",
      accountFile: ".private/admin.json",
      loginName: undefined,
      displayName: undefined,
      passwordStdin: false,
    });
  });

  test("parses deterministic noninteractive account input", () => {
    expect(
      parseAdminAccessInvocation([
        "init",
        "--login-name",
        "release-admin",
        "--display-name",
        "Release Administrator",
        "--password-stdin",
      ]),
    ).toEqual({
      command: "init",
      workspace: undefined,
      accountFile: undefined,
      loginName: "release-admin",
      displayName: "Release Administrator",
      passwordStdin: true,
    });
  });

  test("normalizes terminal control whitespace around the command", () => {
    expect(parseAdminAccessInvocation(["init\r"])).toEqual({
      command: "init",
      workspace: undefined,
      accountFile: undefined,
      loginName: undefined,
      displayName: undefined,
      passwordStdin: false,
    });
  });

  test("reports the received unsupported command with stable usage", () => {
    expect(() => parseAdminAccessInvocation(["init~"])).toThrow(`不支持的管理员命令："init~"。\n${AdminAccessUsage}`);
  });

  test("rejects missing, duplicate, and unknown arguments", () => {
    expect(() => parseAdminAccessInvocation([])).toThrow(AdminAccessUsage);
    expect(() => parseAdminAccessInvocation(["init", "reset-password"])).toThrow(AdminAccessUsage);
    expect(() => parseAdminAccessInvocation(["init", "--unknown", "value"])).toThrow(AdminAccessUsage);
    expect(() => parseAdminAccessInvocation(["init", "--password-stdin"])).toThrow(
      "--password-stdin 必须同时提供 --login-name 和 --display-name。",
    );
  });

  test("reads exactly one password line from standard input", async () => {
    await expect(readAdminAccessPassword(Readable.from(["a-secure-password\n"]))).resolves.toBe("a-secure-password");
    await expect(readAdminAccessPassword(Readable.from([]))).rejects.toThrow("未收到密码");
    await expect(readAdminAccessPassword(Readable.from(["first\nsecond\n"]))).rejects.toThrow("只能接收一行密码");
  });
});
