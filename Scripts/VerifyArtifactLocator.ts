import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentActionPlannerContextBuilder } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerContext.js";
import { resolveArtifactsConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentToolExecutionArtifactRecorder } from "../Source/AgentSystem/Artifacts/AgentToolExecutionArtifactRecorder.js";
import { AgentWorkspaceChangeCapture } from "../Source/AgentSystem/Artifacts/AgentWorkspaceChangeCapture.js";
import {
  createAgentArtifactLocator,
  createAgentArtifactUri,
  normalizeAgentArtifactUri,
  parseAgentArtifactUri,
  toWorkspaceRelativePath,
} from "../Source/AgentSystem/Artifacts/AgentArtifactLocator.js";

const workspaceRoot = path.resolve(process.cwd());

const locator = createAgentArtifactLocator({
  workspaceRoot,
  rootDir: ".senera/custom-artifacts",
  requestId: "request:demo/unsafe",
  step: 3,
  callIndex: 1,
  toolName: "Web Search++",
  argsHash: "f00dbeef",
  resultHash: "c0ffee",
});

assert.equal(path.isAbsolute(locator.absoluteDir), true);
assert.equal(locator.absoluteDir.startsWith(workspaceRoot), true);
assert.equal(locator.rootDir, ".senera/custom-artifacts");
assert.equal(locator.relativeDir.startsWith(".senera/custom-artifacts/"), true);
assert.equal(locator.relativeDir.includes("\\"), false);
assert.equal(locator.artifactUri, createAgentArtifactUri(locator.artifactId));
assert.equal(parseAgentArtifactUri(locator.artifactUri), locator.artifactId);
assert.equal(
  normalizeAgentArtifactUri(`urn:senera:artifact:${locator.artifactId}`),
  locator.artifactUri,
);
assert.equal(locator.files.manifest, path.join(locator.absoluteDir, "manifest.json"));
assert.equal(
  toWorkspaceRelativePath(workspaceRoot, locator.files.projection),
  `${locator.relativeDir}/projection.md`,
);

void main();

