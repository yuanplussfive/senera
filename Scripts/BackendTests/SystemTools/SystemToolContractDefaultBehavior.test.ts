import { describe, expect, test } from "vitest";
import { loadSystemToolContractByName, materializeSystemToolArguments } from "./SystemToolContractTestSupport.js";

describe("package-owned System Tool defaults", () => {
  test("materializes defaults declared through conditional branches", () => {
    const gitInspect = loadSystemToolContractByName("GitInspect");
    const gitMutate = loadSystemToolContractByName("GitMutate");
    const restore = loadSystemToolContractByName("WorkspaceRestoreCheckpoint");
    const scheduler = loadSystemToolContractByName("schedule_create");

    expect(materializeSystemToolArguments(gitInspect, { operation: "diff", repository: "." })).toMatchObject({
      ok: true,
      value: { scope: "working", paths: [] },
    });
    expect(
      materializeSystemToolArguments(gitMutate, {
        operation: "create_branch",
        repository: ".",
        branch: "feature/contract-defaults",
      }),
    ).toMatchObject({ ok: true, value: { startPoint: "HEAD" } });
    expect(materializeSystemToolArguments(restore, { artifactUri: "artifact://checkpoint" })).toMatchObject({
      ok: true,
      value: { target: "after" },
    });
    expect(
      materializeSystemToolArguments(scheduler, {
        prompt: "Review the open pull request.",
        at: "+1h",
      }),
    ).toMatchObject({ ok: true, value: { target: "this_session" } });
  });
});
