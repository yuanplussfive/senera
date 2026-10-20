import { useEffect, useRef } from "react";
import { z } from "zod/mini";
import { buildHttpApiUrl } from "../../api/httpApiUrl";
import { SeneraResourceHttpRoutes } from "../../api/resourceContract";

const ChangesSchema = z.object({ revision: z.int(), paths: z.array(z.string()) });
export function useWorkspaceFileChanges(
  httpBaseUrl: string,
  onChange: (paths: readonly string[]) => void,
  rootPath = ".",
  enabled = true,
): void {
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (!enabled) return;
    const url = new URL(buildHttpApiUrl(httpBaseUrl, SeneraResourceHttpRoutes.WorkspaceChanges));
    if (rootPath !== ".") url.searchParams.set("path", rootPath);
    const source = new EventSource(url, {
      withCredentials: true,
    });
    source.onmessage = (event) => callback.current(ChangesSchema.parse(JSON.parse(event.data)).paths);
    return () => source.close();
  }, [enabled, httpBaseUrl, rootPath]);
}
