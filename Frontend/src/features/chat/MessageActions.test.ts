import { describe, expect, it } from "vitest";
import { readMessageActionIntents } from "./MessageActions";

describe("readMessageActionIntents", () => {
  it("keeps copy as the only action for messages without a request id", () => {
    expect(readMessageActionIntents({ hasRequestId: false, hasWorkflow: true })).toEqual(["copy"]);
  });

  it("shows mutation actions for request-backed messages without a workflow run", () => {
    expect(readMessageActionIntents({ hasRequestId: true, hasWorkflow: false })).toEqual([
      "copy",
      "regenerate",
      "delete",
    ]);
  });

  it("shows workflow navigation before mutation actions when a run exists", () => {
    expect(readMessageActionIntents({ hasRequestId: true, hasWorkflow: true })).toEqual([
      "copy",
      "viewWorkflow",
      "regenerate",
      "delete",
    ]);
  });
});
