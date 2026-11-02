import { useCallback, useEffect, useRef, useState } from "react";
import { readArtifactToolResult } from "../../api/artifactResultClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { InlineError, Spinner } from "../../shared/ui";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import { DataView } from "./DataView";

export function ToolResultDetail({
  value,
  artifactUri,
  onLoaded,
}: {
  readonly value: unknown;
  readonly artifactUri?: string;
  readonly onLoaded: (value: unknown) => void;
}): JSX.Element {
  const controller = useWorkspaceResourceController();
  const request = useRef<AbortController | undefined>(undefined);
  const onLoadedRef = useRef(onLoaded);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [error, setError] = useState<string>();
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);
  const httpBaseUrl = controller?.httpBaseUrl;
  const csrfToken = controller?.csrfToken;

  const load = useCallback(async () => {
    if (!httpBaseUrl || !artifactUri) return;
    const abort = new AbortController();
    request.current?.abort();
    request.current = abort;
    setStatus("loading");
    setError(undefined);
    try {
      const result = await readArtifactToolResult(httpBaseUrl, artifactUri, {
        csrfToken,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      onLoadedRef.current(result);
      setStatus("loaded");
    } catch (cause) {
      if (abort.signal.aborted) return;
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [httpBaseUrl, csrfToken, artifactUri]);

  useEffect(() => {
    setStatus("idle");
    setError(undefined);
    void load();
    return () => request.current?.abort();
  }, [load]);
  const loading = Boolean(artifactUri && httpBaseUrl && (status === "idle" || status === "loading"));

  return (
    <>
      {value !== undefined ? <DataView value={value} /> : null}
      {loading ? (
        <div role="status" className="mt-2 flex items-center gap-2 text-[11px] text-content-muted">
          <Spinner size="xs" />
          {frontendMessage("ui.loading")}
        </div>
      ) : null}
      {error ? <InlineError onRetry={() => void load()}>{error}</InlineError> : null}
    </>
  );
}
