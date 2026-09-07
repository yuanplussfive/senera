# Schemas

`Schemas` contains Zod contracts for runtime configuration and registered tool metadata. It defines input boundaries only; filesystem discovery and runtime composition belong to their owning modules.

- `AgentSystemConfigSchema.ts` composes the top-level configuration.
- `AgentToolContractSchema.ts` validates execution, runtime, search, resource, approval, and artifact policy fields shared by registered Tools.
- `AgentToolObservationProjectionSchema.ts` validates package-owned System Tool model-view projections.
- `AgentArtifactContractSchema.ts` validates artifact and evidence declarations.
- `AgentRootCommandContractSchema.ts` validates root-command policy assets.
- `AgentToolSearchContractSchema.ts` validates discovery and routing metadata.

Legacy MCP package documents are validated by `McpPackages/AgentMcpPackageSchema.ts`; MCPB and Registry documents are owned by their descriptor adapters and normalize to the shared extension input model. System extension manifests and contracts are validated by `SystemTools/AgentSystemToolSource.ts`. Standard `SKILL.md` frontmatter is validated by `Skills/AgentSkillScanner.ts`. Do not merge external standards into one authoring schema or add a second schema for the same source format.
