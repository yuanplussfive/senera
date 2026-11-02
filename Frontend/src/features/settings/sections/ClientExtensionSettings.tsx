import { useEffect, useRef, useState } from "react";
import { useActiveServerAuthentication } from "../../../app/useServerAuthentication";
import { authenticationMutationHeaders } from "../../../api/serverAuthentication";
import { openOneBot11Client } from "../../../app/channelClientNavigation";
import { frontendMessage as message } from "../../../i18n/frontendMessageCatalog";
import { Button, InlineError } from "../../../shared/ui";
import { AgentClientExtensionStatusSchema } from "../../../../../Source/AgentSystem/Channels/Client/AgentClientExtensionContract";
import type { z } from "zod";

type Status = z.infer<typeof AgentClientExtensionStatusSchema>;

/** Optional document installation uses the console's current authorized session. */
export function ClientExtensionSettings({
  url,
  workspaceId,
  connected,
}: {
  url: string;
  workspaceId: string;
  connected: boolean;
}) {
  const { state } = useActiveServerAuthentication();
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const endpoint = new URL("extension", url).href;
  useEffect(() => {
    const abort = new AbortController();
    setStatus(undefined);
    setError(undefined);
    void fetch(endpoint, { credentials: "include", signal: abort.signal })
      .then(readStatus)
      .then(setStatus)
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setError(String(failure));
      });
    return () => abort.abort();
  }, [endpoint]);

  async function mutate(method: "POST" | "DELETE", file?: File): Promise<void> {
    if (state.status !== "authenticated") return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await fetch(endpoint, {
        method,
        credentials: "include",
        headers: {
          ...authenticationMutationHeaders(state.authentication),
          ...(method === "POST"
            ? { "Content-Type": file ? "application/zip" : "application/vnd.senera.install-release" }
            : {}),
        },
        body: file,
      });
      setStatus(await readStatus(result));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function open(): Promise<void> {
    try {
      const result = await openOneBot11Client(url, workspaceId);
      if (!result.ok) throw new Error(message("settings.channels.localClientUnavailable"));
    } catch (failure) {
      setError(String(failure));
    }
  }

  return (
    <div className="mb-5 space-y-3 border-b border-line-subtle pb-5">
      <div>
        <div className="text-sm font-medium text-content-primary">{message("settings.clientExtension.title")}</div>
        <p className="mt-1 text-xs text-content-muted">{message("settings.clientExtension.description")}</p>
        <p className="mt-2 text-xs text-content-secondary" role="status">
          {busy
            ? message("settings.clientExtension.working")
            : status?.installed
              ? `${message("settings.clientExtension.installed")} · ${status.manifest.version}`
              : status
                ? message("settings.clientExtension.notInstalled")
                : error
                  ? null
                  : message("settings.clientExtension.working")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {status?.installed ? (
          <Button variant="outline" disabled={busy || !connected} onClick={() => void open()}>
            {message("settings.channels.openLocalClient")}
          </Button>
        ) : null}
        {status?.releaseAvailable ? (
          <Button variant="outline" disabled={busy} onClick={() => void mutate("POST")}>
            {message(status.installed ? "settings.clientExtension.update" : "settings.clientExtension.install")}
          </Button>
        ) : null}
        <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          {message("settings.clientExtension.import")}
        </Button>
        {status?.installed ? (
          <Button variant="ghost" disabled={busy} onClick={() => void mutate("DELETE")}>
            {message("settings.clientExtension.remove")}
          </Button>
        ) : null}
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void mutate("POST", file);
          }}
        />
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}

async function readStatus(response: Response): Promise<Status> {
  const value = (await response.json()) as Status & { message?: string };
  if (!response.ok) throw new Error(value.message ?? `HTTP ${response.status}`);
  return AgentClientExtensionStatusSchema.parse(value);
}
