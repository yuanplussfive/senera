import type { RunRecord } from "./types";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

/** Display-only summary; never inserted into the conversation or model input. */
const HostInputLabels = {
  agent_message: "workflow.run.hostInput.agentMessage",
  agent_completion: "workflow.run.hostInput.agentCompletion",
  job_completion: "workflow.run.hostInput.jobCompletion",
  schedule: "workflow.run.hostInput.schedule",
} as const satisfies Record<NonNullable<RunRecord["hostInput"]>["kind"], Parameters<typeof frontendMessage>[0]>;

export function readRunInputLabel(run: Pick<RunRecord, "input" | "inputAttachments" | "hostInput">): string {
  if (run.hostInput) return frontendMessage(HostInputLabels[run.hostInput.kind]);
  if (run.input.trim()) return run.input;
  const attachments = run.inputAttachments ?? [];
  if (attachments.length === 0) return frontendMessage("workflow.run.emptyInput");
  const images = attachments.filter((attachment) => attachment.mime.startsWith("image/")).length;
  const files = attachments.length - images;
  return [
    images > 0 ? frontendMessage("workflow.run.inputImages", { count: images }) : undefined,
    files > 0 ? frontendMessage("workflow.run.inputFiles", { count: files }) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
