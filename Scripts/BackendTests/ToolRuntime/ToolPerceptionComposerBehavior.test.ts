import { describe, expect, test } from "vitest";
import { AgentToolPerceptionComposer } from "../../../Source/AgentSystem/ToolRuntime/AgentToolPerceptionComposer.js";
import {
  AgentToolPerceptionKinds,
  AgentToolPerceptionScopes,
  type AgentToolPerceptionDeclaration,
} from "../../../Source/AgentSystem/Types/AgentToolPerceptionTypes.js";

const composer = new AgentToolPerceptionComposer();

describe("AgentToolPerceptionComposer", () => {
  test("narrates a remote retrieved result from its object argument", () => {
    const composition = composer.compose({
      declaration: { kind: AgentToolPerceptionKinds.Retrieved, scope: AgentToolPerceptionScopes.Remote },
      result: { status: "completed", temp: 18, wind: "3 m/s" },
      arguments: { city: "苏州" },
    });

    expect(composition).toMatchObject({
      kind: AgentToolPerceptionKinds.Retrieved,
      scope: AgentToolPerceptionScopes.Remote,
      derived: false,
    });
    expect(composition.phrase).toBe("I had a look at 苏州");
    expect(composition.phrase).not.toContain("looked");
  });

  test("only grants local sensing wording when scope is explicitly local and kind is environment", () => {
    const composition = composer.compose({
      declaration: { kind: AgentToolPerceptionKinds.Environment, scope: AgentToolPerceptionScopes.Local },
      result: { temp: 18, sky: "clear" },
    });

    expect(composition.phrase).toBe("I look around—temp=18");
    expect(composition).toMatchObject({ scope: AgentToolPerceptionScopes.Local });
  });

  test("downgrades a non-environment local declaration to remote retrieved wording", () => {
    const composition = composer.compose({
      declaration: { kind: AgentToolPerceptionKinds.Retrieved, scope: AgentToolPerceptionScopes.Local },
      result: { value: "something fetched" },
    });

    expect(composition).toMatchObject({
      kind: AgentToolPerceptionKinds.Retrieved,
      scope: AgentToolPerceptionScopes.Remote,
    });
    expect(composition.phrase).toContain("had a look");
  });

  test("infers kind and remote scope from result shape when no declaration exists", () => {
    const composition = composer.compose({
      result: { status: "completed", text: "Two offers in your inbox" },
    });

    expect(composition.derived).toBe(true);
    expect(composition.scope).toBe(AgentToolPerceptionScopes.Remote);
    expect(composition.kind).toBe(AgentToolPerceptionKinds.Retrieved);
  });

  test("infers action wording when the result carries a command/action", () => {
    const composition = composer.compose({
      result: { command: "git status", status: "ok" },
    });

    expect(composition.kind).toBe(AgentToolPerceptionKinds.Action);
    expect(composition.phrase).toContain("I went ahead and");
  });

  test("fills a declared template with the digest while keeping the narration anchor", () => {
    const declaration: AgentToolPerceptionDeclaration = {
      kind: AgentToolPerceptionKinds.Retrieved,
      scope: AgentToolPerceptionScopes.Remote,
      template: "I read what's on that part of the page, it says: {digest}",
    };
    const composition = composer.compose({
      declaration,
      result: { status: "completed", summary: "The header is 'Welcome'." },
    });

    expect(composition.phrase).toBe("I read what's on that part of the page, it says: The header is 'Welcome'.");
  });

  test("falls back to the localizable object when a declared template has no digest", () => {
    const declaration: AgentToolPerceptionDeclaration = {
      kind: AgentToolPerceptionKinds.Retrieved,
      scope: AgentToolPerceptionScopes.Remote,
      template: "I looked up the weather over in {digest}.",
    };
    const composition = composer.compose({
      declaration,
      result: {},
      arguments: { city: "苏州" },
    });

    expect(composition.phrase).toBe("I looked up the weather over in 苏州.");
  });

  test("produces a stable preferred-digest line for numeric-typed environment readings", () => {
    const composition = composer.compose({
      declaration: { kind: AgentToolPerceptionKinds.Environment, scope: AgentToolPerceptionScopes.Local },
      result: { temp: 18, wind: 3, sky: "clear" },
    });

    expect(composition.phrase).toBe("I look around—temp=18");
    expect(composition).toMatchObject({ scope: AgentToolPerceptionScopes.Local });
  });

  test("never narrates an unverified result as sensing the local scene", () => {
    const composition = composer.compose({
      result: { command: "open /senera", outcome: "ok" },
    });

    expect(composition.derived).toBe(true);
    expect(composition.scope).toBe(AgentToolPerceptionScopes.Remote);
    expect(composition.kind).toBe(AgentToolPerceptionKinds.Action);
    expect(composition.phrase).not.toMatch(/look around/i);
  });
});
