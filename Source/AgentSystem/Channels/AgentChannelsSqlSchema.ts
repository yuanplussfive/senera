import { loadAgentSqliteStoreContract } from "../Database/AgentSqliteStoreContract.js";
import runtimeContract from "./Database/runtime.json" with { type: "json" };

/** Channel session mappings are authoritative channel state. */
export const AgentChannelsDatabaseContract = loadAgentSqliteStoreContract(runtimeContract);
