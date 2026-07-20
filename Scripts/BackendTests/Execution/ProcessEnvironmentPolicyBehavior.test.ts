import { describe, expect, it } from "vitest";
import { SeneraNodeProcessBackend } from "../../../Source/AgentSystem/Execution/SeneraNodeProcessBackend.js";
import { SeneraProcessEnvironmentPolicy } from "../../../Source/AgentSystem/Execution/SeneraProcessEnvironment.js";
import { AgentDefaults } from "../../../Source/AgentSystem/Defaults/AgentDefaultValues.js";

describe("process environment policy", () => {
  it("applies whitelist and exclusions before fixed values", () => {
    const policy = new SeneraProcessEnvironmentPolicy({
      Inherit: "all",
      IncludeOnly: ["PATH", "OVERRIDE", "REMOVED"],
      Exclude: ["REMOVED"],
      Set: { OVERRIDE: "fixed", ADDED: "explicit" },
    });

    expect(
      policy.project(
        { PATH: "base", SECRET: "hidden", REMOVED: "base" },
        { PATH: "request", OVERRIDE: "request", REMOVED: "request" },
      ),
    ).toEqual({ PATH: "request", OVERRIDE: "fixed", ADDED: "explicit" });
  });

  it("uses the same policy for real local command execution", async () => {
    const backend = new SeneraNodeProcessBackend({
      environmentPolicy: {
        Inherit: "none",
        IncludeOnly: ["SENERA_ALLOWED"],
        Exclude: ["SENERA_REJECTED"],
        Set: { SENERA_FIXED: "fixed" },
      },
    });
    const result = await backend.executeProcess({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(JSON.stringify({allowed:process.env.SENERA_ALLOWED,fixed:process.env.SENERA_FIXED,rejected:process.env.SENERA_REJECTED}))",
      ],
      cwd: process.cwd(),
      env: { SENERA_ALLOWED: "request", SENERA_REJECTED: "hidden" },
      timeoutMs: 5_000,
      limits: { timeoutMs: 5_000, maxStdoutBytes: 4_096, maxStderrBytes: 4_096 },
      profile: { name: "environment-test", kind: "shell", backend: "local" },
    });

    expect(JSON.parse(result.stdout)).toEqual({ allowed: "request", fixed: "fixed" });
  });

  it("does not inherit host credentials under the default execution policy", () => {
    const policy = new SeneraProcessEnvironmentPolicy(AgentDefaults.ToolExecution.Environment);

    expect(
      policy.project(
        { PATH: "runtime-path", OPENAI_API_KEY: "host-secret", CUSTOM_SECRET: "host-secret" },
        { TAVILY_API_KEY: "plugin-declared" },
      ),
    ).toEqual({ PATH: "runtime-path", TAVILY_API_KEY: "plugin-declared" });
  });

  it("uses the restricted allowlist when constructed without options", () => {
    const policy = new SeneraProcessEnvironmentPolicy();

    expect(policy.project({ PATH: "runtime-path", OPENAI_API_KEY: "host-secret" })).toEqual({
      PATH: "runtime-path",
    });
  });
});
