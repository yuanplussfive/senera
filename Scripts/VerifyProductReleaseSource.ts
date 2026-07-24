import { z } from "zod";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";

const CommitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const RepositorySchema = z.string().regex(/^[^/\s]+\/[^/\s]+$/u);
const WorkflowRunsSchema = z
  .object({
    workflow_runs: z.array(
      z
        .object({
          id: z.number().int().positive(),
          event: z.string(),
          head_branch: z.string().nullable(),
          head_sha: CommitShaSchema,
          conclusion: z.string().nullable(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const RuntimeEnvironmentSchema = z.object({
  GITHUB_TOKEN: z.string().trim().min(1),
  GITHUB_REPOSITORY: RepositorySchema,
  SENERA_RELEASE_SHA: CommitShaSchema,
  SENERA_RELEASE_BRANCH: z.string().trim().min(1),
  SENERA_RELEASE_TRIGGER_SHA: z.string().optional(),
  SENERA_VERIFY_WORKFLOW: z.string().trim().min(1),
});

export interface ProductReleaseSourceVerificationOptions {
  readonly repository: string;
  readonly releaseSha: string;
  readonly releaseBranch: string;
  readonly triggerSha?: string;
  readonly verificationWorkflow: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiBaseUrl?: string;
}

if (isMainModule(import.meta.url)) {
  const environment = RuntimeEnvironmentSchema.parse(process.env);
  await verifyProductReleaseSource({
    repository: environment.GITHUB_REPOSITORY,
    releaseSha: environment.SENERA_RELEASE_SHA,
    releaseBranch: environment.SENERA_RELEASE_BRANCH,
    triggerSha: normalizeOptionalSha(environment.SENERA_RELEASE_TRIGGER_SHA),
    verificationWorkflow: environment.SENERA_VERIFY_WORKFLOW,
    token: environment.GITHUB_TOKEN,
  });
  process.stdout.write(`Verified product release source ${environment.SENERA_RELEASE_SHA}.\n`);
}

export async function verifyProductReleaseSource(options: ProductReleaseSourceVerificationOptions): Promise<void> {
  const repository = RepositorySchema.parse(options.repository);
  const releaseSha = CommitShaSchema.parse(options.releaseSha);
  const triggerSha = options.triggerSha ? CommitShaSchema.parse(options.triggerSha) : undefined;
  const releaseBranch = z.string().trim().min(1).parse(options.releaseBranch);
  const verificationWorkflow = z.string().trim().min(1).parse(options.verificationWorkflow);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const repositoryUrl = githubRepositoryApiUrl(options.apiBaseUrl, repository);

  if (triggerSha && releaseSha !== triggerSha) {
    throw new Error(
      `Release source ${releaseSha} does not match triggering verification ${triggerSha}; release artifacts must be built from the exact verified commit.`,
    );
  }

  const runsUrl = new URL(`actions/workflows/${encodeURIComponent(verificationWorkflow)}/runs`, repositoryUrl);
  runsUrl.searchParams.set("branch", releaseBranch);
  runsUrl.searchParams.set("event", "push");
  runsUrl.searchParams.set("head_sha", releaseSha);
  runsUrl.searchParams.set("status", "success");
  runsUrl.searchParams.set("per_page", "1");
  const runs = await fetchGitHubJson(runsUrl, WorkflowRunsSchema, options.token, fetchImplementation);
  const verified = runs.workflow_runs.some(
    (run) =>
      run.head_sha === releaseSha &&
      run.head_branch === releaseBranch &&
      run.event === "push" &&
      run.conclusion === "success",
  );
  if (!verified) {
    throw new Error(
      `Release source ${releaseSha} has no successful ${verificationWorkflow} push run on ${releaseBranch}.`,
    );
  }
}

async function fetchGitHubJson<T>(
  url: URL,
  schema: z.ZodType<T>,
  token: string,
  fetchImplementation: typeof globalThis.fetch,
): Promise<T> {
  const response = await fetchImplementation(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${z.string().trim().min(1).parse(token)}`,
      "User-Agent": "senera-release-source-verifier",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub release verification request failed: ${response.status} ${url.pathname}.`);
  }
  return schema.parse(await response.json());
}

function githubRepositoryApiUrl(apiBaseUrl: string | undefined, repository: string): URL {
  const [owner, name] = repository.split("/");
  const baseUrl = new URL(apiBaseUrl ?? "https://api.github.com/");
  if (baseUrl.protocol !== "https:") throw new Error("GitHub API base URL must use HTTPS.");
  return new URL(`repos/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}/`, ensureTrailingSlash(baseUrl));
}

function ensureTrailingSlash(url: URL): URL {
  const result = new URL(url);
  if (!result.pathname.endsWith("/")) result.pathname += "/";
  return result;
}

function normalizeOptionalSha(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? CommitShaSchema.parse(normalized) : undefined;
}
