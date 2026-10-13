import { z } from "zod";
import { AgentExtensionNameSchema } from "../Extensions/AgentExtensionIdentity.js";
import { AgentExtensionLocalizedTextSchema } from "../Extensions/AgentExtensionLocalization.js";
import { AgentSystemToolPresentationSchema } from "./AgentSystemToolPresentation.js";

export const AgentSystemExtensionDomainManifestFileName = "domain.json";

/**
 * A domain is an authoring boundary for first-party System extensions. Its
 * presentation is the default for every package it contains; extension and
 * Tool manifests can narrow it without introducing frontend name matching.
 */
export const AgentSystemExtensionDomainManifestSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(1),
    id: AgentExtensionNameSchema,
    displayName: AgentExtensionLocalizedTextSchema,
    description: AgentExtensionLocalizedTextSchema,
    presentation: AgentSystemToolPresentationSchema,
  })
  .strict();

export type AgentSystemExtensionDomainManifest = z.infer<typeof AgentSystemExtensionDomainManifestSchema>;
