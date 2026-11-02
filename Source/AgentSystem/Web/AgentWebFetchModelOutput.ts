import type { AgentWebFetchLink, AgentWebFetchOutput } from "./AgentWebTypes.js";

/**
 * Model-facing WebFetch result.
 *
 * The extracted page appears exactly once. The extraction digest is a subset
 * of that page, and the transfer byte counters plus the render scoring
 * signals describe how the page was obtained rather than what it says. They
 * stay in the artifact's raw response, where the UI and the artifact reader
 * still reach them, instead of being carried twice through the observation.
 */
/**
 * The type describes the runtime projection only. Its public schema is the
 * WebFetch package contract, validated once by AgentToolRunner after this
 * projection returns. Keeping this structural avoids a second Zod contract
 * that could drift from System/Extensions.
 */
export interface AgentWebFetchModelOutput {
  readonly title: string;
  readonly finalUrl: string;
  readonly content: string;
  readonly links: readonly AgentWebFetchLink[];
  readonly citationId: string;
  /** Whether the response body continued past the transfer budget. */
  readonly transfer: { readonly truncated: boolean };
  readonly render: Pick<
    AgentWebFetchOutput["render"],
    "strategy" | "decision" | "usedBrowser" | "browserContentChanged" | "browserOutputTruncated" | "reasons"
  >;
}

export function projectAgentWebFetchModelOutput(output: AgentWebFetchOutput): AgentWebFetchModelOutput {
  return {
    title: output.title,
    finalUrl: output.finalUrl,
    content: output.content,
    links: output.links.map((link) => ({ ...link })),
    citationId: output.citationId,
    transfer: { truncated: output.transfer.truncated },
    render: {
      strategy: output.render.strategy,
      decision: output.render.decision,
      usedBrowser: output.render.usedBrowser,
      browserContentChanged: output.render.browserContentChanged,
      browserOutputTruncated: output.render.browserOutputTruncated,
      reasons: [...output.render.reasons],
    },
  };
}
