# Adding Tools

Choose the authoring boundary by ownership:

| Capability                                   | Boundary         |
| -------------------------------------------- | ---------------- |
| Senera host control or runtime service       | System extension |
| Independently executable external capability | MCP package      |
| Trigger guidance, scripts and references     | Skill            |

## MCP package

Use a portable MCP descriptor. Prefer MCPB `manifest.json` for a distributable local server and MCP Registry `server.json` for Registry packages or Streamable HTTP. Do not wrap a pure MCP package in Senera `extension.json`.

```text
McpServers/example/
  manifest.json
  mcp/server.mjs
```

```json
{
  "manifest_version": "0.3",
  "name": "example",
  "version": "1.0.0",
  "description": "Example MCP server.",
  "server": {
    "type": "node",
    "entry_point": "mcp/server.mjs",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/mcp/server.mjs"],
      "env": {
        "API_KEY": "${user_config.API_KEY}",
        "REGION": "${user_config.REGION}"
      }
    }
  },
  "user_config": {
    "API_KEY": { "type": "string", "title": "API key", "sensitive": true, "required": true },
    "REGION": { "type": "string", "title": "Region", "enum": ["cn", "us"], "default": "cn" }
  }
}
```

The MCP server owns tool schemas through `tools/list`. Use `@modelcontextprotocol/sdk`, forward cancellation signals to I/O, and return standard `content` plus optional `structuredContent`. Do not add generic timeout fields, a custom stdout protocol, plaintext Secrets, a package `.env`, a Senera tool schema, or a Senera observation projection file.

## System extension

Create `System/Extensions/<id>/extension.json`, one contract per `hostTool` contribution, and at least one package-local observation projection. The manifest owns package metadata and references a capability already registered by Senera. Contracts own tool input/output, execution, runtime, resource, search and artifact policies.

```text
System/Extensions/example/
  extension.json
  tools/ExampleTool.tool.json
  observations/default.projection.json
```

The Tool contract references `observationProjection`. Declare protocol sources and explicit structural limits in that file; do not select payload fields by name in runtime code. Use RFC 6901 `pointer` only when a Tool intentionally projects one subvalue. The runtime centrally preserves identity, status, artifact URI, and the canonical failure envelope. See [Tool Observation Projection](../Architecture/ToolObservationProjection.md).

Host implementation code stays under `Source/AgentSystem/SystemTools` or another host-owned module and is registered in code. A package cannot name a module to import. For a Zod-defined tool, run:

```bash
npm run generate.system-extension-contracts
npm run verify.system-extension-contracts
```

Every System Tool runtime contract declares `Lifecycle`, `ProtocolVersion`, `ResultAssessment`, and `Scheduling`. Use `Parallel` for independent calls, `ResourceClaims` with explicit RFC 6901 resource declarations for data conflicts, and `SelfManaged` only when the host implementation owns scheduling. `Runtime.MaxConcurrency` may place a stricter tool-wide limit on `Parallel` or `ResourceClaims`; omit it to inherit the run limit. `ProcessExit` interprets nonzero process exits as failure; `Unassessed` preserves exit data for the model. These policies are fixed by the contract and are never model-controlled.

An empty `resources` array does not request a global lock. Resource declarations and scheduling mode must agree, and invalid claim projection fails explicitly. The default run capacity comes from `ToolExecution.MaxConcurrentCallsPerRun` and is 10 unless deployment configuration overrides it.

## Skill

Use `System/Skills` for bundled guidance and `.senera/skills` for workspace guidance. A Skill may recommend exact registered tools through `metadata.senera.recommended-tools`; it cannot register a tool or grant permission.
