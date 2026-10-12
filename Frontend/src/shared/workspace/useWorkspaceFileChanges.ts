import { useEffect, useRef } from "react";
import { z } from "zod/mini";
import { buildHttpApiUrl } from "../../api/httpApiUrl";
import { SeneraResourceHttpRoutes } from "../../api/resourceContract";

const ChangesSchema = z.object({ revision: z.int(), paths: z.array(z.string()) });
export function useWorkspaceFileChanges(httpBaseUrl: string, onChange: (paths: readonly string[]) => void): void {
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    const source = new EventSource(buildHttpApiUrl(httpBaseUrl, SeneraResourceHttpRoutes.WorkspaceChanges), {
      withCredentials: true,
    });
    source.onmessage = (event) => callback.current(ChangesSchema.parse(JSON.parse(event.data)).paths);
    return () => source.close();
  }, [httpBaseUrl]);
}
