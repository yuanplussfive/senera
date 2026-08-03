import { describe, expect, test } from "vitest";
import {
  AgentMcpCredentialsRequiredError,
  listAgentMcpEnvironmentReferences,
  parseAgentMcpEnvironmentTemplate,
  resolveAgentMcpEnvironmentRecord,
  type AgentMcpCredentialResolver,
} from "../../../Source/AgentSystem/McpPackages/AgentMcpEnvironmentTemplate.js";

const credentials: AgentMcpCredentialResolver = {
  resolve(serverId, name) {
    return serverId === "research" && name === "TOKEN" ? { value: "secret", source: "vault" } : undefined;
  },
};

describe("MCP environment templates", () => {
  test("resolves server-scoped credentials and non-secret defaults", () => {
    expect(
      resolveAgentMcpEnvironmentRecord(
        "research",
        {
          AUTHORIZATION: "Bearer ${TOKEN}",
          ENDPOINT: "${BASE_URL:-https://api.example.test}",
        },
        credentials,
      ),
    ).toEqual({
      AUTHORIZATION: "Bearer secret",
      ENDPOINT: "https://api.example.test",
    });
  });

  test("reports every unresolved required credential without returning a partial record", () => {
    expect(() =>
      resolveAgentMcpEnvironmentRecord("research", { FIRST: "${FIRST}", SECOND: "prefix-${SECOND}" }, credentials),
    ).toThrowError(
      expect.objectContaining<Partial<AgentMcpCredentialsRequiredError>>({
        code: "mcp_credentials_required",
        serverId: "research",
        names: ["FIRST", "SECOND"],
      }),
    );
  });

  test("parses references once and preserves required-over-default semantics", () => {
    expect(parseAgentMcpEnvironmentTemplate("Bearer ${TOKEN}")).toEqual([
      { kind: "literal", value: "Bearer " },
      { kind: "reference", name: "TOKEN" },
    ]);
    expect(listAgentMcpEnvironmentReferences({ first: "${TOKEN:-fallback}", second: "${TOKEN}" })).toEqual([
      { name: "TOKEN" },
    ]);
  });

  test("rejects malformed references at their source boundary", () => {
    expect(() => parseAgentMcpEnvironmentTemplate("${NOT-VALID}")).toThrow(/reference name is invalid/u);
    expect(() => parseAgentMcpEnvironmentTemplate("${UNCLOSED")).toThrow(/closing brace/u);
  });
});
