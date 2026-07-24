# Configuration command contracts

System configuration mutations are versioned independently from transport handlers and UI code.

- `versions/*.json` declares mutation semantics and identity fields.
- `snapshots/*.schema.json` is the immutable JSON Schema projection for a published version.
- `runtime.json` is generated from the latest version and consumed by runtime validators.
- `contract.json` records contiguous versions and SHA-256 checksums.

Published files are immutable. Change a command contract by appending a new version, then run
`npm run generate.config-command-contracts`.
