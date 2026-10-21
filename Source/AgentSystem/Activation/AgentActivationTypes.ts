import { z } from "zod";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";

/** The only things a user can explicitly pin from the composer. */
export const AgentActivationKinds = ["skill", "plugin", "mcp", "system"] as const;
export type AgentActivationKind = (typeof AgentActivationKinds)[number];

export interface AgentExplicitActivationReference {
  readonly kind: AgentActivationKind;
  readonly id: string;
  readonly revision: string;
}

export interface AgentExplicitActivationSet {
  readonly catalogRevision: string;
  readonly explicit: readonly AgentExplicitActivationReference[];
}

export const AgentExplicitActivationReferenceSchema = z
  .object({
    kind: z.enum(AgentActivationKinds),
    id: z.string().trim().min(1).max(160),
    revision: z.string().trim().min(1).max(160),
  })
  .strict();

export const AgentExplicitActivationSetSchema = z
  .object({
    catalogRevision: z.string().trim().min(1).max(256),
    explicit: z.array(AgentExplicitActivationReferenceSchema).max(32),
  })
  .strict();

export interface AgentActivationCatalogEntry {
  readonly kind: AgentActivationKind;
  readonly id: string;
  readonly revision: string;
  readonly title: string;
  readonly description: string;
  /** Optional localized presentation text for clients that have a locale context. */
  readonly localizedTitle?: AgentExtensionLocalizedText;
  readonly localizedDescription?: AgentExtensionLocalizedText;
  /** Optional semantic icon name resolved by the frontend's shared icon adapter. */
  readonly icon?: string;
  readonly enabled: boolean;
  readonly selectable: boolean;
  readonly source?: string;
}

/** Projection data for an activation entry whose kind is supplied by the catalog owner. */
export type AgentActivationCatalogEntryData = Omit<AgentActivationCatalogEntry, "kind">;

export interface AgentActivationCatalogSnapshot {
  readonly revision: string;
  readonly entries: readonly AgentActivationCatalogEntry[];
}

export function normalizeAgentExplicitActivations(
  activations: AgentExplicitActivationSet | undefined,
): AgentExplicitActivationSet | undefined {
  if (!activations) return undefined;
  const catalogRevision = activations.catalogRevision.trim();
  if (!catalogRevision) throw new Error("Explicit activations require a catalog revision.");
  const seen = new Map<string, AgentExplicitActivationReference>();
  for (const entry of activations.explicit) {
    const id = entry.id.trim();
    const revision = entry.revision.trim();
    if (!id || !revision) throw new Error("Explicit activation references must have an id and revision.");
    const key = `${entry.kind}:${id}`;
    const previous = seen.get(key);
    if (previous && previous.revision !== revision) {
      throw new Error(`Explicit activation ${key} has conflicting revisions.`);
    }
    seen.set(key, { kind: entry.kind, id, revision });
  }
  return {
    catalogRevision,
    explicit: [...seen.values()],
  };
}

export function agentExplicitActivationDigest(activations: AgentExplicitActivationSet | undefined): string {
  return sha256HexOfCanonicalJson(activations ?? null);
}
