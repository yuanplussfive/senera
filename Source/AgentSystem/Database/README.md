# SQLite Persistence Kernel

All durable Senera SQLite repositories use `AgentSqliteDatabaseKernel` for connection policy and schema lifecycle. Domain repositories remain responsible for typed statements, row mapping, and domain transactions.

Each database owns an ordered migration list. Migration versions start at `1` and are contiguous. SQL migrations are declared with `defineAgentSqliteMigration`; their SHA-256 checksum is derived from the immutable SQL text. The runner stores version, name, checksum, and application time in `schema_migrations` and fails closed when an applied migration drifts or the ledger is incomplete.

Migration execution uses `BEGIN IMMEDIATE`, so the schema change and its ledger record commit atomically. A migration failure rolls back both. Existing databases are adopted by an idempotent baseline migration; future changes must be new migrations and must not edit an already-applied baseline.

The Kernel resolves database paths to absolute paths, creates the parent directory, enables foreign keys, and applies the configured WAL/busy-timeout policy. `inspectHealth()` provides an integrity and foreign-key check for startup diagnostics. `close()` checkpoints WAL (when configured) and always closes the native connection.
