<p align="center">
  <img src="docs/brand.svg" alt="senera" width="76">
</p>

<h1 align="center">senera</h1>

<p align="center">
  <strong>A locally deployed agent runtime</strong><br />
  The model produces intent, and the host runtime handles authorization, execution and evidence, so a model without native tool calling still gets the work done.
</p>

<p align="center">
  <a href="https://github.com/yuanplussfive/senera/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/yuanplussfive/senera"></a>
  <a href="https://github.com/yuanplussfive/senera/actions/workflows/verify.yml"><img alt="Verify" src="https://img.shields.io/github/actions/workflow/status/yuanplussfive/senera/verify.yml?branch=main"></a>
  <a href="https://github.com/yuanplussfive/senera/releases/latest"><img alt="Windows desktop installer" src="https://img.shields.io/badge/Desktop-Windows-0078D6?logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgcm9sZT0iaW1nIj48cGF0aCBkPSJNMCwwSDExLjM3N1YxMS4zNzJIMFpNMTIuNjIzLDBIMjRWMTEuMzcySDEyLjYyM1pNMCwxMi42MjNIMTEuMzc3VjI0SDBabTEyLjYyMywwSDI0VjI0SDEyLjYyMyIvPjwvc3ZnPg==&logoColor=white"></a>
  <a href="./docs/Operations.md"><img alt="Linux Docker deployment" src="https://img.shields.io/badge/Deploy-Linux-FCC624?logo=linux&logoColor=black"></a>
  <img alt="Node" src="https://img.shields.io/badge/Node.js-24-43853d">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6">
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue">
</p>

<p align="center">
  <a href="./README.md">中文</a> · <strong>English</strong>
</p>

<p align="center">
  <img src="docs/screenshot/chat-execution.png" alt="Main workbench: session list on the left, conversation in the center, execution trace of the current turn on the right, showing nodes, tool calls and durations">
</p>

<p align="center">
  <img src="docs/screenshot/workspace-files.png" alt="Workspace file tree with live Markdown preview" width="49%">
  <img src="docs/screenshot/settings-provider.png" alt="Provider settings: protocol type, endpoint management and encrypted API keys" width="49%">
</p>

## Motivation

Agent tools share a common gap: conversation is reliable, execution is not. One group of implementations bets its stability on argument assembly, where a single unescaped quote breaks the call chain and leaves no way to reconstruct which tool ran or where it failed. Another group binds execution entirely to a vendor's native tool calling, so behavior changes whenever the model or endpoint changes.

**senera separates intent generation from execution.**

