import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import { AgentToolResourceManifestValidatorRegistry } from "./AgentToolResourceCapabilityRegistry.js";
import { AgentToolUploadReadResourceManifestValidator } from "./AgentToolUploadReadResourceCapability.js";
import { AgentToolUrlResourceManifestValidator } from "./AgentToolUrlResourceCapability.js";
import { AgentToolWorkspacePathResourceManifestValidator } from "./AgentToolWorkspacePathResourceCapability.js";
import { AgentToolWorkspaceRootResourceManifestValidator } from "./AgentToolWorkspaceRootResourceCapability.js";

/**
 * Validates bundled package metadata with the validators owned by the same
 * capabilities that later project and claim invocation resources.
 */
const DefaultResourceManifestValidators = new AgentToolResourceManifestValidatorRegistry()
  .register(AgentToolUrlResourceManifestValidator)
  .register(AgentToolWorkspacePathResourceManifestValidator)
  .register(AgentToolWorkspaceRootResourceManifestValidator)
  .register(AgentToolUploadReadResourceManifestValidator);

export function validateAgentToolResourceManifests(resources: readonly ToolResourceArgumentManifest[]): void {
  DefaultResourceManifestValidators.validateAll(resources);
}
