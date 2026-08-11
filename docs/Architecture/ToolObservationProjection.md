# Tool Observation Projection

Tool execution produces two different outputs:

1. The artifact recorder persists the complete redacted arguments, result, process data, evidence, and workspace changes.
2. The observation context compiler creates a bounded model view with an artifact reference.

The model view is not the storage format. Truncating the view never deletes the artifact payload.

```text
ExecutedToolCallResult
  -> AgentToolExecutionArtifactRecorder (complete durable result)
  -> AgentToolObservationContextCompiler (bounded source view)
  -> Pi history (bounded view + artifact URI)
  -> AgentPiPlanningContextCompiler (protocol validation + whole-turn selection)
```

## Observation protocol

Every Senera Pi Tool observation uses one envelope. Runtime identity and status fields remain at the top level;
all optional model-visible content lives under `detail`:

```json
{
  "type": "senera.tool_observation.v3",
  "status": "success",
  "execution_status": "completed",
  "output_availability": "complete",
  "observation_view": {
    "type": "senera.tool_observation_source_view.v3",
    "complete": false,
    "omission_count": 1,
    "omissions": [{ "path": "/detail/result/log", "reason": "token_limit" }],
    "artifact_uri": "senera://artifact/example"
  },
  "detail": {
    "summary": "Completed with a bounded result.",
    "result": {}
  }
}
```

The Pi `toolResult` message owns `toolCallId` and `toolName`; the turn state owns the batch relation. Those identities
are not duplicated inside the JSON envelope. The execution bridge, including `AskUser`, always creates this envelope
through `AgentToolObservationContextCompiler`. Producers must not place `summary`, `result`, `process`, evidence, or
continuation data at the top level.

`observation_view.complete` describes whether the source compiler retained the complete artifact-derived input.
When it is false, `omissions` records bounded omissions and `artifact_uri` provides the recovery boundary when an
Artifact was published. There is no second context-view envelope.

Any tool result that is not a valid `senera.tool_observation.v3` with a v3 source-view marker is rejected before
planning. The runtime does not infer a projection from payload fields and does not reinterpret legacy envelopes.

## System Tool contract

Every bundled Host Tool contract declares a package-relative projection file:

```json
{
  "name": "ExampleTool",
  "observationProjection": "observations/default.projection.json"
}
```

The projection file is declarative. It can select only protocol-defined sources, an optional RFC 6901 pointer, a projection mode, a priority tier, a completion requirement, a per-source token limit, and explicit structural limits. It cannot execute code, evaluate expressions, or infer semantics from payload field names.

```json
{
  "$schema": "https://schemas.senera.ai/tool-observation-projection/v2.json",
  "schemaVersion": 2,
  "maxTokens": 2048,
  "maxOmissions": 16,
  "artifactFallback": {
    "strategy": "reference",
    "requiredWhenTruncated": true
  },
  "sources": [
    {
      "source": "summary",
      "mode": "text",
      "priority": "essential",
      "requiredForCompletion": true,
      "maxTokens": 512,
      "limits": {
        "maxDepth": 1,
        "maxArrayItems": 0,
        "maxObjectProperties": 0,
        "maxNodes": 2
      }
    },
    {
      "source": "result",
      "mode": "json",
      "priority": "normal",
      "requiredForCompletion": true,
      "maxTokens": 1024,
      "limits": {
        "maxDepth": 8,
        "maxArrayItems": 32,
        "maxObjectProperties": 48,
        "maxNodes": 384
      }
    }
  ]
}
```

Sources are resolved by the execution protocol: `headline`, `summary`, `error`, `process`, `retrieval`, `continuation`, `evidence`, `delta`, `workspace`, `result`, `arguments`, `projection`, `summaryFacts`, `limitations`, and `outcome`. Source order within a priority tier is stable. `requiredForCompletion` is the package-owned semantic declaration for whether omission of that source makes the main observation incomplete. `artifactOnly` records an explicit omission and never places that source in model context.

The runtime always owns the tool name, call ID, batch ID, assessment status, execution status, output availability, artifact URI, and canonical failure envelope. A package cannot remove or redefine these fields.

Projection content participates in the registered Tool digest and extension directory revision. A projection update therefore invalidates stale Pi contracts and runtime snapshots.

Bundled Host Tool input is ordinary JSON Schema. Arrays are JSON arrays, for example
`{"artifactUris":["senera://artifact/art_..."],"refs":["raw"]}`. The `{ "item": [...] }` shape belongs only to
the BAML JSON-to-XML prompt projection and is never accepted as runtime JSON input. For code-defined bundled tools,
the runtime Zod schema is authoritative; the contract generator discovers its extension contribution by exact
capability and replaces only `inputSchema`. Missing or duplicate capability declarations fail generation, so runtime
validation and the schema shown to native/BAML providers cannot drift silently.

## Budget behavior

Structural limits protect depth, array width, object width, and node count. They do not impose a second character or byte cut. Text leaves are projected independently against the declared token budget; oversized inputs are bounded before exact BPE work and every returned candidate is measured exactly.

The JSON projector returns the projected value directly. It does not add a second diagnostic envelope or a legacy sentinel. Omission metadata stays with the owning observation view. Long leaves are reduced first while short control values such as continuation handles retain their exact content; only then are overflowing container prefixes removed. Every partial view remains valid JSON and reports why data was omitted.

The observation compiler allocates the fixed protocol envelope and `detail` together with a binary search over the exact model token count. `prepare()` performs parsing, inspection, allocation, and projection once. Concurrent calls receive explicit reservations from the turn token budget before execution, so they do not race for an implicit batch-wide fallback after completion. Every terminal outcome settles its reservation, including Pi validation, unknown-tool, permission, and preflight failures that never enter the execution bridge. These Pi-owned failures are compiled into the same bounded v3 envelope before entering history. Token cost is represented as `exact` or `overBudget`; an unbounded Senera observation is rejected before token measurement instead of being inferred or silently repaired.

The planning context compiler never reprojects an accepted observation. It selects the largest recent suffix made of complete user turns and derives the tool transcript from exactly those retained messages. The current turn must fit as a whole; otherwise planning fails explicitly instead of dropping a tool result or hiding a protocol error.

## MCP and Skills

MCP does not use Senera projection files. The MCP Server owns `inputSchema`, `outputSchema`, standard `content`, and `structuredContent`. Senera prefers validated `structuredContent`, otherwise uses bounded text content, records the complete call as an artifact, and applies the standard runtime projection.

Skills do not produce Tool observations and declare no projection contract.
