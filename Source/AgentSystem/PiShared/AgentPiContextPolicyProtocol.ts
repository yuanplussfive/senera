import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";

/**
 * Context policy protocol identifier and custom message type.
 *
 * Kept in PiShared so session persistence and Pi context hooks share one
 * protocol identity without importing the policy implementation.
 */

export const AgentPiContextPolicyProtocol = defineSeneraProtocol("pi_context_policy", 1);
export const AgentPiContextPolicyCustomType = "senera.pi_context_policy";
