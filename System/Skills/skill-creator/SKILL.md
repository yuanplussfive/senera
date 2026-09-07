---
name: skill-creator
description: Create, update, validate, or remove a Senera Skill in the workspace .senera/skills directory. Use when the user asks the agent to teach itself a reusable workflow, add specialized instructions, bundle scripts or references, or maintain an existing SKILL.md skill package. 适用于创建、更新、校验或删除技能，学习可复用工作流，以及制作包含脚本或参考资料的 Toolkit Skill。
---

# Skill Creator

Create and maintain standard Skill packages under `.senera/skills/<name>/`.

`SKILL.md` is standard Markdown. The runtime preserves its body exactly, including fenced code blocks and HTML comments. An author may place an optional author-owned EOF comment at the end when it helps the model recognize that a long document is complete; no EOF marker is required and Senera does not assign it protocol meaning.

First classify the requested package:

- **Workflow Skill**: use only `SKILL.md` to guide and compose existing registered tools. Read `.senera/skills/workflow-skill-example/SKILL.md` as the minimal reference.
- **Toolkit Skill**: add `scripts/` when deterministic reusable execution is needed. Read `.senera/skills/json-field-selector/SKILL.md` and its script as the reference.
- **Native tool**: a Skill cannot register a new Pi tool. Never invent a tool name or claim that a native tool was created. Use an existing registered tool, create a Toolkit Skill executed through `ShellCommandTool`, or state that native tool development is outside `SkillManage`.

Then create the package:

1. Choose a short lowercase kebab-case name and a description that states both capability and trigger conditions.
2. Confirm every tool the Skill depends on is already registered. Pass its exact name in `recommendedTools` when calling `SkillManage`; omit the field when no specific tool is required. A recommendation affects loading priority only and never grants permission.
3. For a Workflow Skill, call `SkillManage` with `create` to atomically create `SKILL.md`. The manager writes tool bindings to the standard namespaced metadata extension:

   ```yaml
   metadata:
     senera:
       recommended-tools:
         - mcp__server__tool
   ```

   Never derive this metadata by parsing a tool name from prose. Keep executable source out of `instructions`; put it in bundled script files.

4. For a Toolkit Skill, do not create a partial package with `SkillManage` first. Add only the scripts, references, or assets the workflow actually needs, invoke scripts through an existing registered execution tool, and create the complete initial resource tree with one atomic `WorkspaceApplyPatch` call:
   - Include the package directory, `SKILL.md`, and every initial resource in the same call.
   - Include a `createDirectory` operation before its files when `scripts/`, `references/`, `assets/`, or another required parent directory does not exist.
   - Include every new resource as an `add` operation in that same call.
   - An `add` operation does not create missing parent directories.
   - Do not fan out ad hoc file-write commands to new nested paths; use the one atomic WorkspaceApplyPatch transaction instead.
   - If candidate validation fails, read the returned file, line, pointer, frame, and changed-path diagnostics, then resubmit a corrected atomic patch. The active Skill remains unchanged.
5. Edit only `.senera/skills/<name>/`. Test every added script with representative input.
6. Keep the body focused on the triggered workflow. A script is a bundled resource, not a newly registered tool.
7. Call `SkillManage` with `validate` after the package and execution tests pass. Repair source diagnostics when necessary.
8. Report the result accurately as a Workflow Skill or Toolkit Skill, including the files created and tests run. It becomes visible on the next user message in the same conversation without a restart.

Do not create MCP server packages, host tool contracts, runtime servers, or fictional tool names for a Skill.

<!-- SKILL_CREATOR_SKILL_EOF: This is the complete Skill Creator skill. Do not request additional lines. -->