The model generates intent; the host runtime executes. [Pi Coding Agent](https://github.com/earendil-works/pi) provides the session tree, multi-step tool loop and context compaction. senera implements argument validation, permission policy, sandbox boundaries, evidence packaging and live observation. The execution tree in the right-hand panel comes from real-time events of the current turn, not from logs reconstructed afterwards.

## Capabilities

### 1. One rulebook, independent of native tool calling

Native tool calling is not a requirement. Each model's planning path can be set in the UI:

- **`native`**: used directly when both the model and the endpoint adapter support native tool calling, with fewer steps and lower latency.
- **`baml`**: for models without native support, or where structured planning is required, [BAML](https://github.com/BoundaryML/baml) generates type-safe action plans.

The two paths diverge only at the entry point. Argument validation, the approval flow, the execution contract and result write-back are shared, and no switch happens mid-run. Vendor differences stay inside the adapter layer, so changing models does not affect existing workflows.

### 2. Policy decisions and explicit approval

[Open Policy Agent (OPA)](https://github.com/open-policy-agent/opa) compiles `.rego` policies to WebAssembly, and those policies decide whether a tool may run and whether a path may be read or written. The result is `allow`, `ask` or `deny`:

- **`deny` is enforced silently**: calls the policy denies never reach the approval UI.
- **`ask` offers exactly four options**: **Once**, **This session**, **Deny**, **Deny and stop**. Nothing is inferred beyond the option that was clicked.
- **The execution target is declared by the contract**: every tool contract declares its execution target and network permission. A tool that requires the sandbox container terminates with an error when Docker is not running or the sandbox is unavailable. It never falls back to the host.

### 3. Full evidence, no context bloat

Long runs fail in two ways: output so large it consumes the context, or compaction that drops details that mattered.

After each tool execution, senera packages the input arguments, raw output, summary, frontend projection and file changes into a standalone **Artifact** written to disk. With [@agent-context/sift](https://github.com/agents-sdk/sift) and `gpt-tokenizer`, only a compact summary and the Artifact URI are written back to the model. Context length stays stable, and details remain reachable through the URI, which returns the original output the model worked from.

### 4. Retrieval and memory fully local

Many agent frameworks require separate endpoints for embedding and reranking. senera needs neither: retrieval and memory both run on the local machine.

- **Vector encoding**: the built-in [ternlight-mini-cn](https://github.com/soycaporal/ternlight) sentence encoder ships with the application and runs on the local CPU; computing vectors issues no external request.
- **Hybrid recall and routing learning**: [node-rs jieba](https://github.com/napi-rs/node-rs) segmentation, [MiniSearch](https://github.com/lucaong/minisearch) lexical search, [sqlite-vec](https://github.com/asg017/sqlite-vec) vector indexing and local score reranking, plus historical routing feedback. With many tools mounted, each turn still receives only the tools relevant to the current task.
- **Cross-session memory**: built on the [MemOS SDK](https://github.com/Markgatcha/memos). Extraction, storage and vector recall also run on the local path, so one chat model enables the full feature set.

### 5. Data stays local

Configuration, session trees, Artifact evidence, long-term memory, custom Skills and run logs all live in `.senera/` inside the chosen workspace. There is no mandatory cloud sync. API keys are encrypted with `AES-256-GCM` before writing to disk, and the service listens only on the loopback address `127.0.0.1` by default.

## Feature scope

The web UI and the Windows desktop application share one runtime kernel and cover these scenarios:

- **Code work and workspace investigation**: map directory structure, search code across files, modify files through patches, run tests and builds, inspect frontend pages, browse the file tree and preview Markdown live.
- **Controlled terminal and long jobs**: run controlled shell commands with `stdout`/`stderr`, exit codes and working directory collected as reviewable evidence. Long-running or interactive work uses an explicit background execution resource (list, inspect, write, signal), or you take over input in the built-in [xterm.js](https://github.com/xtermjs/xterm.js) terminal panel.
- **Web research and multimodal understanding**: search and fetch pages, drive a browser through [agent-browser](https://github.com/vercel-labs/agent-browser), read images and documents, query weather, generate images.
- **Desktop control and subagent orchestration**: desktop-level control in a graphical session (screenshots, mouse and keyboard through the bundled [computer-use-mcp](https://github.com/zavora-ai/computer-use-mcp)); subagent dispatch (Orchestration), persistent tasks and scheduled triggers ([pi-task-scheduler](https://github.com/TGYD-helige/pi)).

## Quick start

Models and API keys are configured in the UI, so there is no config file to edit. Open "**Models → Providers**", add a provider with its endpoint and key, pass the connection check, set it as default and save. The change takes effect immediately. The configuration file is git-ignored and keys are encrypted on disk.

### Option 1: Windows desktop

1. Download and run the latest `.exe` installer from [Releases](https://github.com/yuanplussfive/senera/releases/latest).
2. On first launch, select a workspace directory (for example `E:\SeneraWorkspace`). All configuration, sessions, Artifacts and logs are written to `.senera/` inside it instead of the system drive.
3. Upgrades are checked under "**Settings → About**". Once the differential package has downloaded, you decide when to restart and install. The desktop build listens on loopback only and requires no administrator login.

### Option 2: Docker self-hosted

The `compose.yaml` in this repository ships a default administrator account (login `senera`, password `114514`), which is sufficient for local verification. Before exposing it to a LAN or the public internet, change the administrator login name, display name and password, then run:

```bash
docker compose pull
docker compose up -d --pull always
```

After startup, open `http://localhost:8787`.

> **Deployment note**: the image does not terminate TLS. Plain HTTP is acceptable on loopback, but anything exposed externally must sit behind an HTTPS reverse proxy. The default orchestration runs the main process as `root` and bind-mounts the host Docker Engine socket to schedule tool sandbox containers, which suits a single trusted machine and development use. For production, multi-tenant or untrusted networks, read the [deployment and operations manual](docs/Operations.md) first (Chinese-only for now).

### Option 3: Run from source (the `nano` branch is recommended)

To run from source locally without pulling in the build and packaging toolchain, clone the generated `nano` branch. It removes Compose, Electron, installers, tests and release scaffolding:

```bash
git clone --depth 1 --branch nano --single-branch https://github.com/yuanplussfive/senera.git senera
cd senera
npm ci
npm run dev
```

**Node.js 24** is required. The first `npm run dev` generates `senera.config.json` from the template with placeholders. Open `http://127.0.0.1:5173` and enter the model and API key on the settings page.

> The `nano` branch is rebuilt automatically after `main` passes full verification and does not accept commits. To change code or open a PR, clone the default branch; the differences are described in [development guide: getting the source](docs/Development/README.md#获取源码).

## Model protocols and capability extensions

### Supported protocols

senera adapts four upstream protocols natively, selectable per model in the UI:

- **OpenAI Responses**
- **OpenAI Chat Completions** (including compatible endpoints)
- **Anthropic Claude Messages**
- **Google GenerateContent**

`native` and `baml` share one execution and observation write-back contract; only the planning prompts differ. How endpoints and models are layered, the model ID migration on provider rename, and the alias rules are described in [deployment and operations: first configuration](docs/Operations.md#首次配置). To add a protocol, follow the [add a model endpoint guide](docs/Development/AddModelEndpoint.md).

### Three extension layers (no changes to the main loop)

New capabilities do not require editing the runtime. Place them in the directory matching their type, and changes take effect without a restart:

| Extension layer | Location                                  | What you write                                                           | When to use it                                                                                                         |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **System Tool** | `System/Extensions/<domain>/<extension>/` | Declarative `domain.json` + `extension.json` + `*.tool.json`             | System-level tools that need typed credentials, an explicit sandbox boundary and fine-grained policy                   |
| **Skill**       | `System/Skills/`, `.senera/skills/`       | A standard `SKILL.md` (may reference registered tools)                   | Domain troubleshooting routines, working conventions and composite workflows (a Skill authoring assistant is built in) |
| **MCP Package** | `McpServers/`, `.senera/mcp/`             | MCPB `manifest.json`, Registry `server.json` (`.mcp.json` also accepted) | Reuse of a community or in-house standard MCP server                                                                   |

Retrieval and recall are detailed in the [ToolSearch module README](Source/AgentSystem/ToolSearch/README.md); extension contracts, typed credentials, sandbox boundaries and reload rules are in the [Skills, System Extensions and MCP development guide](docs/Development/ManagedExtensions.md).

## Further reading

Look up implementation details and extension work by question (these documents are Chinese-only for now):

| Question                                                                                                          | Document                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| How does a request pass planning, policy, approval, execution and write-back? Why is state stored in four layers? | [Core flow guide](docs/Architecture/CoreFlow.md)                                                                                                      |
| How does a tool execute on the host or in the sandbox? How does large output become an Artifact?                  | [Tool execution runtime](docs/Architecture/ToolExecutionRuntime.md) · [Tool observation compression](docs/Architecture/ToolObservationCompression.md) |
| How is the live execution tree produced? How do frontend and backend events stay in sync?                         | [Event observability](docs/Architecture/EventObservability.md) · [WebSocket protocol reference](docs/API/WebSocketProtocol.md)                        |
| Where are the boundaries between long-term memory and tool routing learning?                                      | [Scenario memory and learning](docs/Development/Learning.md)                                                                                          |
| How are subagents dispatched? How are persistent tasks and background jobs scheduled?                             | [Orchestration module README](Source/AgentSystem/Orchestration/README.md)                                                                             |
| How do auxiliary requests such as title generation and summarization control their context budget?                | [Auxiliary model requests](docs/Architecture/AuxiliaryModelRequests.md)                                                                               |
| Where do I look for production deployment, upgrades, rollback, log triage and sandbox monitoring?                 | [Deployment and operations](docs/Operations.md) · [Changelog](CHANGELOG.md)                                                                           |
| Where do I start to add a tool, an observation event or a model endpoint?                                         | [Development guide](docs/Development/README.md) · [Glossary](docs/Glossary.md)                                                                        |

## Project layout

```text
senera/
├─ Apps/                    Server, Desktop (Electron) and CLI entry points
├─ Source/AgentSystem/      Agent runtime core (each sub-module has its own README)
├─ System/Extensions/       Resident System Extension packages and declarative tool contracts
├─ System/Skills/           Official bundled Skills
├─ McpServers/              First-party MCP packages
├─ Frontend/                React + Vite + Tailwind CSS workbench
├─ Packages/                Internal shared runtime packages
├─ baml_src/                BAML planning and auxiliary function definitions
├─ Build/ Scripts/          Build, code generation and engineering governance scripts
├─ docs/                    Architecture, operations and development manuals
└─ .senera/                 Workspace directory: runtime data is kept out of the repository, only governed templates are tracked
   ├─ context/PROJECT.md    Controlled project context injected into the system prompt
   ├─ skills/ mcp/          Workspace-level Skills and MCP packages (two examples are tracked)
   ├─ data/                 Runtime data isolated across nine domains: config, credentials, sessions,
   │                        memory, orchestration, channels, memos, artifacts, workspace-observer
   └─ desktop/              Desktop logs, differential upgrade records and local cache
```

## Acknowledgments

senera builds its core paths on the following open-source projects:

| Upstream project                                                                                                                  | Responsibility                                                                                                                       | License    |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| [Pi Coding Agent](https://github.com/earendil-works/pi)                                                                           | Execution kernel for session trees, multi-step tool loops and context compaction, consumed as a dependency rather than reimplemented | MIT        |
| [BAML](https://github.com/BoundaryML/baml)                                                                                        | Typed prompt functions and code generation for models without native tool calling                                                    | MIT        |
| [ternlight](https://github.com/soycaporal/ternlight)                                                                              | Built-in local sentence encoder computing retrieval and memory vectors on the CPU, with no external embedding service                | MIT        |
| [Open Policy Agent](https://github.com/open-policy-agent/opa) / [opa-wasm SDK](https://github.com/open-policy-agent/npm-opa-wasm) | Tool approval and resource access decisions; `.rego` compiled to `.wasm` and shipped with the package, evaluated in-process          | Apache-2.0 |
| [@agent-context/sift](https://github.com/agents-sdk/sift)                                                                         | Compresses large tool output while keeping the original recoverable                                                                  | Apache-2.0 |
| [MemOS SDK](https://github.com/Markgatcha/memos)                                                                                  | Extraction, storage and recall of cross-session memory                                                                               | MIT        |

## License

Released under the Apache License 2.0. See [LICENSE](./LICENSE).
