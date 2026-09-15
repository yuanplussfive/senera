import { loadAgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import runtimeContract from "./Database/runtime.json" with { type: "json" };

/** Tool-learning data is derived and rebuilt from this domain-local contract. */
export const AgentToolSearchLearningStoreContract = loadAgentSqliteStoreContract(runtimeContract);
