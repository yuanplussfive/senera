import { loadAgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import runtimeContract from "./Database/runtime.json" with { type: "json" };

/** The workspace observer baseline is derived and can always be rebuilt by a fresh scan. */
export const AgentWorkspaceObserverStoreContract = loadAgentSqliteStoreContract(runtimeContract);
