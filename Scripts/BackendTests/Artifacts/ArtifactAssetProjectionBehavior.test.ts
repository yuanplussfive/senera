import { describe, expect, test } from "vitest";
import { createAgentArtifactAssetLink } from "../../../Source/AgentSystem/Artifacts/AgentArtifactAssetLink.js";
import { projectArtifactAssetLinks } from "../../../Source/AgentSystem/Artifacts/AgentToolArtifactAssetProjection.js";

describe("Artifact-local asset link publication", () => {
  test("does not confuse asset label prefixes or publish an unregistered asset as a registered one", () => {
    const assets = ["image", "image-copy"].map((id, index) => ({
      id,
      resourceUri: `senera://resource/${index === 0 ? "k7m4p9" : "v6q8t3"}`,
      fileName: `${id}.png`,
      mediaType: "image/png",
      relativePath: `assets/${id}.png`,
      workspacePath: `./artifacts/assets/${id}.png`,
      byteLength: 1,
      sha256: "a".repeat(64),
    }));
    const source = ["image-copy", "image", "image-missing"]
      .map((id) => `![${id}](${createAgentArtifactAssetLink(id)})`)
      .join("\n");
    expect(projectArtifactAssetLinks(source, assets)).toBe(
      "![image-copy](senera://resource/v6q8t3)\n![image](senera://resource/k7m4p9)\n![image-missing](asset:image-missing/)",
    );
  });
});
