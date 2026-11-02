import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { AgentRuntimeUpdateOrigin } from "../../Runtime/AgentRuntimeUpdateOrigin.js";
import { fetchWithTrustedRedirects } from "../../Runtime/AgentRuntimeUpdateHttpApi.js";
import { AgentClientExtensionStore, readClientExtensionBytes } from "./AgentClientExtensionStore.js";
import { AgentClientExtensionLimits, AgentClientExtensionManifestSchema } from "./AgentClientExtensionContract.js";
import { AgentQqClientBuild } from "./AgentQqClientBuildContract.js";

const ReleaseDescriptor = AgentClientExtensionManifestSchema.safeExtend({
  archive: z
    .object({
      name: z.string().regex(/^[\w.-]+\.zip$/u),
      bytes: z.number().int().positive().max(AgentClientExtensionLimits.archiveBytes),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .strict(),
});

/** The caller applies the host session and CSRF guard before dispatching here. */
export class AgentClientExtensionHttpApi {
  constructor(
    readonly store: AgentClientExtensionStore,
    private readonly product: { version: string; updateOrigin?: AgentRuntimeUpdateOrigin },
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse, resource: string): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const json = (status: number, value: unknown): void => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(value));
    };
    try {
      if (resource === "extension" && request.method === "GET") {
        json(200, { ...this.store.read(AgentQqClientBuild.id), releaseAvailable: Boolean(this.product.updateOrigin) });
        return;
      }
      if (resource === "extension" && request.method === "DELETE") {
        await this.store.remove(AgentQqClientBuild.id);
        json(200, { ...this.store.read(AgentQqClientBuild.id), releaseAvailable: Boolean(this.product.updateOrigin) });
        return;
      }
      if (resource === "extension" && request.method === "POST") {
        const contentType = request.headers["content-type"]?.split(";")[0];
        const archive =
          contentType === "application/zip"
            ? await readClientExtensionBytes(request, AgentClientExtensionLimits.archiveBytes)
            : contentType === "application/vnd.senera.install-release"
              ? await this.downloadRelease()
              : undefined;
        if (!archive) {
          json(415, { message: "Import a client ZIP or request the configured product release." });
          return;
        }
        const manifest = await this.store.install(AgentQqClientBuild.id, archive);
        json(200, { id: manifest.id, installed: true, manifest, releaseAvailable: Boolean(this.product.updateOrigin) });
        return;
      }
      json(405, { message: "Unsupported client extension operation." });
    } catch (error) {
      json(400, { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async downloadRelease(): Promise<Buffer> {
    const origin = this.product.updateOrigin;
    if (!origin) throw new Error("This distribution has no configured release source. Import a client ZIP instead.");
    const tag = `v${this.product.version}`;
    const signal = AbortSignal.timeout(5 * 60_000);
    const descriptorResponse = await fetchWithTrustedRedirects(
      origin.releaseAssetUrl(tag, `${AgentQqClientBuild.artifactPrefix}-${this.product.version}.json`),
      origin.trustedRedirectHosts,
      fetch,
      signal,
    );
    if (!descriptorResponse.ok)
      throw new Error(
        `Client release metadata download failed (HTTP ${descriptorResponse.status}). You can import the ZIP from a PR build.`,
      );
    const descriptorBytes = await readLimitedResponse(descriptorResponse, AgentClientExtensionLimits.manifestBytes);
    const descriptor = ReleaseDescriptor.parse(JSON.parse(descriptorBytes.toString("utf8")));
    if (descriptor.id !== AgentQqClientBuild.id || descriptor.version !== this.product.version)
      throw new Error("Client release identity does not match this host.");
    const response = await fetchWithTrustedRedirects(
      origin.releaseAssetUrl(tag, descriptor.archive.name),
      origin.trustedRedirectHosts,
      fetch,
      signal,
    );
    if (!response.ok) throw new Error(`Client package download failed (HTTP ${response.status}).`);
    const archive = await readLimitedResponse(response, descriptor.archive.bytes);
    if (
      archive.length !== descriptor.archive.bytes ||
      createHash("sha256").update(archive).digest("hex") !== descriptor.archive.sha256
    )
      throw new Error("Client package download integrity check failed.");
    return archive;
  }
}

async function readLimitedResponse(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new Error("Empty client package response.");
  return readClientExtensionBytes(response.body, limit);
}
