---
name: workspace-investigation
description: Investigate how local source code, configuration, prompts, UI text, errors, or cross-file behavior are implemented. Use for questions such as where something is implemented, why a behavior occurs, how a context is built, or which files own a feature when the answer depends on repository evidence. 适用于检查项目结构、搜索和读取本地代码、配置、提示词、界面文案与报错，并分析功能在哪里实现或问题为什么发生。
---

# Workspace Investigation

1. Classify the clue as an exact string, symbol, path, error, UI description, or natural-language behavior.
2. Search precisely first and treat matches only as candidates.
3. Read the most relevant source and follow imports, callers, configuration keys, and templates until the causal path is clear.
4. Prefer `rg` and focused file reads; use ToolSearch when workspace tools are not visible.
5. Resolve conflicting candidates with the latest source-of-truth code.
6. Ground conclusions in read files and line locations, and name any remaining evidence gap.
