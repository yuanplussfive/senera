import { z } from "zod";
import { isAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";
import { AgentExtensionNameSchema } from "../Extensions/AgentExtensionIdentity.js";
import { AgentExtensionLocalizedTextSchema } from "../Extensions/AgentExtensionLocalization.js";
import {
  AgentToolPresentationIconNames,
  type AgentToolPresentation,
  type AgentToolPresentationOverride,
} from "../Types/AgentToolPresentationTypes.js";

const JsonPointerPatternSchema = z.string().refine(isAgentJsonPointer, "Expected an RFC 6901 JSON Pointer pattern.");

const AgentToolPresentationGroupSchema = z
  .object({
    id: AgentExtensionNameSchema,
    title: AgentExtensionLocalizedTextSchema,
  })
  .strict();

const AgentToolPresentationActivitySchema = z
  .object({
    action: AgentExtensionLocalizedTextSchema,
    invocationName: AgentExtensionLocalizedTextSchema.optional(),
    argumentPath: JsonPointerPatternSchema.optional(),
    detailPaths: z.array(JsonPointerPatternSchema).max(16).optional(),
  })
  .strict();

export const AgentSystemToolPresentationSchema = z
  .object({
    category: AgentExtensionNameSchema,
    icon: z.enum(AgentToolPresentationIconNames),
    group: AgentToolPresentationGroupSchema,
    activity: AgentToolPresentationActivitySchema,
  })
  .strict();

export const AgentSystemToolPresentationOverrideSchema = z
  .object({
    category: AgentExtensionNameSchema.optional(),
    icon: z.enum(AgentToolPresentationIconNames).optional(),
    group: AgentToolPresentationGroupSchema.partial().optional(),
    activity: AgentToolPresentationActivitySchema.partial().optional(),
  })
  .strict();

/**
 * A domain supplies a complete presentation. Extension and Tool-level
 * declarations refine it explicitly, keeping filesystem location out of the
 * runtime decision while still making package ownership obvious on disk.
 */
export function resolveAgentSystemToolPresentation(
  domain: AgentToolPresentation,
  ...overrides: readonly (AgentToolPresentationOverride | undefined)[]
): AgentToolPresentation {
  const merged = overrides.reduce<AgentToolPresentation>((current, override) => {
    if (!override) return current;
    return {
      category: override.category ?? current.category,
      icon: override.icon ?? current.icon,
      group: { ...current.group, ...override.group },
      activity: { ...current.activity, ...override.activity },
    };
  }, domain);
  return AgentSystemToolPresentationSchema.parse(merged) as AgentToolPresentation;
}
