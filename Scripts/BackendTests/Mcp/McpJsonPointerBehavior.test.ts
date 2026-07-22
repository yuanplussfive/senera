import { describe, expect, test } from "vitest";
import {
  parseAgentMcpJsonPointer,
  readAgentMcpJsonPointer,
  replaceAgentMcpJsonPointer,
} from "../../../Source/AgentSystem/Mcp/AgentMcpJsonPointer.js";

describe("MCP JSON Pointer", () => {
  test("uses one RFC 6901 implementation for escaped lookup and immutable replacement", () => {
    const source = { "a/b": { "c~d": ["before", "target"] } };
    const pointer = "/a~1b/c~0d/1";

    expect(parseAgentMcpJsonPointer(pointer)).toEqual(["a/b", "c~d", "1"]);
    expect(readAgentMcpJsonPointer(source, pointer)).toEqual({ found: true, value: "target" });
    expect(replaceAgentMcpJsonPointer(source, pointer, "after")).toEqual({ "a/b": { "c~d": ["before", "after"] } });
    expect(source).toEqual({ "a/b": { "c~d": ["before", "target"] } });
  });

  test("rejects malformed pointer escapes consistently", () => {
    expect(() => parseAgentMcpJsonPointer("/a~2b")).toThrow("Invalid JSON Pointer escape");
    expect(() => parseAgentMcpJsonPointer("root")).toThrow("Invalid MCP resource JSON Pointer");
  });
});
