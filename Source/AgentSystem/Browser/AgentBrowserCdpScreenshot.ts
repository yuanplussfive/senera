import { randomUUID } from "node:crypto";
import { AgentBrowserCdpConnection } from "./AgentBrowserCdpConnection.js";
import type { AgentBrowserDriverOperationOptions, AgentBrowserDriverOperationResult } from "./AgentBrowserDriver.js";
import { withAgentBrowserOperationDeadline } from "./AgentBrowserOperationDeadline.js";

export interface AgentBrowserScreenshotBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AgentBrowserScreenshotAnnotation {
  readonly ref: string;
  readonly box: AgentBrowserScreenshotBox;
}

export interface AgentBrowserCdpScreenshotRequest {
  readonly cdpUrl: string;
  readonly targetId: string;
  readonly format: "png" | "jpeg";
  readonly fullPage: boolean;
  /** Native selector/ref resolution returns viewport-relative CSS coordinates. */
  readonly selectorBox?: AgentBrowserScreenshotBox;
  readonly annotations: readonly AgentBrowserScreenshotAnnotation[];
  readonly options: AgentBrowserDriverOperationOptions;
}

export type AgentBrowserCdpScreenshotter = (
  request: AgentBrowserCdpScreenshotRequest,
) => Promise<AgentBrowserDriverOperationResult>;

/** Capture bytes directly: neither CLI IPC nor the native CDP client's 30s timer participates. */
export async function captureAgentBrowserScreenshot(
  request: AgentBrowserCdpScreenshotRequest,
): Promise<AgentBrowserDriverOperationResult> {
  return withAgentBrowserOperationDeadline(request.options, async (options) => {
    const connection = new AgentBrowserCdpConnection(
      request.cdpUrl,
      options.signal!,
      () => undefined,
      () => undefined,
    );
    let pageSession: string | undefined;
    let overlayId: string | undefined;
    try {
      const attached = await connection.send("Target.attachToTarget", { targetId: request.targetId, flatten: true });
      if (typeof attached.sessionId !== "string")
        throw new Error("The browser did not identify the screenshot tab session.");
      pageSession = attached.sessionId;
      const info = await connection.send("Target.getTargetInfo", { targetId: request.targetId });
      const target = info.targetInfo as { url?: string; title?: string } | undefined;
      if (typeof target?.url !== "string" || typeof target.title !== "string")
        throw new Error("The browser did not identify the screenshot page.");
      const metrics = await connection.send("Page.getLayoutMetrics", {}, pageSession);
      const viewport = metrics.cssVisualViewport as { pageX?: number; pageY?: number } | undefined;
      const scrollX = viewport?.pageX ?? 0;
      const scrollY = viewport?.pageY ?? 0;
      const clip = request.fullPage
        ? screenshotBox(metrics.cssContentSize)
        : request.selectorBox
          ? { ...request.selectorBox, x: request.selectorBox.x + scrollX, y: request.selectorBox.y + scrollY }
          : undefined;
      if (request.annotations.length) {
        overlayId = `senera-browser-annotations-${randomUUID()}`;
        const annotations = request.annotations.map(({ ref, box }) => ({
          ref,
          box: { ...box, x: box.x + scrollX, y: box.y + scrollY },
        }));
        await evaluateScreenshotScript(
          connection,
          pageSession,
          `(${installScreenshotOverlay.toString()})(${JSON.stringify(overlayId)},${JSON.stringify(annotations)},${options.timeoutMs})`,
        );
      }
      const captured = await connection.send(
        "Page.captureScreenshot",
        {
          format: request.format,
          ...(request.format === "jpeg" ? { quality: 80 } : {}),
          fromSurface: true,
          captureBeyondViewport: request.fullPage || Boolean(clip),
          ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
        },
        pageSession,
      );
      if (typeof captured.data !== "string" || !captured.data)
        throw new Error("The browser returned no screenshot bytes.");
      return {
        content: "Captured browser screenshot.",
        page: { url: target.url, title: target.title },
        screenshot: {
          data: Buffer.from(captured.data, "base64"),
          mediaType: request.format === "jpeg" ? "image/jpeg" : "image/png",
        },
      };
    } finally {
      connection.close();
      if (overlayId) await removeScreenshotOverlay(request, overlayId);
    }
  });
}

export function screenshotBox(value: unknown): AgentBrowserScreenshotBox {
  const box = value as Partial<AgentBrowserScreenshotBox> | null;
  if (
    !box ||
    ![box.x, box.y, box.width, box.height].every((part) => typeof part === "number" && Number.isFinite(part)) ||
    box.width! <= 0 ||
    box.height! <= 0
  ) {
    throw new Error("The browser screenshot target has no visible, finite rectangle.");
  }
  return { x: box.x!, y: box.y!, width: box.width!, height: box.height! };
}

async function evaluateScreenshotScript(
  connection: AgentBrowserCdpConnection,
  sessionId: string,
  expression: string,
): Promise<void> {
  const result = await connection.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error("The browser could not update screenshot annotations.");
}

/** This function executes in the page; its closed shadow root isolates annotation styles. */
function installScreenshotOverlay(
  id: string,
  annotations: readonly AgentBrowserScreenshotAnnotation[],
  lifetimeMs: number,
): void {
  const host = document.createElement("div");
  host.id = id;
  host.style.cssText =
    "all:initial;position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  for (const { ref, box } of annotations) {
    const outline = document.createElement("div");
    outline.style.cssText = `position:absolute;box-sizing:border-box;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;border:2px solid #dc2626;pointer-events:none`;
    const label = document.createElement("span");
    label.textContent = ref;
    label.style.cssText =
      "position:absolute;left:-2px;top:0;background:#dc2626;color:white;font:12px/18px monospace;padding:0 3px;white-space:nowrap";
    outline.append(label);
    root.append(outline);
  }
  // If the renderer stops responding during capture, remove annotations when it resumes.
  host.dataset.cleanupTimer = String(window.setTimeout(() => host.remove(), lifetimeMs));
  document.documentElement.append(host);
}

async function removeScreenshotOverlay(request: AgentBrowserCdpScreenshotRequest, id: string): Promise<void> {
  // Cancellation must still clean up the overlay, independently of the expired operation.
  const cleanup = new AgentBrowserCdpConnection(
    request.cdpUrl,
    AbortSignal.timeout(2_000),
    () => undefined,
    () => undefined,
  );
  try {
    const attached = await cleanup.send("Target.attachToTarget", { targetId: request.targetId, flatten: true });
    if (typeof attached.sessionId !== "string") return;
    await evaluateScreenshotScript(
      cleanup,
      attached.sessionId,
      `(() => { const host = document.getElementById(${JSON.stringify(id)}); if (host) { clearTimeout(Number(host.dataset.cleanupTimer)); host.remove(); } })()`,
    );
  } catch {
    // The target may have closed; the page-owned timer also removes a surviving overlay.
  } finally {
    cleanup.close();
  }
}
