import { z } from "zod";

export const AgentClientExtensionProtocol = 1;
export const AgentClientExtensionManifestFile = "client-extension.json";
export const AgentClientExtensionLimits = {
  archiveBytes: 256 * 1024 * 1024,
  manifestBytes: 1024 * 1024,
  fileCount: 20_000,
  expandedBytes: 512 * 1024 * 1024,
} as const;

export function isClientExtensionPath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !/[\\:<>"|?*\p{Cc}]/u.test(value) &&
    value
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          !/[. ]$/u.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  );
}

export const AgentClientExtensionDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const AssetPath = z.string().refine(isClientExtensionPath, "Invalid client extension asset path.");

export const AgentClientExtensionManifestSchema = z
  .object({
    protocol: z.literal(AgentClientExtensionProtocol),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u),
    revision: AgentClientExtensionDigestSchema,
    entry: AssetPath,
    source: z
      .object({ url: z.url(), sha256: AgentClientExtensionDigestSchema, bytes: z.number().int().positive() })
      .strict(),
    files: z
      .array(
        z
          .object({ path: AssetPath, bytes: z.number().int().nonnegative(), sha256: AgentClientExtensionDigestSchema })
          .strict(),
      )
      .min(1)
      .max(AgentClientExtensionLimits.fileCount),
  })
  .strict()
  .superRefine((manifest, context) => {
    const paths = new Set(manifest.files.map((file) => file.path.toLowerCase()));
    if (paths.size !== manifest.files.length)
      context.addIssue({ code: "custom", message: "Duplicate extension asset paths." });
    if (!manifest.files.some((file) => file.path === manifest.entry))
      context.addIssue({ code: "custom", message: "The extension entry is not declared." });
    if (manifest.files.reduce((total, file) => total + file.bytes, 0) > AgentClientExtensionLimits.expandedBytes)
      context.addIssue({ code: "custom", message: "The client extension is too large." });
    if (!URL.canParse(manifest.source.url)) return;
    const source = new URL(manifest.source.url);
    if (source.protocol !== "https:" || source.username || source.password)
      context.addIssue({ code: "custom", message: "Corresponding source requires an HTTPS download URL." });
  });

export type AgentClientExtensionManifest = z.infer<typeof AgentClientExtensionManifestSchema>;

export const AgentClientExtensionStatusSchema = z.discriminatedUnion("installed", [
  z.object({
    id: z.string(),
    installed: z.literal(false),
    manifest: z.undefined().optional(),
    releaseAvailable: z.boolean().optional(),
  }),
  z.object({
    id: z.string(),
    installed: z.literal(true),
    manifest: AgentClientExtensionManifestSchema,
    releaseAvailable: z.boolean().optional(),
  }),
]);

export type AgentClientExtensionStatus = z.infer<typeof AgentClientExtensionStatusSchema>;
