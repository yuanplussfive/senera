import { z } from "zod";
import { AgentResourceUriContract } from "./AgentResourceContract.js";

const CanonicalResourceUriPattern = new RegExp(
  `^${escapeRegExp(AgentResourceUriContract.Protocol)}//${escapeRegExp(AgentResourceUriContract.Authority)}/${AgentResourceUriContract.ResourceIdPattern}$`,
  "u",
);

/** JSON-Schema-compatible validation for the only supported Senera resource URI form. */
export const AgentResourceUriSchema = z
  .string()
  .regex(CanonicalResourceUriPattern, "Expected a canonical Senera resource URI.");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
