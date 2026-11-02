import { loadAgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import runtimeContract from "./Database/runtime.json" with { type: "json" };

/** Session persistence SQL is declared in SessionPersistence/Database. */
export const AgentSessionDatabaseContract = loadAgentSqliteStoreContract(runtimeContract);
