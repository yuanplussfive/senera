import { describe, expect, test, vi } from "vitest";
import { verifyProductReleaseSource } from "../../VerifyProductReleaseSource.js";

const ReleaseSha = "1".repeat(40);
const TriggerSha = "2".repeat(40);

describe("product release source verification", () => {
  test("accepts the exact successfully verified trigger as the release source", async () => {
    const fetchImplementation = createGitHubApi({ includeSuccessfulRun: true });

    await verifyProductReleaseSource(
      verificationOptions(fetchImplementation, { releaseSha: ReleaseSha, triggerSha: ReleaseSha }),
    );

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const runsUrl = new URL(String(fetchImplementation.mock.calls[0]?.[0]));
    expect(Object.fromEntries(runsUrl.searchParams)).toEqual({
      branch: "main",
      event: "push",
      head_sha: ReleaseSha,
      status: "success",
      per_page: "1",
    });
  });

  test("rejects an ancestor release source that was not the verified trigger", async () => {
    const fetchImplementation = createGitHubApi({ includeSuccessfulRun: true });

    await expect(verifyProductReleaseSource(verificationOptions(fetchImplementation))).rejects.toThrow(
      "release artifacts must be built from the exact verified commit",
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test("rejects a release source without a successful main push verification", async () => {
    const fetchImplementation = createGitHubApi({ includeSuccessfulRun: false });

    await expect(
      verifyProductReleaseSource(
        verificationOptions(fetchImplementation, { releaseSha: ReleaseSha, triggerSha: ReleaseSha }),
      ),
    ).rejects.toThrow(`Release source ${ReleaseSha} has no successful verify.yml push run on main.`);
  });

  test("manual recovery still requires source verification without a trigger comparison", async () => {
    const fetchImplementation = createGitHubApi({ includeSuccessfulRun: true });

    await verifyProductReleaseSource({ ...verificationOptions(fetchImplementation), triggerSha: undefined });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain("/actions/workflows/verify.yml/runs?");
  });
});

function verificationOptions(
  fetchImplementation: typeof globalThis.fetch,
  overrides: Partial<{ releaseSha: string; triggerSha: string }> = {},
) {
  return {
    repository: "yuanplussfive/senera",
    releaseSha: overrides.releaseSha ?? ReleaseSha,
    releaseBranch: "main",
    triggerSha: overrides.triggerSha ?? TriggerSha,
    verificationWorkflow: "verify.yml",
    token: "test-token",
    fetch: fetchImplementation,
  };
}

function createGitHubApi(options: { includeSuccessfulRun: boolean }) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/actions/workflows/verify.yml/runs")) {
      return Response.json({
        workflow_runs: options.includeSuccessfulRun
          ? [
              {
                id: 1,
                event: "push",
                head_branch: "main",
                head_sha: ReleaseSha,
                conclusion: "success",
              },
            ]
          : [],
      });
    }
    throw new Error(`Unexpected GitHub API URL: ${url.href}`);
  });
}
