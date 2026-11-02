import path from "node:path";
import { create as createDisposition, parse as parseDisposition } from "content-disposition";
import { AgentBrowserCdpConnection } from "./AgentBrowserCdpConnection.js";

export interface AgentBrowserCdpDownloadRequest {
  readonly cdpUrl: string;
  readonly targetId: string;
  readonly directory: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
  readonly assertRequestPermitted: (url: string) => Promise<void>;
  readonly source: { readonly url: string } | { readonly activate: (signal: AbortSignal) => Promise<void> };
}

export interface AgentBrowserCdpDownloadResult {
  readonly filePath: string;
  readonly suggestedFilename?: string;
  readonly url?: string;
}

export type AgentBrowserCdpDownloader = (
  request: AgentBrowserCdpDownloadRequest,
) => Promise<AgentBrowserCdpDownloadResult>;

/** Browser transfers stay in their authenticated session; cookies never leave the host. */
export async function downloadAgentBrowserFile(
  request: AgentBrowserCdpDownloadRequest,
): Promise<AgentBrowserCdpDownloadResult> {
  const operation = new AbortController();
  const signal = AbortSignal.any([operation.signal, ...(request.signal ? [request.signal] : [])]);
  signal.throwIfAborted();
  const timeout = setTimeout(
    () => operation.abort(new Error(`Browser download did not complete within ${request.timeoutMs}ms.`)),
    request.timeoutMs,
  );
  let complete!: (result: AgentBrowserCdpDownloadResult) => void;
  let fail!: (error: Error) => void;
  const outcome = new Promise<AgentBrowserCdpDownloadResult>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  void outcome.catch(() => undefined);
  let guid: string | undefined;
  let suggestedFilename: string | undefined;
  let sourceUrl: string | undefined;
  let completed = false;
  let configured = false;
  let sessionId: string | undefined;
  let mainFrame: string | undefined;
  let navigated = false;
  let operationFailure: Error | undefined;
  let result!: AgentBrowserCdpDownloadResult;
  const frames = new Set<string>();
  const pageSessions = new Map<string, string>();
  const pendingDownloads = new Map<string, Record<string, unknown>>();
  const pendingProgress = new Map<string, Record<string, unknown>>();
  const ownedTargets = new Set([request.targetId]);
  const acceptDownload = (params: Record<string, unknown>): void => {
    if (guid || typeof params.frameId !== "string" || !frames.has(params.frameId)) return;
    if (
      typeof params.guid !== "string" ||
      !params.guid ||
      path.dirname(path.resolve(request.directory, params.guid)) !== path.resolve(request.directory) ||
      path.basename(params.guid) !== params.guid
    ) {
      fail(new Error("The browser reported an invalid download identifier."));
      return;
    }
    guid = params.guid;
    suggestedFilename = typeof params.suggestedFilename === "string" ? params.suggestedFilename : undefined;
    sourceUrl = typeof params.url === "string" ? params.url : undefined;
  };
  const updateDownload = (params: Record<string, unknown>): void => {
    if (!guid || params.guid !== guid) return;
    if (typeof params.receivedBytes === "number" && params.receivedBytes > request.maxBytes) {
      fail(new Error(`Browser download exceeds the configured ${request.maxBytes} byte limit.`));
    } else if (params.state === "canceled") {
      fail(new Error("Browser download was canceled."));
    } else if (params.state === "completed") {
      completed = true;
      complete({ filePath: path.join(request.directory, guid), suggestedFilename, url: sourceUrl });
    }
  };
  const connection = new AgentBrowserCdpConnection(
    request.cdpUrl,
    signal,
    (message) => {
      const params = message.params ?? {};
      if (message.method === "Target.attachedToTarget" && typeof params.sessionId === "string") {
        const childSession = params.sessionId;
        const target = params.targetInfo as { targetId: string; openerId?: string };
        void (async () => {
          if (target.openerId && ownedTargets.has(target.openerId)) {
            ownedTargets.add(target.targetId);
            pageSessions.set(childSession, "");
            await connection.send(
              "Fetch.enable",
              { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
              childSession,
            );
            await connection.send("Runtime.runIfWaitingForDebugger", {}, childSession);
            await connection.send("Page.enable", {}, childSession);
            const childTree = await connection.send("Page.getFrameTree", {}, childSession);
            const tree = childTree.frameTree as FrameTree;
            collectFrames(tree, frames);
            pageSessions.set(childSession, tree.frame.id);
            adoptPendingDownloads();
          } else await connection.send("Runtime.runIfWaitingForDebugger", {}, childSession);
        })().catch(fail);
      }
      if (message.sessionId && pageSessions.has(message.sessionId)) {
        if (
          (message.method === "Page.frameStartedNavigating" || message.method === "Page.frameStartedLoading") &&
          typeof params.frameId === "string"
        ) {
          frames.add(params.frameId);
          adoptPendingDownloads();
        }
        if (message.method === "Fetch.requestPaused") {
          void handleDownloadRequest(
            connection,
            message.sessionId,
            pageSessions.get(message.sessionId)!,
            params,
            request.assertRequestPermitted,
          ).catch(fail);
        }
        if (message.method === "Page.frameAttached" && typeof params.frameId === "string") {
          frames.add(params.frameId);
          adoptPendingDownloads();
        }
        if (message.method === "Page.frameNavigated") {
          const frame = params.frame as Frame | undefined;
          if (frame?.id) {
            frames.add(frame.id);
            adoptPendingDownloads();
          }
          if (frame?.id === mainFrame) navigated = true;
        }
        if (message.method === "Page.loadEventFired" && navigated && !guid && "activate" in request.source) {
          fail(
            new Error(
              "The control opened a page instead of downloading a file. To save its content, call BrowserDownload with url instead of selector.",
            ),
          );
        }
      }
      if (
        message.method === "Browser.downloadWillBegin" &&
        typeof params.guid === "string" &&
        typeof params.frameId === "string" &&
        !frames.has(params.frameId)
      ) {
        pendingDownloads.set(params.guid, params);
        return;
      }
      if (message.method === "Browser.downloadProgress" && typeof params.guid === "string" && !guid)
        pendingProgress.set(params.guid, params);
      if (message.method === "Browser.downloadWillBegin") acceptDownload(params);
      if (message.method === "Browser.downloadProgress") updateDownload(params);
    },
    fail,
  );
  function adoptPendingDownloads(): void {
    if (guid) return;
    for (const [id, download] of pendingDownloads) {
      if (typeof download.frameId !== "string" || !frames.has(download.frameId)) continue;
      acceptDownload(download);
      const progress = pendingProgress.get(id);
      if (progress) updateDownload(progress);
      return;
    }
  }
  try {
    const attached = await connection.send("Target.attachToTarget", { targetId: request.targetId, flatten: true });
    if (typeof attached.sessionId !== "string")
      throw new Error("The browser did not identify the controlled tab session.");
    sessionId = attached.sessionId;
    const tree = await connection.send("Page.getFrameTree", {}, sessionId);
    const frameTree = tree.frameTree as FrameTree | undefined;
    if (!frameTree?.frame.id) throw new Error("The browser did not identify the controlled page frame.");
    mainFrame = frameTree.frame.id;
    pageSessions.set(sessionId, mainFrame);
    collectFrames(frameTree, frames);
    await connection.send("Page.enable", {}, sessionId);
    await connection.send("Target.setAutoAttach", {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: true,
      filter: [{ type: "page" }, { exclude: true }],
    });
    await connection.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: request.directory,
      eventsEnabled: true,
    });
    configured = true;
    await connection.send(
      "Fetch.enable",
      {
        patterns: [
          { urlPattern: "*", requestStage: "Request" },
          ...("url" in request.source ? [{ urlPattern: "*", requestStage: "Response" }] : []),
        ],
      },
      sessionId,
    );
    const activation = (
      "url" in request.source
        ? connection.send("Page.navigate", { url: request.source.url }, sessionId).then((result) => {
            if (result.errorText && result.isDownload !== true && !guid)
              throw new Error(`Browser URL download failed: ${String(result.errorText)}`);
          })
        : request.source.activate(signal)
    ).catch((error: unknown) => {
      // Once the transfer began, browser completion is authoritative even if
      // the CLI was still waiting for the navigation interrupted by a download.
      if (!guid) throw error;
    });
    await Promise.race([activation, outcome]);
    result = await outcome;
  } catch (error) {
    operationFailure = error instanceof Error ? error : new Error(String(error), { cause: error });
  } finally {
    clearTimeout(timeout);
    try {
      if (configured) {
        // Cleanup is independently bounded so cancellation still cancels the transfer.
        const cleanup = new AgentBrowserCdpConnection(
          request.cdpUrl,
          AbortSignal.timeout(2_000),
          () => undefined,
          () => undefined,
        );
        try {
          if (guid && !completed) await cleanup.send("Browser.cancelDownload", { guid });
          await cleanup.send("Browser.setDownloadBehavior", { behavior: "default", eventsEnabled: false });
        } finally {
          cleanup.close();
        }
      }
    } catch (cleanupError) {
      operationFailure = operationFailure
        ? new AggregateError(
            [operationFailure, cleanupError],
            `${operationFailure.message}; browser download cleanup also failed.`,
            { cause: operationFailure },
          )
        : cleanupError instanceof Error
          ? cleanupError
          : new Error(String(cleanupError), { cause: cleanupError });
    } finally {
      connection.close();
      operation.abort(new Error("The browser download operation ended."));
    }
  }
  if (operationFailure) throw operationFailure;
  return result;
}

