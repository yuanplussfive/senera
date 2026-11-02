import fs from "node:fs";
import path from "node:path";
import { lookup } from "mime-types";
import type { IncomingMessage, ServerResponse } from "node:http";
import { create as createTar } from "tar";
import { z } from "zod";
import { collectQqSourceFiles } from "../../../../Frontend/qq/build/sources.js";
import { agentQqClientDocumentContext } from "./AgentQqClientDocumentContext.js";
import { AgentChannelKinds } from "../AgentChannelTypes.js";
import type { AgentChannelService } from "../AgentChannelService.js";
import { AgentStaticFrontendHttpApi } from "../../WebSocket/AgentStaticFrontendHttpApi.js";
import { readAgentOneBot11ClientRoute } from "../AgentChannelClientRoutes.js";
import { isMissingFileError } from "../../Core/AgentFs.js";
import { resolveAgentDevelopmentClientDocument } from "./AgentDevelopmentClientDocument.js";
import { AgentDevelopmentFrontendBase } from "../../WebSocket/AgentDevelopmentFrontend.js";
import {
  AgentQqClientReleaseNotFoundError,
  resolveAgentQqClientResource,
  type AgentQqClientResource,
} from "./AgentQqClientResource.js";
import { AgentQqClientBuild } from "./AgentQqClientBuildContract.js";
import type { AgentClientExtensionStore } from "./AgentClientExtensionStore.js";
import { AgentClientExtensionHttpApi } from "./AgentClientExtensionHttpApi.js";
import type { AgentProductMetadata } from "../../Core/AgentProductMetadata.js";
import { agentResourceContentHeaders } from "../../Resources/AgentResourceContentHeaders.js";

