import { isAgentInlinePreviewMime } from "../Uploads/AgentUploadMime.js";

/** Preserve preview media types while isolating resource documents from the host. */
export function agentResourceContentHeaders(input: { readonly mime: string; readonly name: string }) {
  const inline = isAgentInlinePreviewMime(input.mime);
  return {
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(input.name)}`,
    "Content-Type": inline ? input.mime : "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  } as const;
}
