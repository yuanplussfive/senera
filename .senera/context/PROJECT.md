# Senera Project Context

Senera is a TypeScript ESM agent runtime. Backend code lives in `Source/AgentSystem`, application entry points live in `Apps`, and the React frontend lives in `Frontend`.

## Working Agreements

- Preserve existing user changes in the working tree and keep edits scoped to the requested behavior.
- Use the repository's existing domain services, schemas, event contracts, and shared utilities before adding new abstractions.
- Keep System tools, MCP tools, Skills, permissions, sandbox execution, and Artifact recording on their established Senera runtime paths.
- Treat `.senera/data`, `.senera/pi-sessions`, credentials, artifacts, and other host state as runtime-owned.
- Create or update managed Skills and MCP packages only through their validated publication workflows.
- Update backend and frontend protocol types together when adding WebSocket requests or events.

## Verification

Run focused tests while iterating. Before completing a broad change, run type checks, backend tests, frontend tests, and the production build that cover the touched surfaces.
