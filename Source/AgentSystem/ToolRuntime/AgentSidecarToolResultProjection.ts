import { readAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";
import {
  formatAgentToolContractValidationIssue,
  validateToolContractValue,
} from "./AgentToolSignatureArgumentValidator.js";
import type { RegisteredSidecarTool } from "../Types/AgentToolRuntimeTypes.js";

/**
 * Validates a sidecar's committed value and resolves its declared visible
 * result body. Sidecars do not publish normal tool-result events, so this is
 * the common presentation boundary for their owning runtimes.
 */
export function projectAgentSidecarToolResultBody(contract: RegisteredSidecarTool, value: unknown): unknown {
  const issues = validateToolContractValue({ schema: contract.outputSchema, value });
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => formatAgentToolContractValidationIssue(issue, "result")).join("; "));
  }

  const body = contract.presentation.preview?.body;
  if (!body || (body.from !== undefined && body.from !== "result")) {
    throw new Error(`Sidecar tool ${contract.name} has no result-body presentation contract.`);
  }
  const projected = readAgentJsonPointer(value, body.pointer);
  if (!projected.found) {
    throw new Error(`Sidecar tool ${contract.name} result does not contain ${body.pointer || "the root value"}.`);
  }
  return projected.value;
}