const RetireServiceWorker = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil((async () => {
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: "window" })) {
    if (client.url.startsWith(self.registration.scope)) await client.navigate(client.url);
  }
})()));
`;

const ConversationQuery = z
  .object({
    chatType: z.enum(["direct", "group"]),
    chatId: z
      .string()
      .regex(/^[1-9]\d*$/u)
      .refine((value) => Number.isSafeInteger(Number(value))),
    epoch: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

export interface AgentOneBot11ClientHttpApiOptions {
  readonly resourcesRoot: string;
  readonly extensions: AgentClientExtensionStore;
  readonly product: AgentProductMetadata;
  readonly mediaRoot: string;
  readonly resolveMediaMetadata?: (storageName: string) => { readonly name: string; readonly mime: string } | undefined;
  /** Explicitly supplied only by development entrypoints; never substitutes stale build output. */
  readonly developmentFrontendUrl?: string;
  readonly conversations?: Pick<
    AgentChannelService,
    | "resolveClientConversation"
    | "clearClientConversation"
    | "readClientTimeline"
    | "deleteClientTask"
    | "readClientConversations"
  >;
}

/** Workspace entry for an optional QQ document, using the host's authentication. */
export class AgentOneBot11ClientHttpApi {
  private resources?: {
    client: AgentQqClientResource;
    web: AgentStaticFrontendHttpApi;
  };

  private readonly extensions: AgentClientExtensionHttpApi;
  constructor(private readonly options: AgentOneBot11ClientHttpApiOptions) {
    this.extensions = new AgentClientExtensionHttpApi(options.extensions, options.product);
  }

  canHandle(request: IncomingMessage): boolean {
    return Boolean(readAgentOneBot11ClientRoute(new URL(request.url ?? "/", "http://senera.local").pathname));
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url!, "http://senera.local");
    const route = readAgentOneBot11ClientRoute(url.pathname)!;
    if (route.resource === "extension" || route.resource.startsWith("extension/")) {
      await this.extensions.handle(request, response, route.resource);
      return;
    }
    if (route.resource === "conversations") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end();
        return;
      }
      if (!this.options.conversations) {
        response.writeHead(503);
        response.end(JSON.stringify({ message: "Conversation management is unavailable." }));
        return;
      }
      const conversations = await this.options.conversations.readClientConversations(AgentChannelKinds.OneBot11);
      response.writeHead(200);
      response.end(JSON.stringify({ conversations }));
      return;
    }
    if (["conversation", "timeline", "task"].includes(route.resource)) {
      await this.handleConversation(request, response, url, route.resource);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    // Media is workspace-owned and remains readable even if the channel is currently off.
    if (route.resource.startsWith("media/")) {
      let media: AgentStaticFrontendHttpApi;
      try {
        media = new AgentStaticFrontendHttpApi({
          rootDir: this.options.mediaRoot,
          contentHeaders: (filePath) =>
            agentResourceContentHeaders(
              this.options.resolveMediaMetadata?.(path.basename(filePath)) ?? {
                mime: lookup(filePath) || "application/octet-stream",
                name: path.basename(filePath),
              },
            ),
        });
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
        response.writeHead(404);
        response.end();
        return;
      }
      this.serveStatic(media, route.resource.slice("media/".length), request, response);
      return;
    }
    if (this.options.developmentFrontendUrl && route.resource.startsWith("development/")) {
      await this.handleDevelopment(request, response, {
        ...route,
        resource: route.resource.slice("development/".length),
      });
      return;
    }
    const releaseRoute = /^releases\/([a-f0-9]{64})\/(.*)$/u.exec(route.resource);
    const resource = releaseRoute ? releaseRoute[2]! : route.resource;
    let resources;
    try {
      resources = this.readResources(releaseRoute?.[1]);
    } catch (error) {
      if (!(error instanceof AgentQqClientReleaseNotFoundError)) throw error;
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : error.message);
      return;
    }
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (resource === "source.tar.gz") {
      response.writeHead(302, { Location: resources.client.manifest.source.url, "Cache-Control": "no-store" });
      response.end();
      return;
    }
    // Retire an older upstream PWA without letting its cached index replace
    // the host-owned bootstrap. Existing clients reload only within this scope.
    if (resource === "sw.js") {
      response.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : RetireServiceWorker);
      return;
    }
    if (resource === "" || resource === "index.html" || resource === AgentQqClientBuild.entryDocument) {
      const releaseRoot = `${route.root}releases/${resources.client.release}/`;
      const entryDirectory = path
        .relative(resources.client.webRoot, path.dirname(resources.client.entryFile))
        .split(path.sep)
        .join("/");
      const html = this.hostDocument(
        fs.readFileSync(resources.client.entryFile, "utf8"),
        route,
        path.posix.join(releaseRoot, entryDirectory, "/"),
        `${releaseRoot}source.tar.gz`,
      );
      const contents = Buffer.from(html);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": contents.length,
        "Cache-Control": "no-store",
        Link: `<${releaseRoot}source.tar.gz>; rel="license"; title="Corresponding source (AGPL-3.0-only)"`,
      });
      response.end(request.method === "HEAD" ? undefined : contents);
      return;
    }
    if (!releaseRoute) {
      response.writeHead(302, {
        Location: `${route.root}releases/${resources.client.release}/${resource}`,
        "Cache-Control": "no-store",
      });
      response.end();
      return;
    }
    this.serveStatic(resources.web, resource, request, response);
  }

  private hostDocument(
    html: string,
    route: NonNullable<ReturnType<typeof readAgentOneBot11ClientRoute>>,
    base: string,
    source: string,
  ): string {
    const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
    const context = agentQqClientDocumentContext(
      route,
      this.options.developmentFrontendUrl ? AgentDevelopmentFrontendBase : "/",
    );
    const metadata = Object.entries(context)
      .map(([name, value]) => `<meta name="${name}" content="${escape(value)}">`)
      .join("");
    return html.replace(
      "<head>",
      `<head><base href="${escape(base)}">${metadata}<link rel="license" href="${escape(source)}">`,
    );
  }

  private async handleDevelopment(
    request: IncomingMessage,
    response: ServerResponse,
    route: NonNullable<ReturnType<typeof readAgentOneBot11ClientRoute>>,
  ): Promise<void> {
    if (route.resource === "source.tar.gz") {
      const sources = await collectQqSourceFiles(this.options.resourcesRoot);
      response.writeHead(200, { "Content-Type": "application/gzip", "Cache-Control": "no-store" });
      if (request.method === "HEAD") response.end();
      else {
        const archive = createTar({ cwd: this.options.resourcesRoot, gzip: true }, [...sources]);
        response.on("close", () => archive.destroy());
        archive.on("error", (error) => response.destroy(error instanceof Error ? error : new Error(String(error))));
        archive.pipe(response);
      }
      return;
    }
    if (route.resource === "sw.js") {
      response.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : RetireServiceWorker);
      return;
    }
    if (route.resource !== "" && route.resource !== "index.html") {
      response.writeHead(404);
      response.end();
      return;
    }
    const entry = new URL(
      `${AgentDevelopmentFrontendBase}${AgentQqClientBuild.entryDocument}`,
      this.options.developmentFrontendUrl,
    );
    const abort = new AbortController();
    response.on("close", () => abort.abort());
    const document = await fetch(entry, { signal: abort.signal });
    if (!document.ok) throw new Error(`QQ development entry is unavailable (${document.status}).`);
    const html = this.hostDocument(
      await resolveAgentDevelopmentClientDocument(await document.text(), entry),
      route,
      entry.pathname,
      `${route.root}development/source.tar.gz`,
    );
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : html);
  }

  private async handleConversation(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    resource: string,
  ): Promise<void> {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    const allowed = resource === "timeline" ? ["GET"] : resource === "task" ? ["DELETE"] : ["GET", "DELETE"];
    if (!allowed.includes(request.method ?? "")) {
      response.writeHead(405, { Allow: "GET, DELETE" });
      response.end(JSON.stringify({ message: "Conversation management accepts GET and DELETE." }));
      return;
    }
    const schema =
      resource === "timeline"
        ? ConversationQuery.extend({
            before: z.coerce.number().int().positive().optional(),
            after: z.coerce.number().int().nonnegative().optional(),
            revision: z.coerce.number().int().nonnegative().optional(),
          }).refine(
            (value) =>
              (value.after === undefined) === (value.revision === undefined) &&
              !(value.before !== undefined && value.after !== undefined),
          )
        : resource === "task"
          ? ConversationQuery.extend({ messageId: z.string().regex(/^[1-9]\d*$/u) })
          : ConversationQuery;
    const parameters = Object.fromEntries(url.searchParams);
    const query = schema.safeParse(parameters);
    if (
      !query.success ||
      (resource === "conversation" && request.method === "DELETE" && query.data.epoch === undefined)
    ) {
      response.writeHead(400);
      response.end(JSON.stringify({ message: "A valid conversation and current epoch are required." }));
      return;
    }
    const control = this.options.conversations;
    if (!control) {
      response.writeHead(503);
      response.end(JSON.stringify({ message: "Conversation management is unavailable." }));
      return;
    }
    const { chatType, chatId, epoch } = query.data;
    const conversation = { chatType, chatId };
    if (resource === "timeline") {
      const page = await control.readClientTimeline(
        AgentChannelKinds.OneBot11,
        conversation,
        parameters.before === undefined ? undefined : Number(parameters.before),
        parameters.after === undefined
          ? undefined
          : { after: { sequence: Number(parameters.after), revision: Number(parameters.revision) } },
      );
      response.writeHead(200);
      response.end(JSON.stringify(page));
      return;
    }
    if (resource === "task") {
      await control.deleteClientTask(AgentChannelKinds.OneBot11, conversation, parameters.messageId!);
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "DELETE") {
      const cleared = await control.clearClientConversation(AgentChannelKinds.OneBot11, conversation, epoch!);
      if (!cleared) {
        response.writeHead(409);
        response.end(JSON.stringify({ message: "The conversation changed. Refresh before clearing it." }));
        return;
      }
    }
    response.writeHead(200);
    response.end(JSON.stringify(control.resolveClientConversation(AgentChannelKinds.OneBot11, conversation)));
  }

  private readResources(release?: string): NonNullable<AgentOneBot11ClientHttpApi["resources"]> {
    const client = resolveAgentQqClientResource(this.extensions.store, release);
    if (this.resources?.client.release === client.release) return this.resources;
    this.resources = {
      client,
      web: new AgentStaticFrontendHttpApi({
        rootDir: client.webRoot,
      }),
    };
    return this.resources;
  }

  private serveStatic(
    api: AgentStaticFrontendHttpApi,
    resource: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const original = request.url;
    request.url = `/${resource}`;
    try {
      api.handle(request, response);
    } finally {
      request.url = original;
    }
  }
}