async function main(): Promise<void> {
  const fixtureDir = path.join(workspaceRoot, ".senera", "custom-artifacts-fixtures");
  const fixtureFile = path.join(fixtureDir, "sample.txt");
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(fixtureFile, "before\n", "utf8");
  const workspaceCapture = new AgentWorkspaceChangeCapture({ workspaceRoot });
  const preparedCapture = await workspaceCapture.prepare({
    policy: {
      Workspace: {
        Capture: "declared",
        Paths: [{
          Selector: "$.path",
        }],
        PatchContextLines: 3,
      },
    },
    args: {
      path: ".senera/custom-artifacts-fixtures/sample.txt",
    },
  });
  fs.writeFileSync(fixtureFile, "after\n", "utf8");
  const capturedWorkspace = await preparedCapture.complete({
    path: ".senera/custom-artifacts-fixtures/sample.txt",
  });
  assert.equal(capturedWorkspace?.changes[0]?.status, "modified");

  const recorder = new AgentToolExecutionArtifactRecorder({
    workspaceRoot,
    config: resolveArtifactsConfig({
      PluginRoots: {
        System: [],
        User: [],
      },
      ModelProviderEndpoints: [{
        Id: "test",
        BaseUrl: "https://example.invalid/v1",
        ApiKey: "test",
      }],
      ModelProviders: [{
        Id: "test",
        ProviderId: "test",
        Endpoint: "Responses",
        Model: "test",
        Temperature: 0,
        MaxOutputTokens: -1,
        Stream: true,
        TimeoutSeconds: 0.001,
        MaxNetworkRetries: 0,
      }],
      Artifacts: {
        RootDir: ".senera/custom-artifacts",
      },
    }),
  });
  const recordedResults = await recorder.record({
    requestId: "request:demo/unsafe",
    step: 3,
    results: [{
      callId: "call-1",
      name: "Web Search++",
      arguments: {
        query: "artifact path best practice",
        credentials: {
          primary: "secret-value",
        },
      },
      process: {
        exitCode: 0,
        signal: null,
        stderr: "",
      },
      result: {
        query: "artifact path best practice",
        tools: {
          item: [{
            name: "ArtifactTool",
            title: "Artifact Tool",
            summary: "Use a stable ID and a local absolute path resolver.",
            score: 0.9,
          }],
        },
      },
      artifactPolicy: {
        Redact: {
          Paths: [
            "$.credentials.primary",
          ],
        },
        Evidence: [{
          Kind: "tool_candidate",
          Records: "$.tools.item[*]",
          Slots: {
            name: "$.name",
            title: "$.title",
            summary: "$.summary",
            score: "$.score",
          },
          Identity: {
            Parts: [
              "name",
            ],
          },
          Presentation: {
            Locator: "tool:{{ name }}",
            Display: "tool candidate: {{ title }}",
            Label: "{{ title }}",
            Source: "{{ summary }}",
          },
          ModelProjection: {
            Slots: [
              "name",
              "title",
              "summary",
              "score",
            ],
          },
          PlannerMemory: {
            Facts: [
              "name",
              "title",
              "score",
            ],
            ArtifactRefs: [
              "evidence",
              "projection",
            ],
          },
          Projection: {
            SummaryTemplate: "{% for e in evidence %}- {{ e.evidenceUri }} tool: {{ e.slots.name }} — {{ e.slots.title }}{% endfor %}",
            ArtifactTemplate: "{% for e in evidence %}- {{ e.evidenceUri }} tool: {{ e.slots.name }}\n  title: {{ e.slots.title }}\n  summary: {{ e.slots.summary }}\n  score: {{ e.slots.score }}{% endfor %}",
          },
          Confidence: 0.8,
          Metadata: {
            score: "$.score",
          },
        }],
        Summary: {
          Template: "{% for e in evidence %}- {{ e.evidenceUri }} {{ e.display }}{% endfor %}",
          ArtifactTemplate: "{% for e in evidence %}- {{ e.evidenceUri }} {{ e.display }}\n  locator: {{ e.locator }}{% endfor %}",
        },
        Workspace: {
          Capture: "declared",
          Paths: [{
            Selector: "$.path",
          }],
          PatchContextLines: 3,
        },
      },
      workspaceCapture: capturedWorkspace,
    }],
  });

  const recorded = recordedResults[0];
  assert.ok(recorded?.artifact);
  assert.equal(fs.existsSync(recorded.artifact.manifestPath), true);
  assert.equal(fs.existsSync(recorded.artifact.files.raw), true);
  assert.equal(fs.existsSync(recorded.artifact.files.projection), true);
  assert.equal(
    fs.readFileSync(recorded.artifact.files.input, "utf8").includes("secret-value"),
    false,
  );
  assert.equal(recorded.artifact.evidence[0]?.kind, "tool_candidate");
  assert.equal(recorded.artifact.evidence[0]?.key, "tool_candidate:ArtifactTool");
  assert.equal(fs.existsSync(recorded.artifact.files.workspaceDiff), true);
  assert.equal(fs.existsSync(recorded.artifact.files.workspacePatch), true);
  assert.equal(recorded.artifact.workspace?.changes[0]?.status, "modified");
  assert.equal(recorded.artifact.workspace?.changes[0]?.patch?.status, "generated");
  assert.equal(
    fs.readFileSync(recorded.artifact.files.workspacePatch, "utf8").includes("-before"),
    true,
  );
  assert.equal(
    fs.readFileSync(recorded.artifact.files.workspacePatch, "utf8").includes("+after"),
    true,
  );
  const beforeSnapshot = JSON.parse(fs.readFileSync(recorded.artifact.files.workspaceBefore, "utf8")) as {
    files: Array<{ content?: { text?: string; relativeArtifactPath?: string } }>;
  };
  assert.equal(beforeSnapshot.files[0]?.content?.text, undefined);
  assert.equal(
    beforeSnapshot.files[0]?.content?.relativeArtifactPath?.endsWith(".senera/custom-artifacts-fixtures/sample.txt"),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(recorded.artifact.artifactPath, beforeSnapshot.files[0]?.content?.relativeArtifactPath ?? "")),
    true,
  );

  const builder = new AgentActionPlannerContextBuilder(
    workspaceRoot,
    ".senera/custom-artifacts",
  );
  const ledger = builder.advanceAfterToolResults({
    requestId: "request:demo/unsafe",
    ledger: {
      calls: [],
      evidence: [],
      warnings: [],
      deltas: [],
      lastNewEvidenceStep: 0,
    },
    step: 3,
    results: recordedResults,
  });

  const call = ledger.calls[0];
  assert.ok(call);
  assert.equal(call.artifactId.startsWith("art_"), true);
  assert.equal(call.artifactUri, `senera://artifact/${call.artifactId}`);
  assert.equal(
    normalizeAgentArtifactUri(`urn:senera:artifact:${call.artifactId}`),
    call.artifactUri,
  );
  assert.equal(path.isAbsolute(call.artifactPath), true);
  assert.equal(call.artifactPath.startsWith(workspaceRoot), true);
  assert.equal(call.artifactPath.includes(`${path.sep}custom-artifacts${path.sep}`), true);
  assert.equal(call.artifactPath, recorded.artifact.artifactPath);
  assert.equal(ledger.evidence[0]?.artifactPath, call.artifactPath);
  assert.equal(ledger.deltas[0]?.artifactUri, call.artifactUri);

  const noEvidenceResults = await recorder.record({
    requestId: "request:no-evidence",
    step: 4,
    results: [{
      callId: "call-no-evidence",
      name: "NoEvidenceTool",
      arguments: {
        query: "do not infer evidence",
      },
      process: {
        exitCode: 0,
        signal: null,
        stderr: "",
      },
      result: {
        path: "should/not/be/inferred.txt",
        url: "https://example.invalid/should-not-be-inferred",
        title: "No inferred evidence",
      },
      artifactPolicy: {
        Summary: {
          Template: "{% for e in evidence %}{{ e.evidenceUri }}{% endfor %}",
          ArtifactTemplate: "{% for e in evidence %}{{ e.evidenceUri }}{% endfor %}",
        },
      },
    }],
  });
  assert.equal(noEvidenceResults[0]?.artifact?.evidence.length, 0);
  const noEvidenceLedger = builder.advanceAfterToolResults({
    requestId: "request:no-evidence",
    ledger: {
      calls: [],
      evidence: [],
      warnings: [],
      deltas: [],
      lastNewEvidenceStep: 0,
    },
    step: 4,
    results: noEvidenceResults,
  });
  assert.equal(noEvidenceLedger.calls[0]?.evidenceUris.length, 0);
  assert.equal(noEvidenceLedger.evidence.length, 0);
  assert.equal(noEvidenceLedger.deltas.some((entry) => entry.op === "AddEvidence"), false);

  console.log("Artifact locator verification passed.");
  fs.rmSync(fixtureDir, { recursive: true, force: true });
}
