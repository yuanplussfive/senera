# Workspace resources

New addressable files use `senera://resource/<id>`, where `<id>` is six lowercase
Crockford Base32 characters (for example `senera://resource/k7m4p9`). Uploads,
screenshots, downloads, inline MCP media, Artifact bundles and assets all call
`allocateAgentResourceId`; producers never derive IDs from names or hashes.

The authoritative ledger is
`.senera/data/resources/identities.sqlite`, resolved by the shared workspace
layout. Allocation uses a SQLite immediate transaction and primary-key
constraint. Candidate collisions are retried, concurrent publishing processes
share the same namespace, and FULL synchronous commits persist the reservation
before publication. Reservations are permanent, including failed publications
and deleted/expired resources. The finite namespace reports exhaustion
explicitly. A damaged ledger blocks allocation and is not reinitialized.

Immutable Artifact publications provide an owner key so retrying the same
publication reuses its reservation. This key is private publication metadata;
there is only one external resource identity. Adapter-local `asset:` coordinates
exist only within an Artifact transaction and are replaced before publication.
Their terminating slash prevents one asset label from matching another label's
prefix.

Storage owners keep their existing bytes, retention and integrity policies.
`AgentResourceResolver` performs exact URI lookup and verifies bytes. Historic
URIs remain aliases of their original manifests in the same identity ledger.
No files or stored conversations are renamed. Bundle descriptors retain the
storage owner's entity ID and manifest locator; deleted descriptors remain
tombstones and cannot be rebound to new content.
Uniqueness is scoped to the workspace. A URI is a locator, not an authorization
grant; workspace boundaries and access policy still apply.

Execution, memory and skill coordinates represent other domain entities. Their
identity contracts remain independent of the six-character resource namespace.
File resolution rejects bundle identities explicitly; Artifact reads and
checkpoint restoration resolve them through their owning manifest index.
