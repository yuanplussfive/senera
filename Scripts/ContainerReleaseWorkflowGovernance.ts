const ReleaseWorkflowLabel = ".github/workflows/release.yml";

export function inspectContainerReleasePipeline(workflow: string): string[] {
  const sandboxJob = workflowJobBlock(workflow, "sandbox-archive");
  const desktopJob = workflowJobBlock(workflow, "desktop");
  const buildJob = workflowJobBlock(workflow, "container-build");
  const sandboxRuntimeBuildJob = workflowJobBlock(workflow, "sandbox-runtime-build");
  const smokeJob = workflowJobBlock(workflow, "container-smoke");
  const publishJob = workflowJobBlock(workflow, "container");
  const violations: string[] = [];

  if (!sandboxJob) {
    violations.push(`${ReleaseWorkflowLabel} must define the sandbox-archive job.`);
  } else {
    violations.push(
      ...inspectTextIncludes(sandboxJob, `${ReleaseWorkflowLabel} job sandbox-archive`, [
        "./.github/actions/build-sandbox-bundle",
        "actions/upload-artifact@v4",
      ]),
    );
    if (sandboxJob.includes("gh release upload")) {
      violations.push(`${ReleaseWorkflowLabel} job sandbox-archive must remain an internal build artifact.`);
    }
  }

  if (!desktopJob) {
    violations.push(`${ReleaseWorkflowLabel} must define the desktop job.`);
  } else {
    violations.push(
      ...inspectTextIncludes(desktopJob, `${ReleaseWorkflowLabel} job desktop`, [
        "- sandbox-archive",
        "actions/download-artifact@v4",
        "path: Release/SandboxImage",
      ]),
    );
  }

  if (!buildJob) {
    violations.push(`${ReleaseWorkflowLabel} must define the container-build job.`);
  } else {
    violations.push(
      ...inspectTextIncludes(buildJob, `${ReleaseWorkflowLabel} job container-build`, [
        "timeout-minutes: 20",
        "digest: ${{ steps.build.outputs.digest }}",
        "type=raw,value=sha-${{ needs.metadata.outputs.source_sha }}",
        "push: true",
        "pull: true",
        "cache-from: type=gha,scope=senera-release-container",
        "cache-to: type=gha,mode=max,scope=senera-release-container,ignore-error=true",
      ]),
    );
    if (buildJob.includes("type=raw,value=latest")) {
      violations.push(
        `${ReleaseWorkflowLabel} job container-build must not publish a stable latest tag before smoke verification.`,
      );
    }
    if (buildJob.includes("sandbox-archive") || buildJob.includes("Release/SandboxImage")) {
      violations.push(`${ReleaseWorkflowLabel} job container-build must not consume the Microsandbox archive.`);
    }
  }

  if (!sandboxRuntimeBuildJob) {
    violations.push(`${ReleaseWorkflowLabel} must define the sandbox-runtime-build job.`);
  } else {
    violations.push(
      ...inspectTextIncludes(sandboxRuntimeBuildJob, `${ReleaseWorkflowLabel} job sandbox-runtime-build`, [
        "Dockerfile.sandbox",
        "SENERA_SANDBOX_SOURCE_IMAGE=${{ needs.metadata.outputs.sandbox_runtime_source_image }}",
        "SENERA_SANDBOX_DISTRIBUTION_ID=${{ needs.metadata.outputs.sandbox_runtime_distribution_id }}",
        "SENERA_SANDBOX_DISTRIBUTION_VERSION=${{ needs.metadata.outputs.sandbox_runtime_version_tag }}",
        "SENERA_SANDBOX_TARGET=${{ needs.metadata.outputs.sandbox_runtime_target }}",
        "ghcr.io/${{ github.repository_owner }}/senera",
        "type=raw,value=sandbox-runtime-sha-${{ needs.metadata.outputs.source_sha }}",
        "digest: ${{ steps.build.outputs.digest }}",
        "push: true",
        "pull: true",
      ]),
    );
    if (sandboxRuntimeBuildJob.includes("type=raw,value=latest")) {
      violations.push(
        `${ReleaseWorkflowLabel} job sandbox-runtime-build must not publish stable tags before smoke verification.`,
      );
    }
  }

  if (!smokeJob) {
    violations.push(`${ReleaseWorkflowLabel} must define the container-smoke job.`);
  } else {
    violations.push(
      ...inspectTextIncludes(smokeJob, `${ReleaseWorkflowLabel} job container-smoke`, [
        "- container-build",
        "- sandbox-runtime-build",
        "needs.sandbox-runtime-build.result == 'success'",
        "timeout-minutes: 10",
        "CONTAINER_HEALTH_TIMEOUT_SECONDS: 180",
        "needs.container-build.outputs.reference }}@${{ needs.container-build.outputs.digest",
        "actions/checkout@v4",
        "./.github/actions/setup-gvisor",
        'docker pull "$IMAGE"',
        'docker tag "$IMAGE" ghcr.io/yuanplussfive/senera:latest',
        'docker pull "$SANDBOX_IMAGE"',
        "SANDBOX_TARGET_IMAGE: ghcr.io/${{ github.repository_owner }}/senera:sandbox-runtime-${{ needs.metadata.outputs.sandbox_runtime_version_tag }}",
        'docker tag "$SANDBOX_IMAGE" "$SANDBOX_TARGET_IMAGE"',
        'docker compose up --detach --wait --wait-timeout "$CONTAINER_HEALTH_TIMEOUT_SECONDS" --pull never',
        'container_id="$(docker compose ps --quiet senera)"',
        'runtime_uid="$(docker exec "$container_id"',
        "docker compose down --volumes --remove-orphans",
        "docker compose exec -T --user node senera node Dist/Scripts/VerifyDockerNativeSqlite.js",
        "docker compose exec -T --user node senera node Dist/Scripts/VerifyDockerUserPluginWrite.js",
      ]),
    );
    if (smokeJob.includes("/dev/kvm") || smokeJob.includes("NET_ADMIN")) {
      violations.push(`${ReleaseWorkflowLabel} job container-smoke must not require KVM or NET_ADMIN.`);
    }
    if (smokeJob.includes("docker/build-push-action")) {
      violations.push(
        `${ReleaseWorkflowLabel} job container-smoke must test the built digest without rebuilding the image.`,
      );
    }
  }

  if (!publishJob) {
    violations.push(`${ReleaseWorkflowLabel} must define the container publish job.`);
  } else {
    violations.push(
      ...inspectTextIncludes(publishJob, `${ReleaseWorkflowLabel} job container`, [
        "- container-build",
        "- sandbox-runtime-build",
        "- container-smoke",
        "type=raw,value=${{ needs.metadata.outputs.container_version_tag }}",
        "type=raw,value=${{ needs.metadata.outputs.container_minor_tag }}",
        "type=raw,value=latest",
        "needs.container-build.outputs.reference }}@${{ needs.container-build.outputs.digest",
        "needs.sandbox-runtime-build.outputs.reference }}@${{ needs.sandbox-runtime-build.outputs.digest",
        "sandbox_runtime_version_tag",
        "type=raw,value=sandbox-runtime-${{ needs.metadata.outputs.sandbox_runtime_version_tag }}",
        "type=raw,value=sandbox-runtime-latest",
        'docker buildx imagetools create "${tag_arguments[@]}" "$SOURCE_IMAGE"',
      ]),
    );
    if (publishJob.includes("docker/build-push-action")) {
      violations.push(
        `${ReleaseWorkflowLabel} job container must promote the verified digest without rebuilding the image.`,
      );
    }
  }

  const buildActionCount = workflow.match(/docker\/build-push-action@v6/gu)?.length ?? 0;
  if (buildActionCount !== 2) {
    violations.push(
      `${ReleaseWorkflowLabel} must build the application and sandbox runtime exactly once each; found ${buildActionCount} build actions.`,
    );
  }
  return violations;
}

function inspectTextIncludes(source: string, label: string, expectedTerms: readonly string[]): string[] {
  return expectedTerms.filter((term) => !source.includes(term)).map((term) => `${label} must include ${term}.`);
}

function workflowJobBlock(source: string, jobName: string): string | undefined {
  const marker = `\n  ${jobName}:\n`;
  const start = source.indexOf(marker);
  if (start < 0) return undefined;
  const nextJob = /^ {2}[a-z0-9-]+:\s*$/gm;
  nextJob.lastIndex = start + marker.length;
  const next = nextJob.exec(source);
  return source.slice(start, next?.index ?? source.length);
}
