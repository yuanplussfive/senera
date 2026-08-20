# Artifacts

Artifacts records a tool call as a traceable evidence package while keeping the immediate model observation bounded.

- `AgentToolExecutionArtifactRecorder` coordinates a result batch, deterministic projection, directory reservation, and publication collaborators.
- `AgentArtifactPublicationRecovery` validates retry identity, merges Session owners, and restores verified published refs.
- `AgentToolArtifactFilePublisher` owns file receipts, manifest publication, writing markers, and output-spool commit/failure handling.
- `AgentArtifactDeltaProjection` projects evidence/workspace deltas without filesystem access.
- `AgentArtifactEvidenceProjection` and `AgentArtifactTemplateProjection` derive facts and summaries from normalized tool policy.
- `AgentArtifactRedaction` applies structured and stream redaction.
- `AgentWorkspaceChangeCapture` records declared workspace changes.
- `AgentArtifactLocator` resolves artifact and evidence URIs.
- `SeneraOutputSpool` preserves bounded stdout/stderr independently of live UI projection.

Raw output, model projection, and durable evidence are separate surfaces. Evidence must remain traceable through an URI. Tool artifact policy is already normalized by the registry; this module must not branch on a tool or MCP package name. Spool data is removed only after artifact commit and retained for diagnosis when sealing or commit fails.

Artifact publication is one transaction: reserve the deterministic directory, write `.artifact-writing`, materialize workspace capture and all artifacts, then hard-link `manifest.json` as the one-time commit marker. A reservation cannot be reused. Before that marker exists, readers discover no artifact; any failure leaves a failed marker and retains its output spool for diagnosis. After commit, every readable ref has a SHA-256 receipt covering the exact byte length and content. The same path verifies text, JSON, output streams, and workspace patches. Redaction happens before identity hashes are derived, so persisted identity and persisted bytes describe the same redacted record.

The recorder must not parse committed manifests or manage receipt maps. Retry recovery belongs only to `AgentArtifactPublicationRecovery`; first-publication file layout and spool state belong only to `AgentToolArtifactFilePublisher`. Both receive explicit structured inputs and must not infer behavior from tool names or payload shape.

Receipts establish bundle consistency, not hostile-workspace provenance: a manifest and a signing key stored beside the artifact can be replaced together. When export or cross-machine authenticity is required, anchor the canonical manifest digest in protected execution persistence or attach a detached signature whose private key is outside the workspace. A self-hash in the same mutable directory is intentionally not treated as a security feature.

Large structured refs remain exact on disk and are read through a deterministic view pipeline. While a JSON ref is persisted, `stream-json` also produces a constant-memory NDJSON structure sidecar containing root type, top-level field types, and array item counts. Root indexes page that sealed sidecar directly from the cursor byte boundary. An index request with `sourcePath` regenerates only that nested object's structural stream from the verified raw file; its cursor binds the source path, source identity, derived structure identity, and model-visible projection policy. This avoids eagerly materializing recursive indexes while preserving complete-record pagination.

`AgentArtifactJsonQuery` validates the typed query AST, streams the original JSON, assembles only matching array elements, and uses the active model tokenizer to stop each page at a complete element boundary. Index and query cursors are distinct protocols. They bind continuation state to the source hash, a tagged index identity (`sidecar` content digest or derived nested-path identity) or query identity, and model-visible projection policy, so a cursor becomes invalid when any relevant input changes. Manifest discovery is capability-driven: supported content records are validated independently, unknown capabilities remain forward-compatible, and `schemaVersion` metadata never gates readability. JSON/TOON/CSV are presentation choices above this boundary and must never replace the durable raw ref.

Artifact Liquid templates are parsed during system-tool publication with strict filter handling and Liquid's static global-variable analysis. The preflight validates every declared path against a fixed artifact/evidence scope and the tool's input/output JSON Schemas; closed schema objects reject misspelled members, while declared dynamic maps such as evidence slots remain dynamic. Loop-local variables are preserved, so missing roots, members, and filter typos fail at publication rather than rendering as empty output at runtime.

## Session ownership

A committed Artifact can be referenced by more than one product session after a fork. New manifests write both the legacy-compatible primary `sessionId` and the normalized `sessionIds` owner set. Readers merge both fields, trim and deduplicate IDs, and sort them deterministically, so older single-owner bundles remain readable without a migration pass.

Fork retention adds the target owner only to Artifacts whose `requestId` is included in the fork snapshot and whose source owner is present. Truncate releases the current session owner only for removed request IDs. Session close releases that session from every complete Artifact; the directory is deleted only when no owner remains. Incomplete bundles and output spools remain single-owner because they cannot be shared before publication.

Owner changes run through the same serialized maintenance queue and `AgentArtifactFileWriter` atomic JSON replacement as other metadata updates. They participate in the Session durable mutation saga: a failed fork removes the target owner, while a history mutation journal remains pending until request-scoped owner release and the SQLite commit both succeed. Retention code must never infer ownership from directory names or delete a shared bundle merely because its primary `sessionId` closed.
