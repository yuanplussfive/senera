# Senera Skill package contract

Each Skill is a directory with one required `SKILL.md` and optional resource
directories. The directory name and frontmatter `name` must be the same
lowercase kebab-case identifier.

```text
.senera/skills/<name>/
  SKILL.md                 # required instructions and frontmatter
  references/              # optional, on-demand reference material
  scripts/                 # optional, deterministic executable helpers
  templates/               # optional, authoring or output templates
  assets/                  # optional, binary or visual assets
```

The frontmatter `description` is the discovery summary. Keep it short and
trigger-focused. Use `metadata.senera.recommended-tools` only for exact
registered tool names; it affects loading priority and never grants access.
Set `disable-model-invocation: true` only when the package must remain
explicit-only; `/skill-name` still works, while automatic Skill routing and
Skill search omit it.

The Markdown body is the authoritative workflow. It should state when to use
the Skill, the ordered procedure, inputs, outputs, constraints, and a concrete
verification step. Resource files are not copied into the body automatically;
refer to them by relative path and read them only when the task needs them.

Senera derives the live catalog and revision from the package files. There is
no second manifest to edit and no direct filesystem path supplied by a model.
Use `senera skills list`, `inspect`, `resources`, and `read` for bounded
discovery and resource access. System Skills are read-only; workspace Skills
are changed only through the revision-guarded self-service surface.

The runtime uses progressive disclosure: discovery exposes metadata, activation
loads the selected `SKILL.md`, and package resources remain on demand. Do not
duplicate the full body in the frozen system prompt.
