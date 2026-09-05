import { loadAgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import runtimeContract from "./Database/runtime.json" with { type: "json" };

/** Child runs and scheduled tasks are authoritative orchestration state. */
export const AgentOrchestrationDatabaseContract = loadAgentSqliteStoreContract(runtimeContract);
