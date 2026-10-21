import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseJsonText } from "./AgentJsonParsing.js";
import {
  createAgentRuntimeUpdateOrigin,
  type AgentRuntimeUpdateOrigin,
  type AgentRuntimeUpdateOriginDefinition,
} from "../Runtime/AgentRuntimeUpdateOrigin.js";

const AgentProductUpdateOriginSchema = z
  .object({
    repositoryUrl: z.string().trim().url(),
    manifestUrl: z.string().trim().url().optional(),
    desktopFeedUrl: z.string().trim().url().optional(),
    releaseUrlTemplate: z.string().trim().min(1).optional(),
    releaseAssetUrlTemplate: z.string().trim().min(1).optional(),
    trustedRedirectHosts: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const AgentProductDistributionSchema = z
  .object({
    update: AgentProductUpdateOriginSchema.optional(),
    containerImage: z.string().trim().min(1).optional(),
  })
  .strict();

const AgentProductMetadataSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    repository: z
      .union([z.string(), z.object({ type: z.string().optional(), url: z.string() }).passthrough()])
      .optional(),
    senera: AgentProductDistributionSchema.optional(),
  })
  .passthrough();

export interface AgentProductMetadata {
  version: string;
  updateOrigin?: AgentRuntimeUpdateOrigin;
  containerImage?: string;
}

export function readAgentProductMetadata(resourceRoot: string): AgentProductMetadata {
  const packagePath = path.join(resourceRoot, "package.json");
  const metadata = AgentProductMetadataSchema.parse(
    parseJsonText(fs.readFileSync(packagePath, "utf8"), "package.json"),
  );
  const repositoryUrl = typeof metadata.repository === "string" ? metadata.repository : metadata.repository?.url;
  const updateOrigin = readProductUpdateOrigin(metadata.senera?.update, repositoryUrl);
  return {
    version: metadata.version,
    ...(updateOrigin ? { updateOrigin } : {}),
    ...(metadata.senera?.containerImage ? { containerImage: metadata.senera.containerImage } : {}),
  };
}

function readProductUpdateOrigin(
  configured: z.infer<typeof AgentProductDistributionSchema>["update"] | undefined,
  repositoryUrl: string | undefined,
): AgentRuntimeUpdateOrigin | undefined {
  if (configured) {
    return createAgentRuntimeUpdateOrigin(createOriginDefinition(configured));
  }

  const githubOrigin = createLegacyGitHubOrigin(repositoryUrl);
  return githubOrigin ? createAgentRuntimeUpdateOrigin(githubOrigin) : undefined;
}

function createOriginDefinition(
  source: z.infer<typeof AgentProductUpdateOriginSchema>,
): AgentRuntimeUpdateOriginDefinition {
  return {
    repositoryUrl: source.repositoryUrl,
    ...(source.manifestUrl ? { manifestUrl: source.manifestUrl } : {}),
    ...(source.desktopFeedUrl ? { desktopFeedUrl: source.desktopFeedUrl } : {}),
    ...(source.releaseUrlTemplate ? { releaseUrlTemplate: source.releaseUrlTemplate } : {}),
    ...(source.releaseAssetUrlTemplate ? { releaseAssetUrlTemplate: source.releaseAssetUrlTemplate } : {}),
    ...(source.trustedRedirectHosts ? { trustedRedirectHosts: source.trustedRedirectHosts } : {}),
  };
}

function createLegacyGitHubOrigin(repositoryUrl: string | undefined): AgentRuntimeUpdateOriginDefinition | undefined {
  if (!repositoryUrl) return undefined;
  try {
    const url = new URL(repositoryUrl.replace(/^git\+/u, ""));
    if (url.hostname !== "github.com") return undefined;
    const segments = url.pathname
      .replace(/\.git$/u, "")
      .split("/")
      .filter(Boolean);
    if (segments.length !== 2) return undefined;
    return {
      repositoryUrl: `https://github.com/${segments[0]}/${segments[1]}`,
      trustedRedirectHosts: ["objects.githubusercontent.com", "release-assets.githubusercontent.com"],
    };
  } catch {
    return undefined;
  }
}
