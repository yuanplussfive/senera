# Self-service commands

The model runs `senera` through a Local `ShellCommandTool`. The CLI sends one
structured command to the workspace's existing `/senera/self` endpoint. The
host binds the verified session and Agent, applies the session approval mode,
and dispatches through `executeAgentSelfInvocation`. Human CLI calls use the
same command executor with their own runtime discovery and approval transport.

## Process lifetime

`AgentSelfCliRuntime` prepares a private PATH launcher using the running
distribution's Node/Electron executable and CLI entry point. Development uses
the installed TypeScript loader; compiled distributions use their JavaScript
entry point. No global Node or CLI installation is required.

Each Local Shell resource receives a fresh credential in its environment.
The host retains its session, request, cancellation signal and approval context;
the command payload cannot replace them. The credential is revoked on process
termination, cancellation, failed startup or platform shutdown. A yielded Shell
resource keeps its credential while its process is alive. Credentials are not
written into the launcher or the workspace runtime manifest.

The scoped HTTP client never reads the administrator runtime manifest, including
after authentication failure. The HTTP exchange follows the Shell resource's
lifetime so a frontend approval is not cut short by the human CLI's transport
timeout. Commands cannot resolve their own approval requests.

## Contracts and results

`AgentSelfCommandSchema` validates built-in JSON commands; the registry describes
CLI arguments, aliases and governance metadata. `senera capabilities DOMAIN
[ACTION] --json` derives the matching JSON schema from that validator and
discovers currently registered plugin commands. `--input -` accepts one bounded
UTF-8 JSON object on stdin, avoiding Shell escaping of structured values and
multiline documents.

`npm run generate.self-command-contract` generates the Skill's command index
and checks registry/schema alignment. `npm run verify.self-command-contract`
checks the same contract without writing. The retired model tool schema is no
longer generated or registered.

Producers declare model-specific slices with `model`; the scoped executor uses
those slices, preserving document text and revisions. Administrative callers
retain the complete public result. CLI JSON output preserves `text`, `data`,
errors and approval state. Command failure returns a nonzero process exit code;
large output uses the existing Shell resource and Artifact capture path.
