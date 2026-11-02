import { loadAgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import runtimeContract from "../Artifacts/Manifest/Database/runtime.json" with { type: "json" };

/** Derived lookup data for filesystem-owned Artifact manifests. */
export const AgentArtifactManifestIndexContract = loadAgentSqliteStoreContract(runtimeContract);
