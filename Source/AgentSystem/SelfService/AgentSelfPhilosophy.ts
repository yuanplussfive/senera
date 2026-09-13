import { projectAgentWorkbenchPhilosophy, type AgentWorkbenchPrincipleKey } from "./AgentWorkbenchContract.js";

/** Runtime-visible invariants projected from the workbench contract. */
export const AgentSelfPhilosophy = projectAgentWorkbenchPhilosophy();

export type AgentSelfPhilosophyKey = AgentWorkbenchPrincipleKey;
