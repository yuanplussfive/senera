import type { AgentPiWorkspaceTurnContext } from "../Pi/AgentPiWorkspaceContextTypes.js";
import { AgentPromptWireEncodings, renderAgentPromptWireBlocks } from "./AgentPromptWireCodec.js";

export interface AgentWorkspaceTurnContextWire {
  readonly text: string;
  readonly references: readonly string[];
}

/** Whole-entry selection; capture provenance and detail references travel with every file. */
export function renderAgentWorkspaceTurnContextWire(
  context: AgentPiWorkspaceTurnContext | undefined,
  options: { readonly maxTokens: number; readonly estimateTokens: (text: string) => number },
): AgentWorkspaceTurnContextWire {
  if (
    !context ||
    (context.changes.length === 0 &&
      context.outputs.length === 0 &&
      context.unavailableResults === 0 &&
      !context.captures.some(
        (capture) => capture.quality === "bounded" || capture.quality === "degraded" || (capture.warningCount ?? 0) > 0,
      ))
  )
    return { text: "", references: [] };
  type FileEntry = ReturnType<typeof projectFile>;
  const files: FileEntry[] = [];
  const outputs: AgentPiWorkspaceTurnContext["outputs"] = [];
  const captureIds = new Map(context.captures.map((capture, index) => [capture.id, index + 1]));
  const captureById = new Map(context.captures.map((capture) => [capture.id, capture]));
  const selectedCaptures = new Set<string>();
  const extraDetails: string[] = [];
  const allDetails = [...new Set(context.captures.flatMap((capture) => capture.details))];
  const render = () => {
    const referenced = new Set([...selectedCaptures, ...files.flatMap((file) => file.captureKeys)]);
    const captures = [...referenced].map((id) => {
      const capture = captureById.get(id)!;
      return {
        id: captureIds.get(id),
        ...(capture.source ? { source: capture.source } : {}),
        ...(capture.sources ? { sources: capture.sources } : {}),
        ...(capture.coverage ? { coverage: capture.coverage } : {}),
        ...(capture.quality ? { quality: capture.quality } : {}),
        ...(capture.warningCount ? { warningCount: capture.warningCount } : {}),
        ...(capture.scope ? { scope: capture.scope } : {}),
        details: capture.details.slice(0, 1),
      };
    });
    const includedDetails = new Set([...captures.flatMap((capture) => capture.details), ...extraDetails]);
    return renderAgentPromptWireBlocks(
      {
        preamble: ["senera.workspace_changes=v1"],
        blocks: [
          {
            id: "workspace_changes",
            value: {
              scope: context.scope,
              ...(files.length > 0 ? { files: files.map(({ captureKeys: _keys, ...file }) => file) } : {}),
              ...(outputs.length > 0 ? { outputs } : {}),
              ...(captures.length > 0 ? { captures } : {}),
              ...(extraDetails.length > 0 ? { details: extraDetails } : {}),
              ...(context.unavailableResults > 0 ? { unavailableResults: context.unavailableResults } : {}),
              omittedFiles: context.changes.length - files.length,
              omittedOutputs: context.outputs.length - outputs.length,
              omittedCaptures: context.captures.length - captures.length,
              omittedDetails: allDetails.length - includedDetails.size,
            },
            allowedEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
          },
        ],
      },
      options,
    ).text;
  };
  for (const change of context.changes) {
    files.push(projectFile(change, captureIds));
    if (options.estimateTokens(render()) > options.maxTokens) files.pop();
  }
  for (const output of context.outputs) {
    outputs.push(output);
    if (options.estimateTokens(render()) > options.maxTokens) outputs.pop();
  }
  for (const capture of context.captures) {
    selectedCaptures.add(capture.id);
    if (options.estimateTokens(render()) > options.maxTokens) selectedCaptures.delete(capture.id);
  }
  const selectedDetails = new Set(
    context.captures
      .filter(
        (capture) => selectedCaptures.has(capture.id) || files.some((file) => file.captureKeys.includes(capture.id)),
      )
      .flatMap((capture) => capture.details.slice(0, 1)),
  );
  for (const ref of allDetails) {
    if (selectedDetails.has(ref)) continue;
    extraDetails.push(ref);
    if (options.estimateTokens(render()) > options.maxTokens) extraDetails.pop();
  }
  const result = render();
  // Never cut a reference or serialize a half-record when even metadata cannot fit.
  if (options.estimateTokens(result) > options.maxTokens) return { text: "", references: [] };
  return {
    text: result,
    references: [...new Set([...selectedDetails, ...extraDetails, ...outputs.map((output) => output.uri)])],
  };
}

function projectFile(change: AgentPiWorkspaceTurnContext["changes"][number], captureIds: ReadonlyMap<string, number>) {
  return {
    path: change.path,
    status: change.status,
    beforeKind: change.beforeKind,
    afterKind: change.afterKind,
    ...(change.addedLines === undefined ? {} : { addedLines: change.addedLines }),
    ...(change.removedLines === undefined ? {} : { removedLines: change.removedLines }),
    captures: change.captures.map((id) => captureIds.get(id)),
    captureKeys: change.captures,
    ...(change.continuity === "unverified" ? { continuity: change.continuity } : {}),
  };
}
