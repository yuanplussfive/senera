export const AgentRuntimeUpdateRoute = "/api/runtime-update" as const;
export const AgentRuntimeUpdateSchemaVersion = 1 as const;

export const AgentRuntimeUpdateDeployments = {
  Local: "local",
  Container: "container",
} as const;

export type AgentRuntimeUpdateDeployment =
  (typeof AgentRuntimeUpdateDeployments)[keyof typeof AgentRuntimeUpdateDeployments];

export const AgentRuntimeUpdateStatuses = {
  NotConfigured: "not-configured",
  Checking: "checking",
  UpToDate: "up-to-date",
  Available: "available",
  Unavailable: "unavailable",
} as const;

export type AgentRuntimeUpdateStatus = (typeof AgentRuntimeUpdateStatuses)[keyof typeof AgentRuntimeUpdateStatuses];

export const AgentRuntimeUpdateFailureCodes = {
  InvalidManifest: "invalid_manifest",
  NotPublished: "not_published",
  RedirectRejected: "redirect_rejected",
  RequestFailed: "request_failed",
} as const;

export type AgentRuntimeUpdateFailureCode =
  (typeof AgentRuntimeUpdateFailureCodes)[keyof typeof AgentRuntimeUpdateFailureCodes];

export interface AgentRuntimeUpdateDiagnostic {
  code: AgentRuntimeUpdateFailureCode;
}

export interface AgentRuntimeUpdateDesktopArtifact {
  installerUrl: string;
  installerSha256: string;
  installerSize: number;
  metadataUrl: string;
  blockmapUrl: string;
}

export interface AgentRuntimeUpdateManifest {
  schemaVersion: typeof AgentRuntimeUpdateSchemaVersion;
  product: "senera";
  version: string;
  tag: string;
  releaseName: string;
  releaseUrl: string;
  publishedAt?: string;
  sourceSha?: string;
  desktop?: AgentRuntimeUpdateDesktopArtifact;
  container?: {
    image: string;
    versionTag: string;
    latestTag: string;
  };
}

export interface AgentRuntimeUpdateStatusResponse {
  schemaVersion: typeof AgentRuntimeUpdateSchemaVersion;
  currentVersion: string;
  deployment: AgentRuntimeUpdateDeployment;
  status: AgentRuntimeUpdateStatus;
  latest?: Pick<AgentRuntimeUpdateManifest, "version" | "tag" | "releaseName" | "releaseUrl" | "publishedAt">;
  action: "none" | "reload" | "operator";
  diagnostic?: AgentRuntimeUpdateDiagnostic;
  checkedAt?: string;
}