interface Frame {
  readonly id: string;
}
interface FrameTree {
  readonly frame: Frame;
  readonly childFrames?: readonly FrameTree[];
}
function collectFrames(tree: FrameTree, frames: Set<string>): void {
  frames.add(tree.frame.id);
  for (const child of tree.childFrames ?? []) collectFrames(child, frames);
}

async function handleDownloadRequest(
  connection: AgentBrowserCdpConnection,
  sessionId: string,
  mainFrame: string,
  params: Record<string, unknown>,
  assertRequestPermitted: (url: string) => Promise<void>,
): Promise<void> {
  const requestId = params.requestId;
  if (params.responseStatusCode === undefined && !params.responseErrorReason) {
    const networkRequest = params.request as { url: string };
    try {
      await assertRequestPermitted(networkRequest.url);
    } catch (error) {
      await connection.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId);
      throw error;
    }
    await connection.send("Fetch.continueRequest", { requestId }, sessionId);
    return;
  }
  const status = params.responseStatusCode as number;
  if (params.resourceType !== "Document" || params.frameId !== mainFrame || (status >= 300 && status < 400)) {
    await connection.send("Fetch.continueResponse", { requestId }, sessionId);
    return;
  }
  if (params.responseErrorReason || status < 200 || status >= 400) {
    await connection.send("Fetch.failRequest", { requestId, errorReason: "Aborted" }, sessionId);
    throw new Error(`Browser URL download failed (${String(params.responseErrorReason ?? status)}).`);
  }
  const headers = params.responseHeaders as { name: string; value: string }[];
  const disposition = headers.find((header) => header.name.toLowerCase() === "content-disposition");
  const filename = disposition ? parseDisposition(disposition.value).parameters.filename : undefined;
  await connection.send(
    "Fetch.continueResponse",
    {
      requestId,
      responseCode: status,
      responseHeaders: [
        ...headers.filter((header) => header !== disposition),
        { name: "Content-Disposition", value: createDisposition(filename) },
      ],
    },
    sessionId,
  );
}
