import { resolveAgentApplicationPaths, type AgentApplicationPaths } from "../Core/AgentApplicationPaths.js";
import { listDirectoryNamesSync } from "../Core/AgentFs.js";
import { isSamePath } from "../Core/AgentPath.js";
import { resolveAgentWorkspaceLayout, type AgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { AgentSecretEnvelopeCodec } from "./AgentSecretEnvelopeCodec.js";
import { AgentSecretKeyRing } from "./AgentSecretKeyRing.js";

/**
 * Secret domains keep separate master keys so one leaked key cannot open the other store. Each
 * entry names the deployment override, the envelope-wide authenticated data, and the key files
 * written by releases that kept one key per workspace.
 */
const AgentSecretDomainSpecs = {
  config: {
    keyEnvironmentVariable: "SENERA_CONFIG_SECRET_KEY",
    /**
     * Excludes mutable identity on purpose: an authenticated context built from a provider id or a
     * configuration path would strand the secrets attached to it as soon as that identity changes.
     */
    envelopeContext: "senera/config/secret",
    legacyKeyFiles: [
      (layout: AgentWorkspaceLayout) => layout.configSecretKey,
      (layout: AgentWorkspaceLayout) => layout.legacyConfigSecretKey,
    ],
  },
  credentials: {
    keyEnvironmentVariable: "SENERA_CREDENTIAL_SECRET_KEY",
    envelopeContext: "senera/mcp/secret",
    legacyKeyFiles: [(layout: AgentWorkspaceLayout) => layout.credentialSecretKey],
  },
} as const;

export type AgentSecretDomain = keyof typeof AgentSecretDomainSpecs;

export interface AgentSecretDomainOptions {
  /**
   * Workspace whose pre-keyring key material may still be needed. Omit it for host-global tools,
   * which have no workspace to recover and consult only the keyring.
   */
  workspaceRoot?: string;
  /** Host-owned key for embedders that keep secrets in an OS keystore. */
  key?: Buffer;
  environment?: NodeJS.ProcessEnv;
  /**
   * Host state owned by this deployment. It is the sole source of host-level pre-keyring paths,
   * preventing an embedded deployment with its own key directory from probing another host's data.
   */
  applicationPaths?: AgentApplicationPaths;
  keysRoot?: string;
}

export interface AgentSecretDomainHandle {
  readonly keyRing: AgentSecretKeyRing;
  readonly codec: AgentSecretEnvelopeCodec;
}

/** Master key for one domain, shared by every workspace on this host. */
export function createAgentSecretDomain(
  domain: AgentSecretDomain,
  options: AgentSecretDomainOptions,
): AgentSecretDomainHandle {
  const spec = AgentSecretDomainSpecs[domain];
  const keysRoot = resolveSecretKeysRoot(options);
  const applicationPaths = resolveLegacyApplicationPaths(options);
  const keyRing = new AgentSecretKeyRing({
    domain,
    keyEnvironmentVariable: spec.keyEnvironmentVariable,
    legacyKeyPaths: options.workspaceRoot
      ? resolveLegacyKeyPaths(spec.legacyKeyFiles, options.workspaceRoot, applicationPaths)
      : [],
    key: options.key,
    environment: options.environment,
    keysRoot,
  });
  return { keyRing, codec: new AgentSecretEnvelopeCodec({ keyRing, context: spec.envelopeContext }) };
}

/**
 * Releases before the keyring kept one key per workspace, first in the workspace itself and before
 * that in host-owned state under the application directory. Every one of those files is a candidate
 * so envelopes sealed by any of them stay readable; the keyring never writes to them.
 */
function resolveSecretKeysRoot(options: AgentSecretDomainOptions): string | undefined {
  if (!options.applicationPaths) return options.keysRoot;
  if (options.keysRoot && !isSamePath(options.keysRoot, options.applicationPaths.secretKeysRoot)) {
    throw new Error("Secret key directory must agree with the deployment application paths.");
  }
  return options.applicationPaths.secretKeysRoot;
}

function resolveLegacyApplicationPaths(options: AgentSecretDomainOptions): AgentApplicationPaths | undefined {
  if (options.applicationPaths) return options.applicationPaths;
  // An injected key or an explicit key directory defines a separate deployment boundary. Its
  // host-level legacy roots are intentionally unknown; only the selected workspace can be migrated.
  return options.keysRoot || options.key ? undefined : resolveAgentApplicationPaths();
}

function resolveLegacyKeyPaths(
  legacyKeyFiles: readonly ((layout: AgentWorkspaceLayout) => string)[],
  workspaceRoot: string,
  applicationPaths: AgentApplicationPaths | undefined,
): readonly string[] {
  const layouts = [
    resolveAgentWorkspaceLayout(workspaceRoot),
    ...(applicationPaths
      ? [
          resolveAgentWorkspaceLayout(applicationPaths.root),
          ...listDirectoryNamesSync(applicationPaths.legacyWorkspacesRoot).map((workspaceId) =>
            applicationPaths.legacyWorkspaceLayout(workspaceRoot, workspaceId),
          ),
        ]
      : []),
  ];
  return layouts.flatMap((layout) => legacyKeyFiles.map((keyFile) => keyFile(layout)));
}
