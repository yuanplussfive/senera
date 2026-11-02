import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AgentDirectoryHttpPath,
  AgentDirectorySnapshotSchema,
  type AgentDirectoryCommand,
  type AgentDirectorySnapshot,
} from "../../../../Source/AgentSystem/Core/AgentDirectoryContract";
import { buildHttpApiUrl } from "../../api/httpApiUrl";
import { useStore } from "../../store/sessionStore";
import { projectAgentDirectory } from "../../store/session/agentDirectoryProjection";

interface DirectoryController {
  error?: string;
  execute(command: AgentDirectoryCommand): Promise<AgentDirectorySnapshot>;
}
const Context = createContext<DirectoryController | undefined>(undefined);

function adopt(snapshot: AgentDirectorySnapshot): void {
  useStore.setState((state) => projectAgentDirectory(state, snapshot));
}

export function AgentDirectoryProvider({
  httpBaseUrl,
  csrfToken,
  children,
}: {
  httpBaseUrl: string;
  csrfToken?: string;
  children: ReactNode;
}): JSX.Element {
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    useStore.setState({ agentDirectory: null, selectedAgentId: null });
    void fetch(buildHttpApiUrl(httpBaseUrl, AgentDirectoryHttpPath), {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(readResponse)
      .then((snapshot) => {
        if (!controller.signal.aborted) {
          adopt(snapshot);
          setError(undefined);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [httpBaseUrl]);
  const execute = useCallback(
    async (command: AgentDirectoryCommand) => {
      const snapshot = await readResponse(
        await fetch(buildHttpApiUrl(httpBaseUrl, AgentDirectoryHttpPath), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-Senera-Csrf": csrfToken } : {}) },
          body: JSON.stringify(command),
        }),
      );
      adopt(snapshot);
      return snapshot;
    },
    [httpBaseUrl, csrfToken],
  );
  const value = useMemo(() => ({ error, execute }), [error, execute]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

async function readResponse(response: Response): Promise<AgentDirectorySnapshot> {
  const data: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data === "object" && data !== null && "message" in data && typeof data.message === "string"
        ? data.message
        : `Agent settings (${response.status})`,
    );
  return AgentDirectorySnapshotSchema.parse(data);
}

export function useAgentDirectory() {
  const controller = useContext(Context);
  const directory = useStore((state) => state.agentDirectory);
  return { directory, controller };
}
