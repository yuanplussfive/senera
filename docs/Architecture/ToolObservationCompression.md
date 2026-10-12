# Tool Observation Compression

Tool result persistence and model-context sizing are separate responsibilities. The Artifact recorder stores the complete redacted result and its evidence before the Pi bridge builds the observation for the next model request. Source-view reads keep their existing Artifact coordinates and are not published as nested Artifacts.

## Budget

Each Pi turn tracks the provider-reported context usage and estimates context Pi has not measured yet. The usable input capacity is the model context window minus the configured output reserve, less occupied input. A parallel tool batch shares its remaining capacity across the calls registered in that batch. The shared token-budget owner applies the configured observation ceiling while creating each reservation, keeps the raw batch allocation for diagnostics, and passes one effective `observationBudgetTokens` value to the compressor. The compressor has no second global ceiling.

The compressor counts the complete serialized observation with the active model tokenizer. This includes the protocol envelope, status, numeric and boolean fields, Artifact/evidence coordinates, and result content; it measures what the model will actually receive rather than estimating only selected JSON values.

## Compression Path

1. **Verbatim**: if the complete observation fits both limits, pass it unchanged.
2. **Mechanical**: otherwise, reuse the Artifact's canonical `structuredSummary` when one is available. The Artifact recorder is the single deterministic summary owner; the observation only adapts that summary to the current envelope and token reservation. For results without a durable structured summary, the shared adaptive text projector deduplicates and ranks the raw result before the bounded JSON projection. Preserve non-text JSON values and the host-owned Artifact/evidence URIs. The observation declares `compression_method: "mechanical"` and marks omitted source content.
3. **LLM**: only a result without a durable structured summary can enter the optional Pi summary request after raw mechanical projection still loses substantive content. Artifact-backed results do not summarize the same source a second time. The host adds protected Artifact/evidence coordinates to the final observation and declares `compression_method: "llm"`.

No tool package chooses a projection, inline threshold, or compression strategy. If the mandatory protocol and protected coordinates consume the entire Pi reservation, the compressor returns a bounded pressure observation that points to the durable Artifact when one exists; it does not turn a successful tool execution into an oversized result or a synthetic execution failure.

## Extension Contract

System Tool packages define input and output contracts, execution policy, search metadata, and artifact policy. They do not ship observation projection files or per-tool content policies. MCP output continues to use the standard `tools/list`, `content`, and `structuredContent` boundary. Both sources enter the same host-owned observation compressor.
