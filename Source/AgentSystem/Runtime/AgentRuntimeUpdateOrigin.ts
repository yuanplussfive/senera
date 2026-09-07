export interface AgentRuntimeUpdateOriginDefinition {
  readonly repositoryUrl: string;
  readonly manifestUrl?: string;
  readonly desktopFeedUrl?: string;
  readonly releaseUrlTemplate?: string;
  readonly releaseAssetUrlTemplate?: string;
  /**
   * Hosts that release assets may redirect to. The configured repository host
   * is always trusted automatically; additional entries cover GitHub asset CDNs.
   */
  readonly trustedRedirectHosts?: readonly string[];
}

export interface AgentRuntimeUpdateOrigin {
  readonly repositoryUrl: string;
  readonly manifestUrl: string;
  readonly desktopFeedUrl: string;
  readonly trustedRedirectHosts: readonly string[];
  releaseUrl(tag: string): string;
  releaseAssetUrl(tag: string, assetName: string): string;
}

export function createAgentRuntimeUpdateOrigin(
  definition: AgentRuntimeUpdateOriginDefinition,
): AgentRuntimeUpdateOrigin {
  const repository = normalizeRepositoryUrl(definition.repositoryUrl);
  const repositoryUrl = repository.toString().replace(/\/$/u, "");
  const trustedRedirectHosts = normalizeTrustedHosts(repository.hostname, definition.trustedRedirectHosts);
  const desktopFeedUrl = normalizeAbsoluteUrl(
    definition.desktopFeedUrl ?? `${repositoryUrl}/releases/latest/download`,
    "Runtime update desktop feed URL",
  );
  const manifestUrl = normalizeAbsoluteUrl(
    definition.manifestUrl ?? `${desktopFeedUrl}/senera-update.json`,
    "Runtime update manifest URL",
  );
  const releaseUrlTemplate = normalizeUrlTemplate(
    definition.releaseUrlTemplate ?? `${repositoryUrl}/releases/tag/{tag}`,
    "Runtime update release URL template",
    ["tag"],
  );
  const releaseAssetUrlTemplate = normalizeUrlTemplate(
    definition.releaseAssetUrlTemplate ?? `${repositoryUrl}/releases/download/{tag}/{asset}`,
    "Runtime update release asset URL template",
    ["asset"],
  );

  return Object.freeze({
    repositoryUrl,
    manifestUrl,
    desktopFeedUrl,
    trustedRedirectHosts,
    releaseUrl: (tag: string): string => renderUrlTemplate(releaseUrlTemplate, { tag }),
    releaseAssetUrl: (tag: string, assetName: string): string =>
      renderUrlTemplate(releaseAssetUrlTemplate, { tag, asset: assetName }),
  } satisfies AgentRuntimeUpdateOrigin);
}

function normalizeRepositoryUrl(value: string): URL {
  const text = requireText(value, "Runtime update repository URL").replace(/\.git$/u, "");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new TypeError("Runtime update repository URL must be an absolute HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new TypeError("Runtime update repository URL must be a plain HTTPS URL.");
  }
  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (pathSegments.length < 2) {
    throw new TypeError("Runtime update repository URL must identify an owner and repository.");
  }
  url.pathname = `/${pathSegments.map(encodeURIComponent).join("/")}`;
  return url;
}

function normalizeAbsoluteUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new TypeError(`${label} must be a plain HTTPS URL.`);
  }
  return url.toString().replace(/\/$/u, "");
}

function normalizeUrlTemplate(value: string, label: string, requiredVariables: readonly string[]): string {
  const variables = new Set(value.match(/\{[a-z]+\}/gu)?.map((item) => item.slice(1, -1)) ?? []);
  if (![...variables].every((variable) => variable === "tag" || variable === "asset")) {
    throw new TypeError(`${label} contains an unsupported placeholder.`);
  }
  if (!requiredVariables.every((variable) => variables.has(variable))) {
    throw new TypeError(`${label} is missing a required placeholder.`);
  }
  const probe = value.replace(/\{(?:tag|asset)\}/gu, "placeholder");
  normalizeAbsoluteUrl(probe, label);
  return value;
}

function renderUrlTemplate(template: string, values: { tag: string; asset?: string }): string {
  const rendered = template
    .replace(/\{tag\}/gu, encodePathSegment(values.tag, "release tag"))
    .replace(/\{asset\}/gu, () => encodePathSegment(values.asset ?? "", "release asset name"));
  return normalizeAbsoluteUrl(rendered, "Rendered runtime update URL");
}

function normalizeTrustedHosts(repositoryHost: string, values: readonly string[] | undefined): readonly string[] {
  const hosts = new Set<string>([normalizeHost(repositoryHost)]);
  for (const value of values ?? []) hosts.add(normalizeHost(value));
  return Object.freeze([...hosts].sort());
}

function normalizeHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!host || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(host) || host.includes("..")) {
    throw new TypeError(`Trusted update redirect host is invalid: ${value}`);
  }
  return host;
}

function encodePathSegment(value: string, label: string): string {
  const text = requireText(value, label);
  if (text.includes("/") || text.includes("\\")) {
    throw new TypeError(`${label} must not contain a path separator.`);
  }
  return encodeURIComponent(text);
}

function requireText(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}
