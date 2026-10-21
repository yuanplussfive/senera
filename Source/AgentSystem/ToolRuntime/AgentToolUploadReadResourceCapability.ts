import { z } from "zod";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import type {
  AgentToolResourceCapability,
  AgentToolResourceManifestValidator,
} from "./AgentToolResourceCapabilityRegistry.js";
import { AgentToolResourceCapabilityIds } from "./AgentToolResourceCapabilityIds.js";
import {
  AgentToolResourceAccessModes,
  createExactAgentToolResourceClaimDomain,
} from "./AgentToolResourceClaimTypes.js";
import type { AgentResolvedUpload } from "../Uploads/AgentUploadTypes.js";

const UploadReadParametersSchema = z.object({}).strict();
const BindingSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/u, "Upload resource binding must be an identifier.");

interface UploadReadResourceInput {
  resource: ToolResourceArgumentManifest;
  value: unknown;
  args: Readonly<Record<string, unknown>>;
}

export const AgentToolUploadReadResourceManifestValidator: AgentToolResourceManifestValidator = Object.freeze({
  id: AgentToolResourceCapabilityIds.UploadRead,
  validateManifest(resource: ToolResourceArgumentManifest) {
    UploadReadParametersSchema.parse(resource.Parameters ?? {});
    BindingSchema.parse(resource.Binding);
  },
});

export class AgentToolUploadReadResourceCapability implements AgentToolResourceCapability {
  readonly id = AgentToolResourceCapabilityIds.UploadRead;
  private readonly claimDomain = createExactAgentToolResourceClaimDomain(this.id);

  constructor(private readonly uploads: Pick<AgentUploadStore, "resolve">) {}

  validateManifest(resource: ToolResourceArgumentManifest): void {
    AgentToolUploadReadResourceManifestValidator.validateManifest(resource);
  }

  async project(input: UploadReadResourceInput) {
    this.validateManifest(input.resource);
    const upload = await this.resolve(input);
    const binding = BindingSchema.parse(input.resource.Binding);
    return {
      target: "resource" as const,
      binding,
      value: {
        resourceUri: upload.manifest.resourceUri,
        filePath: upload.filePath,
        name: upload.manifest.name,
        mime: upload.manifest.mime,
        ...(upload.manifest.declaredMime ? { declaredMime: upload.manifest.declaredMime } : {}),
        size: upload.manifest.size,
        sha256: upload.manifest.sha256,
      },
    };
  }

  async claim(input: UploadReadResourceInput) {
    this.validateManifest(input.resource);
    const upload = await this.resolve(input);
    return [
      {
        domain: this.claimDomain,
        identity: upload.manifest.resourceUri,
        access: AgentToolResourceAccessModes.Shared,
      },
    ];
  }

  private async resolve(input: UploadReadResourceInput): Promise<AgentResolvedUpload> {
    if (typeof input.value !== "string") {
      throw new TypeError(`Upload resource ${input.resource.Pointer} must be a string.`);
    }
    const upload = await this.uploads.resolve(input.value);
    if (!upload) throw new Error(`Upload resource was not found: ${input.value}`);
    return upload;
  }
}
