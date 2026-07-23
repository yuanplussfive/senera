const ReleaseWorkflowLabel = ".github/workflows/release.yml";

export function inspectContainerReleasePipeline(workflow: string): string[] {
  const buildJob = workflowJobBlock(workflow, "container-build");
  const smokeJob = workflowJobBlock(workflow, "container-smoke");
  const publishJob = workflowJobBlock(workflow, "container");
  const violations: string[] = [];

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
  }

  if (!smokeJob) {
    violations.push(`${ReleaseWorkflowLabel} must define the container-smoke job.`);
  } else {
    violations.push(
      ...inspectTextIncludes(smokeJob, `${ReleaseWorkflowLabel} job container-smoke`, [
        "- container-build",
        "timeout-minutes: 5",
        "CONTAINER_HEALTH_TIMEOUT_SECONDS: 180",
        "needs.container-build.outputs.reference }}@${{ needs.container-build.outputs.digest",
        'docker pull "$IMAGE"',
        "openssl rand -hex 24 | docker run --rm --interactive",
        '--volume "$VOLUME_NAME:/data"',
        "node Dist/Apps/AdminAccess.js init",
        "--password-stdin",
        'docker volume rm "$VOLUME_NAME"',
        "deadline=$((SECONDS + CONTAINER_HEALTH_TIMEOUT_SECONDS))",
        'docker exec "$CONTAINER_NAME" node Dist/Scripts/VerifyDockerNativeSqlite.js',
        'docker exec "$CONTAINER_NAME" node Dist/Scripts/VerifyDockerUserPluginWrite.js',
      ]),
    );
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
        "- container-smoke",
        "type=raw,value=${{ needs.metadata.outputs.container_version_tag }}",
        "type=raw,value=${{ needs.metadata.outputs.container_minor_tag }}",
        "type=raw,value=latest",
        "needs.container-build.outputs.reference }}@${{ needs.container-build.outputs.digest",
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
  if (buildActionCount !== 1) {
    violations.push(
      `${ReleaseWorkflowLabel} must build the release container exactly once; found ${buildActionCount} build actions.`,
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
