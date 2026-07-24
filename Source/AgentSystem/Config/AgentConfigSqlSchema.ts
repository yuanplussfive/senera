import { loadAgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import runtimeContract from "./Database/runtime.json" with { type: "json" };

/** The configuration store owns its versioned SQL contract beside this module. */
export const AgentConfigDatabaseContract = loadAgentSqliteStoreContract(runtimeContract);
