import { describe, expect, test } from "vitest";
import { resolveAgentDockerLoadedImageId } from "../../../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerImageLoadIdentity.js";

const ConfigDigest = `sha256:${"a".repeat(64)}`;
const ManifestDigest = `sha256:${"b".repeat(64)}`;
const SourceReference = `docker.io/library/node@sha256:${"c".repeat(64)}`;

describe("Docker image load identity", () => {
  test("uses the OCI config digest exposed by Docker's classic image store", () => {
    expect(
      resolveAgentDockerLoadedImageId({
        imagesBefore: [{ Id: ConfigDigest }],
        imagesAfter: [{ Id: ConfigDigest }],
        loadEvents: [],
        expectedImageIds: [ConfigDigest],
        expectedReferences: [SourceReference],
      }),
    ).toBe(ConfigDigest);
  });

  test("uses Docker Hub's normalized reference from a containerd image store", () => {
    expect(
      resolveAgentDockerLoadedImageId({
        imagesBefore: [],
        imagesAfter: [
          { Id: ManifestDigest, RepoTags: [SourceReference.replace("docker.io/library/", "")], RepoDigests: [] },
        ],
        loadEvents: [],
        expectedImageIds: [ConfigDigest],
        expectedReferences: [SourceReference],
      }),
    ).toBe(ManifestDigest);
  });

  test("uses Docker's load response for an already-present dangling image", () => {
    const danglingImage = { Id: ManifestDigest, RepoTags: ["<none>:<none>"], RepoDigests: [] };
    expect(
      resolveAgentDockerLoadedImageId({
        imagesBefore: [danglingImage],
        imagesAfter: [danglingImage],
        loadEvents: [{ stream: `Loaded image ID: ${ManifestDigest}\n` }],
        expectedImageIds: [ConfigDigest],
        expectedReferences: [SourceReference],
      }),
    ).toBe(ManifestDigest);
  });

  test("uses a unique image inventory delta when Docker omits load identity", () => {
    expect(
      resolveAgentDockerLoadedImageId({
        imagesBefore: [{ Id: "sha256:existing" }],
        imagesAfter: [{ Id: "sha256:existing" }, { Id: ManifestDigest }],
        loadEvents: [],
        expectedImageIds: [ConfigDigest],
        expectedReferences: [SourceReference],
      }),
    ).toBe(ManifestDigest);
  });

  test("rejects conflicting identities instead of tagging an ambiguous image", () => {
    expect(() =>
      resolveAgentDockerLoadedImageId({
        imagesBefore: [],
        imagesAfter: [{ Id: ConfigDigest }, { Id: ManifestDigest, RepoTags: [SourceReference] }],
        loadEvents: [],
        expectedImageIds: [ConfigDigest],
        expectedReferences: [SourceReference],
      }),
    ).toThrow("identified multiple images");
  });
});
