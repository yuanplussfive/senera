import { loadAgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import runtimeContract from "./Database/runtime.json" with { type: "json" };

/** Memory is authoritative data with a domain-local, versioned SQL contract. */
export const AgentMemoryDatabaseContract = loadAgentSqliteStoreContract(runtimeContract);
