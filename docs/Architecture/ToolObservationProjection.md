# Tool Observation Projection

Tool execution produces two different outputs:

1. The artifact recorder persists the complete redacted arguments, result, process data, evidence, and workspace changes.
2. The observation context compiler creates a bounded model view with an artifact reference.

The model view is not the storage format. Truncating the view never deletes the artifact payload.

```text
ExecutedToolCallResult
  -> AgentToolExecutionArtifactRecorder (complete durable result)
  -> AgentToolObservationContextCompiler (bounded source view)
  -> AgentPiToolObservationBatchProjector (turn-level allocation)
  -> Pi history (bounded view + artifact URI)
```

## Observation protocol

Every Senera Pi Tool observation uses one envelope. Runtime identity and status fields remain at the top level;
all optional model-visible content lives under `detail`:

```json
{
  "type": "senera.tool_observation.v1",
  "tool_name": "ExampleTool",
  "call_id": "call-1",
  "batch_id": "request-1:1",
  "status": "success",
  "artifact_uri": "senera://artifact/example",
  "observation_view": {
    "type": "senera.tool_observation_source_view.v1",
    "complete": false,
    "omission_count": 1
  },
  "detail": {
    "summary": "Completed with a bounded result.",
    "result": {}
  }
}
```

The execution bridge, including `AskUser`, always creates this envelope through
`AgentToolObservationContextCompiler`. Producers must not place `summary`, `result`, `process`, evidence, or
continuation data at the top level.

`observation_view.complete` describes whether the source compiler retained the complete artifact-derived input.
`context_view.complete` describes whether the batch projector retained the complete bounded source view. A context
view can therefore be complete while its source view is partial.

A recognized `senera.tool_observation.v1` value without either the source or context view marker is rejected before
exact token measurement. The runtime does not infer a projection from legacy payload fields. Persisted Pi sessions
carry the observation contract revision as non-model-visible metadata; a session containing an incompatible old
observation is rebuilt from canonical conversation history instead of being migrated in the projection pipeline.

## System Tool contract

Every bundled Host Tool contract declares a package-relative projection file:

```json
{
  "name": "ExampleTool",
  "observationProjection": "observations/default.projection.json"
}
```

The projection file is declarative. It can select only protocol-defined sources, an optional RFC 6901 pointer, a projection mode, a priority tier, a per-source token limit, and explicit structural limits. It cannot execute code, evaluate expressions, or infer semantics from payload field names.

```json
{
  "$schema": "https://schemas.senera.ai/tool-observation-projection/v1.json",
  "schemaVersion": 1,
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
      "maxTokens": 512,
      "limits": {
        "maxDepth": 1,
        "maxArrayItems": 0,
        "maxObjectProperties": 0,
        "maxStringCharacters": 4096,
        "maxTotalCharacters": 4096,
        "maxNodes": 2
      }
    },
    {
      "source": "result",
      "mode": "json",
      "priority": "normal",
      "maxTokens": 1024,
      "limits": {
        "maxDepth": 8,
        "maxArrayItems": 32,
        "maxObjectProperties": 48,
        "maxStringCharacters": 2048,
        "maxTotalCharacters": 12288,
        "maxNodes": 384
      }
    }
  ]
}
```

Sources are resolved by the execution protocol: `headline`, `summary`, `error`, `process`, `retrieval`, `continuation`, `evidence`, `delta`, `workspace`, `result`, `arguments`, `projection`, `summaryFacts`, `limitations`, and `outcome`. Source order within a priority tier is stable. `artifactOnly` records an explicit omission and never places that source in model context.

The runtime always owns the tool name, call ID, batch ID, assessment status, execution status, output availability, artifact URI, and canonical failure envelope. A package cannot remove or redefine these fields.

Projection content participates in the registered Tool digest and extension directory revision. A projection update therefore invalidates stale Pi contracts and runtime snapshots.

## Budget behavior

Structural limits are applied before BPE tokenization. This prevents a very long scalar or diagnostic collection from entering a tokenizer whose exact implementation may have a poor worst case. Exact token accounting is performed on the bounded candidate and on the final serialized view.

Arrays and objects retain the largest complete prefix found by binary search. Only the first overflowing branch is recursively projected; later siblings are represented by an omission count. Every partial view remains valid JSON and reports why data was omitted.

Pi then allocates the remaining turn budget across concurrent Tool observations. `prepare()` performs parsing, inspection, allocation, and projection once. Token cost is represented as `exact`, `overBudget`, or `unknown`; the runtime does not fabricate a complete token count for oversized data.

## MCP and Skills

MCP does not use Senera projection files. The MCP Server owns `inputSchema`, `outputSchema`, standard `content`, and `structuredContent`. Senera prefers validated `structuredContent`, otherwise uses bounded text content, records the complete call as an artifact, and applies the standard runtime projection.

Skills do not produce Tool observations and declare no projection contract.
