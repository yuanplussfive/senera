import { buildHttpApiUrl } from "./httpApiUrl";
import { SeneraResourceHttpRoutes } from "./resourceContract";

/** Full results are fetched only when an inspector requests the durable artifact. */
export async function readArtifactToolResult(
  httpBaseUrl: string,
  artifactUri: string,
  options: { readonly csrfToken?: string; readonly signal?: AbortSignal } = {},
): Promise<unknown> {
  const response = await fetch(buildHttpApiUrl(httpBaseUrl, SeneraResourceHttpRoutes.ArtifactRead), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.csrfToken ? { "X-Senera-Csrf": options.csrfToken } : {}),
    },
    body: JSON.stringify({ requests: [{ uri: artifactUri, part: "result", paths: [""] }] }),
    signal: options.signal,
  });
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error(`Invalid artifact response (${response.status}).`);
  if (!response.ok || payload.ok !== true) {
    const error = isRecord(payload.error) ? payload.error : undefined;
    throw new Error(
      typeof error?.message === "string" ? error.message : `Artifact request failed (${response.status}).`,
    );
  }
  const artifacts = isRecord(payload.artifacts) ? payload.artifacts.item : undefined;
  const item: unknown = Array.isArray(artifacts) ? artifacts[0] : undefined;
  if (!isRecord(item) || item.status !== "found") {
    throw new Error(
      isRecord(item) && typeof item.message === "string" ? item.message : "Artifact result is unavailable.",
    );
  }
  if (item.requestedUri !== artifactUri || item.view !== "selected" || item.part !== "result")
    throw new Error("Artifact response does not match the requested result.");
  const selections = isRecord(item.content) ? item.content.selections : undefined;
  const selection: unknown = Array.isArray(selections) ? selections[0] : undefined;
  if (
    !isRecord(selection) ||
    selection.path !== "" ||
    selection.status !== "found" ||
    selection.representation !== "original" ||
    selection.complete !== true
  ) {
    throw new Error("Artifact result payload is invalid.");
  }
  return selection.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
