import { expect, test } from "vitest";

const { readMessageActionIntents } = await import("../../../Frontend/src/features/chat/MessageActions.tsx");

test("message actions expose fork only for stable mutable request boundaries", () => {
  expect(readMessageActionIntents({ hasRequestId: false, hasWorkflow: false })).toEqual(["copy"]);
  expect(readMessageActionIntents({ hasRequestId: true, hasWorkflow: false })).toEqual([
    "copy",
    "fork",
    "regenerate",
    "delete",
  ]);
  expect(readMessageActionIntents({ hasRequestId: true, hasWorkflow: true, allowMutation: false })).toEqual([
    "copy",
    "viewWorkflow",
  ]);
});
