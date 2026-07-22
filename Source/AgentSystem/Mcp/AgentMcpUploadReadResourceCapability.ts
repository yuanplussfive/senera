import { z } from "zod";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { ToolResourceArgumentManifest } from "../Types/PluginToolManifestTypes.js";
import type { AgentMcpResourceCapability } from "./AgentMcpResourceCapabilityRegistry.js";
import { AgentMcpResourceCapabilityIds } from "./AgentMcpResourceCapabilityIds.js";

const UploadReadParametersSchema = z.object({}).strict();
const BindingSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/u, "Upload resource binding must be an identifier.");

export class AgentMcpUploadReadResourceCapability implements AgentMcpResourceCapability {
  readonly id = AgentMcpResourceCapabilityIds.UploadRead;

  constructor(private readonly uploads: Pick<AgentUploadStore, "resolve">) {}

  async project(input: {
    resource: ToolResourceArgumentManifest;
    value: unknown;
    args: Readonly<Record<string, unknown>>;
  }) {
    if (typeof input.value !== "string") {
      throw new TypeError(`MCP upload resource ${input.resource.Pointer} must be a string.`);
    }
    UploadReadParametersSchema.parse(input.resource.Parameters ?? {});
    const binding = BindingSchema.parse(input.resource.Binding);
    const upload = await this.uploads.resolve(input.value);
    if (!upload) throw new Error(`MCP upload resource was not found: ${input.value}`);
    return {
      target: "resource" as const,
      binding,
      value: {
        uploadUri: upload.manifest.uploadUri,
        filePath: upload.filePath,
        name: upload.manifest.name,
        mime: upload.manifest.mime,
        ...(upload.manifest.declaredMime ? { declaredMime: upload.manifest.declaredMime } : {}),
        size: upload.manifest.size,
        sha256: upload.manifest.sha256,
      },
    };
  }
}
