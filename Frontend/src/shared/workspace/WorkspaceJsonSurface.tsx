import { useEffect, useState } from "react";
import { JsonView, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import JsonWorker from "./WorkspaceJson.worker?worker";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { StateView } from "../ui";

type JsonResult = { ok: true; data: unknown } | { ok: false; error: string };

export function WorkspaceJsonSurface({ content }: { content: string }): JSX.Element {
  const [result, setResult] = useState<{ content: string; result: JsonResult }>();
  useEffect(() => {
    const worker = new JsonWorker();
    worker.onmessage = (event: MessageEvent<JsonResult>) => {
      setResult({ content, result: event.data });
      worker.terminate();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      setResult({ content, result: { ok: false, error: event.message } });
      worker.terminate();
    };
    worker.postMessage(content);
    return () => worker.terminate();
  }, [content]);

  if (result?.content !== content) return <StateView status="loading" />;
  const value = result.result;
  if (!value.ok) return <StateView status="error" description={value.error} />;
  if (value.data === null || typeof value.data !== "object")
    return <StateView status="error" description={frontendMessage("resource.jsonStructureRequired")} />;
  return (
    <div className="workspace-json-surface min-h-0 flex-1 overflow-auto p-4 font-mono text-[13px]">
      <JsonView
        data={value.data}
        style={{
          ...defaultStyles,
          container: "workspace-json-tree",
          label: "text-content-secondary",
          stringValue: "text-success",
          numberValue: "text-accent-strong",
          punctuation: "text-content-muted",
        }}
        shouldExpandNode={(level) => level < 2}
      />
    </div>
  );
}
