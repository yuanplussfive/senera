import { describe, expect, test } from "vitest";
import { AgentLruCache } from "../../../Source/AgentSystem/Core/AgentLruCache.js";

describe("LRU cache behavior", () => {
  test("evicts the least recently used entry", () => {
    const cache = new AgentLruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);

    cache.set("c", 3);

    expect([...cache.keys()]).toEqual(["a", "c"]);
    expect(cache.has("b")).toBe(false);
  });

  test("supports catalog retention and capacity changes", () => {
    const cache = new AgentLruCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    cache.retain(new Set(["b", "c"]));
    cache.resize(1);

    expect([...cache.entries()]).toEqual([["c", 3]]);
  });
});
