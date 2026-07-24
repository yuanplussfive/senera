# SQLite Persistence Contracts

Every SQLite domain owns a `Database/` resource package next to its repository:

```text
<Domain>/Database/
  contract.json
  runtime.json
  migrations/0001-<name>.sql
  snapshots/0001.schema.sql
```

`contract.json` declares the store id, whether data is `authoritative` or `derived`, and each contiguous migration version. Each version references immutable SQL and its generated schema snapshot, with SHA-256 hashes for both. The SQL files are the source of truth for columns, keys, constraints, defaults, indexes, and foreign keys. TypeScript imports the generated runtime module; it does not contain DDL.

`runtime.json` is a generated, versioned module artifact containing the validated SQL and snapshots. Runtime code imports it through the standard JSON module contract, so Node, Electron, Docker, Vitest, and bundlers do not need to translate filesystem URLs. Do not edit it directly.

Run `npm run generate.database-contracts` after adding a migration. It applies every version to a fresh SQLite database, writes the canonical `sqlite_master` snapshot for each version, and refreshes manifest hashes. `npm run verify.database-contracts` checks that the checked-in resources are current; it runs before every build. `Build/CopyRuntimeAssets.ts` copies JSON and SQL resources into `Dist`, so development, Docker, and packaged desktop runtimes load the same contract.

The runtime stores its ownership and immutable migration ledger in `__senera_database_contract` and `__senera_schema_migrations`. Those control tables are excluded from domain snapshots.

- `authoritative` stores preserve user facts when their canonical schema exactly matches a declared historical version. The runtime records that version, then applies subsequent SQL migrations inside `BEGIN IMMEDIATE`. An unsupported or manually changed schema is replaced by a fully validated current database. A database with explicit metadata for a different store id or data class still fails explicitly, so a path configuration mistake cannot erase another domain.
- `derived` stores contain regenerable data such as tool-search learning. A current contract is reused. A declared old schema is rebuilt in a validated staging database. An unrecognized database is rejected; the runtime never guesses ownership from table names or deletes an arbitrary SQLite file.

To change a schema, add a new numbered SQL migration. Never edit a committed migration or snapshot by hand, and never add a runtime compatibility branch for a historical shape: model it as a declared versioned SQL transition instead. Unsupported authoritative schemas are intentionally reset, so their data must be treated as disposable before deployment.
