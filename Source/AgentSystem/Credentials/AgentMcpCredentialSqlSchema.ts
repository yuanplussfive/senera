import { loadAgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import runtimeContract from "./Database/runtime.json" with { type: "json" };

export const AgentMcpCredentialDatabaseContract = loadAgentSqliteStoreContract(runtimeContract);
