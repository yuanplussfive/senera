import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";

/**
 * Context policy protocol identifier and custom message type.
 *
 * Extracted from Pi/AgentPiContextPolicy.ts to break the Pi ↔ PiProxy
 * circular dependency. The full AgentPiContextPolicy class remains in Pi/
 * and imports these constants from here.
 */

export const AgentPiContextPolicyProtocol = defineSeneraProtocol("pi_context_policy", 1);
export const AgentPiContextPolicyCustomType = "senera.pi_context_policy";
