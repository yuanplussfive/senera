import { describe, expect, test } from "vitest";
import { AdminAccessUsage, parseAdminAccessInvocation } from "../../../Apps/AdminAccessCommand.js";

describe("administrator access command arguments", () => {
  test("parses the administrator command and named paths", () => {
    expect(
      parseAdminAccessInvocation(["--workspace", "/srv/senera", "init", "--account-file", ".private/admin.json"]),
    ).toEqual({
      command: "init",
      workspace: "/srv/senera",
      accountFile: ".private/admin.json",
    });
  });

  test("normalizes terminal control whitespace around the command", () => {
    expect(parseAdminAccessInvocation(["init\r"])).toEqual({
      command: "init",
      workspace: undefined,
      accountFile: undefined,
    });
  });

  test("reports the received unsupported command with stable usage", () => {
    expect(() => parseAdminAccessInvocation(["init~"])).toThrow(`不支持的管理员命令："init~"。\n${AdminAccessUsage}`);
  });

  test("rejects missing, duplicate, and unknown arguments", () => {
    expect(() => parseAdminAccessInvocation([])).toThrow(AdminAccessUsage);
    expect(() => parseAdminAccessInvocation(["init", "reset-password"])).toThrow(AdminAccessUsage);
    expect(() => parseAdminAccessInvocation(["init", "--unknown", "value"])).toThrow(AdminAccessUsage);
  });
});
