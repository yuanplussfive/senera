import { describe, expect, test } from "vitest";
import {
  AgentPlannerTimelinePayloadKeys,
  encodePlannerTimelinePayload,
  decodePlannerTimelinePayload,
} from "../../../Source/AgentSystem/ActionPlanner/AgentPlannerTimelinePayload.js";

describe("AgentPlannerTimelinePayload", () => {
  describe("AgentPlannerTimelinePayloadKeys", () => {
    test("Message key is 'message'", () => {
      expect(AgentPlannerTimelinePayloadKeys.Message).toBe("message");
    });

    test("UserMessage key is 'userMessage'", () => {
      expect(AgentPlannerTimelinePayloadKeys.UserMessage).toBe("userMessage");
    });

    test("Calls key is 'calls'", () => {
      expect(AgentPlannerTimelinePayloadKeys.Calls).toBe("calls");
    });

    test("Observations key is 'observations'", () => {
      expect(AgentPlannerTimelinePayloadKeys.Observations).toBe("observations");
    });

    test("XmlRoot key is 'xmlRoot'", () => {
      expect(AgentPlannerTimelinePayloadKeys.XmlRoot).toBe("xmlRoot");
    });

    test("Value key is 'value'", () => {
      expect(AgentPlannerTimelinePayloadKeys.Value).toBe("value");
    });
  });

  describe("encodePlannerTimelinePayload", () => {
    test("encodes a simple object as JSON", () => {
      expect(encodePlannerTimelinePayload({ a: 1 })).toBe('{"a":1}');
    });

    test("encodes a string", () => {
      expect(encodePlannerTimelinePayload("hello")).toBe('"hello"');
    });

    test("encodes an array", () => {
      expect(encodePlannerTimelinePayload([1, 2, 3])).toBe("[1,2,3]");
    });

    test("encodes null", () => {
      expect(encodePlannerTimelinePayload(null)).toBe("null");
    });

    test("round-trips with decodePlannerTimelinePayload", () => {
      const original = { calls: [{ name: "search", arguments: '{"q":"test"}' }] };
      const encoded = encodePlannerTimelinePayload(original);
      const decoded = decodePlannerTimelinePayload(encoded);
      expect(decoded).toEqual(original);
    });

    test("throws when value contains a circular reference", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(() => encodePlannerTimelinePayload(circular)).toThrow();
    });
  });

  describe("decodePlannerTimelinePayload", () => {
    test("returns undefined for undefined input", () => {
      expect(decodePlannerTimelinePayload(undefined)).toBeUndefined();
    });

    test("returns undefined for empty string", () => {
      expect(decodePlannerTimelinePayload("")).toBeUndefined();
    });

    test("decodes a valid JSON object", () => {
      expect(decodePlannerTimelinePayload('{"a":1}')).toEqual({ a: 1 });
    });

    test("decodes a valid JSON array", () => {
      expect(decodePlannerTimelinePayload("[1,2,3]")).toEqual([1, 2, 3]);
    });

    test("decodes a JSON string", () => {
      expect(decodePlannerTimelinePayload('"hello"')).toBe("hello");
    });

    test("decodes null", () => {
      expect(decodePlannerTimelinePayload("null")).toBeNull();
    });

    test("decodes a number", () => {
      expect(decodePlannerTimelinePayload("42")).toBe(42);
    });

    test("throws with context message for invalid JSON", () => {
      expect(() => decodePlannerTimelinePayload("{invalid}")).toThrow(/Planner timeline payload is not valid JSON/);
    });

    test("includes original parse error message in thrown error", () => {
      expect(() => decodePlannerTimelinePayload("not json")).toThrow(/not valid JSON/);
    });
  });

  describe("encode / decode round-trip", () => {
    test("preserves nested objects", () => {
      const original = {
        calls: [
          { name: "search", arguments: '{"q":"test"}', callId: "call_1" },
          { name: "read", arguments: '{"path":"/a"}', callId: "call_2" },
        ],
        observations: [{ callId: "call_1", response: { ok: true } }],
      };
      const encoded = encodePlannerTimelinePayload(original);
      const decoded = decodePlannerTimelinePayload(encoded);
      expect(decoded).toEqual(original);
    });

    test("preserves unicode strings", () => {
      const original = { message: "你好世界 🌍" };
      const encoded = encodePlannerTimelinePayload(original);
      const decoded = decodePlannerTimelinePayload(encoded);
      expect(decoded).toEqual(original);
    });
  });
});
