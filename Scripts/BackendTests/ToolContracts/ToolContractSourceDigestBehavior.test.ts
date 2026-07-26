import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { digestToolContractSource } from "../../../Build/ToolContracts/AgentTypescriptToolContractProjector.js";

describe("tool contract source digest", () => {
  test("produces the same digest for LF, CRLF, and CR line endings", () => {
    const lf = "export interface Arguments {\n  query: string;\n}\n";
    const expected = createHash("sha256").update(lf).digest("hex");

    expect(digestToolContractSource(lf)).toBe(expected);
    expect(digestToolContractSource(lf.replace(/\n/g, "\r\n"))).toBe(expected);
    expect(digestToolContractSource(lf.replace(/\n/g, "\r"))).toBe(expected);
  });
});
