import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type http from "node:http";
import type { Socket } from "node:net";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { writeFileAtomicSync } from "../Core/AgentFs.js";
import type { AgentServerAccessGuard } from "./AgentServerAccessGuard.js";
import {
  isDeviceLanHost,
  normalizeAgentDeviceServerUrl,
  type AgentDeviceConnectionMethod,
  type AgentDeviceConnectionSnapshot,
} from "./AgentDeviceAuthenticationContract.js";

const execute = promisify(execFile);
const Settings = z
  .object({
    version: z.literal(1),
    serverUrl: z.string(),
    privateOrigin: z.string().optional(),
    method: z.enum(["lan", "domain", "private-network"]).optional(),
    lan: z.object({ host: z.string(), port: z.number().int().min(0).max(65535) }).optional(),
  })
  .strict();
const NetworkStatus = z.object({
  BackendState: z.string(),
  Self: z.object({ DNSName: z.string() }).nullable().optional(),
});
const ServeStatus = z.object({
  Web: z
    .record(z.string(), z.object({ Handlers: z.record(z.string(), z.object({ Proxy: z.string().optional() })) }))
    .optional(),
  AllowFunnel: z.record(z.string(), z.boolean()).optional(),
});
type PrivateNetwork = NonNullable<AgentDeviceConnectionSnapshot["privateNetwork"]>;
type Command = (args: readonly string[]) => Promise<string>;
interface LanOptions {
  createServer: () => http.Server;
  listener: { host: string; port: number };
  interfaces?: () => { name: string; address: string }[];
}

/** Only this service persists connection addresses and manages an explicitly requested private ingress. */
export class AgentDeviceConnectionService {
  private readonly file: string;
  private settings: z.infer<typeof Settings>;
  private network?: PrivateNetwork;
  private checking?: Promise<PrivateNetwork>;
  private enabling?: Promise<PrivateNetwork>;
  private lanServer?: http.Server;
  private readonly lanSockets = new Set<Socket>();
  private lanStatus?: NonNullable<AgentDeviceConnectionSnapshot["lan"]>;
  private lanOperation?: Promise<void>;

  constructor(
    private readonly access: AgentServerAccessGuard,
    private readonly command: Command = runTailscale,
    private readonly lanOptions?: LanOptions,
  ) {
    this.file = path.join(access.deviceConnectionOptions.root, ".senera/access/device-connection.json");
    this.settings = fs.existsSync(this.file)
      ? Settings.parse(JSON.parse(fs.readFileSync(this.file, "utf8")))
      : { version: 1, serverUrl: "" };
    if (this.settings.serverUrl) normalizeAgentDeviceServerUrl(this.settings.serverUrl);
    if (this.settings.privateOrigin) normalizeAgentDeviceServerUrl(this.settings.privateOrigin);
    this.syncProxyOrigins();
  }

  async snapshot(
    request: IncomingMessage,
    authorization: AgentDeviceConnectionSnapshot["authorization"],
    refresh = false,
  ): Promise<Omit<AgentDeviceConnectionSnapshot, "authorization" | "csrfToken">> {
    if (authorization === "login") return {};
    const current = this.access.deviceRequestOrigin(request);
    const interfaces = this.lanOptions?.interfaces?.() ?? localInterfaces();
    const recommended: AgentDeviceConnectionMethod | undefined = current
      ? "domain"
      : interfaces.length
        ? "lan"
        : undefined;
    const method = this.settings.method ?? (this.settings.serverUrl || current ? "domain" : "lan");
    // An optional network provider is inspected only after the user selects it.
    const privateNetwork = method === "private-network" ? await this.checkNetwork(refresh) : undefined;
    const lan = {
      state: this.lanOptions ? ("disabled" as const) : ("unavailable" as const),
      port: this.lanOptions?.listener.port ?? 0,
      ...this.lanStatus,
      interfaces,
    };
    const address =
      method === "domain"
        ? this.settings.serverUrl
          ? { url: this.settings.serverUrl, source: "saved" as const }
          : current
            ? { url: current, source: "current" as const }
            : undefined
        : method === "lan" && lan.state === "listening" && lan.url
          ? { url: lan.url, source: "lan" as const }
          : method === "private-network" && privateNetwork?.state === "serving" && privateNetwork.url
            ? { url: privateNetwork.url, source: "private-network" as const }
            : undefined;
    return { method, recommended, canManageNetwork: this.access.isLocalRequest(request), address, lan, privateNetwork };
  }

  saveAddress(value: string): void {
    const serverUrl = value.trim() ? normalizeAgentDeviceServerUrl(value) : "";
    if (serverUrl && new URL(serverUrl).protocol !== "https:") throw new Error("invalid_device_server_url");
    this.settings = { ...this.settings, serverUrl, method: serverUrl ? "domain" : undefined };
    this.save();
  }

  selectMethod(method: AgentDeviceConnectionMethod): void {
    this.settings = { ...this.settings, method };
    this.save();
  }

  async restoreLan(): Promise<void> {
    if (!this.settings.lan) return;
    try {
      await this.configureLan(this.settings.lan);
    } catch (error) {
      this.lanStatus = {
        state: "failed",
        interfaces: this.lanOptions?.interfaces?.() ?? localInterfaces(),
        port: this.settings.lan.port,
        code: error instanceof Error ? error.message : "lan_unavailable",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  configureLan(value: { host: string; port: number } | null): Promise<void> {
    if (this.lanOperation) throw new Error("connection_operation_pending");
    this.lanOperation = this.setLan(value).finally(() => {
      this.lanOperation = undefined;
    });
    return this.lanOperation;
  }

  async stop(): Promise<void> {
    await this.lanOperation;
    await this.closeLan();
  }

  private async closeLan(): Promise<void> {
    this.access.setDeviceLanOrigins([]);
    const server = this.lanServer;
    this.lanServer = undefined;
    if (!server) return;
    for (const socket of this.lanSockets) socket.destroy();
    this.lanSockets.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  private async setLan(value: { host: string; port: number } | null): Promise<void> {
    const interfaces = this.lanOptions?.interfaces?.() ?? localInterfaces();
    if (!this.lanOptions) throw new Error("lan_unavailable");
    if (value && (!isDeviceLanHost(value.host) || !interfaces.some((item) => item.address === value.host)))
      throw new Error("lan_interface_unavailable");
    await this.closeLan();
    this.settings = { ...this.settings, lan: value ?? undefined };
    this.lanStatus = undefined;
    this.save();
    if (!value) return;
    try {
      let port = value.port;
      const main = this.lanOptions.listener;
      const sharesListener = port === main.port && [value.host, "0.0.0.0", "::"].includes(main.host);
      if (!sharesListener) {
        const server = this.lanOptions.createServer();
        server.on("connection", (socket) => {
          this.lanSockets.add(socket);
          socket.once("close", () => this.lanSockets.delete(socket));
        });
        await new Promise<void>((resolve, reject) => {
          const failed = (error: Error): void => {
            server.off("listening", ready);
            reject(error);
          };
          const ready = (): void => {
            server.off("error", failed);
            resolve();
          };
          server.once("error", failed);
          server.once("listening", ready);
          server.listen(port, value.host);
        });
        this.lanServer = server;
        port = (server.address() as { port: number }).port;
        server.on("error", (error: NodeJS.ErrnoException) => {
          this.access.setDeviceLanOrigins([]);
          this.lanStatus = { state: "failed", interfaces, port, code: error.code, detail: error.message };
        });
      }
      const url = normalizeAgentDeviceServerUrl(`http://${value.host}:${port}`);
      this.access.setDeviceLanOrigins([url]);
      this.lanStatus = { state: "listening", interfaces, port, url };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      this.lanStatus = { state: "failed", interfaces, port: value.port, code: failure.code, detail: failure.message };
    }
  }

  checkNetwork(refresh = false): Promise<PrivateNetwork> {
    if (!refresh && this.network) return Promise.resolve(this.network);
    if (this.checking) return this.checking;
    this.checking = this.inspectNetwork()
      .then((network) => {
        this.network = network;
        return network;
      })
      .finally(() => {
        this.checking = undefined;
      });
    return this.checking;
  }

  enablePrivateNetwork(): Promise<PrivateNetwork> {
    if (this.enabling) return this.enabling;
    this.enabling = this.enable().finally(() => {
      this.enabling = undefined;
    });
    return this.enabling;
  }

  private async enable(): Promise<PrivateNetwork> {
    const network = await this.checkNetwork(true);
    if (network.state === "serving" || network.state !== "available") return network;
    try {
      await this.command(["serve", "--bg", "--https=443", this.access.deviceConnectionOptions.target]);
      const result = await this.checkNetwork(true);
      if (result.state === "serving" && result.url) {
        this.settings = { ...this.settings, privateOrigin: result.url };
        this.save();
      }
      return result;
    } catch (error) {
      return { state: "failed", detail: commandError(error) };
    }
  }

  private async inspectNetwork(): Promise<PrivateNetwork> {
    try {
      const status = NetworkStatus.parse(JSON.parse(await this.command(["status", "--json"])));
      if (status.BackendState !== "Running" || !status.Self?.DNSName)
        return { state: "offline", detail: status.BackendState };
      const url = normalizeAgentDeviceServerUrl(`https://${status.Self.DNSName.replace(/\.$/u, "")}`);
      const serve = ServeStatus.parse(JSON.parse(await this.command(["serve", "status", "--json"])));
      const authority = `${new URL(url).host}:443`;
      const handler = serve.Web?.[authority]?.Handlers["/"];
      if (
        handler?.Proxy &&
        new URL(handler.Proxy).href === new URL(this.access.deviceConnectionOptions.target).href &&
        serve.AllowFunnel?.[authority] !== true
      ) {
        this.settings = { ...this.settings, privateOrigin: url };
        this.save();
        return { state: "serving", url };
      }
      if (serve.Web?.[authority] || serve.AllowFunnel?.[authority] === true) return { state: "conflict", url };
      return { state: "available", url };
    } catch (error) {
      return isMissingCommand(error) ? { state: "missing" } : { state: "failed", detail: commandError(error) };
    }
  }

  private save(): void {
    writeFileAtomicSync(this.file, `${JSON.stringify(this.settings, null, 2)}\n`, { mode: 0o600 });
    this.syncProxyOrigins();
  }

  private syncProxyOrigins(): void {
    this.access.setDeviceProxyOrigins(
      [this.settings.serverUrl, this.settings.privateOrigin].filter((origin): origin is string => Boolean(origin)),
    );
  }
}

function localInterfaces(): { name: string; address: string }[] {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? [])
      .filter((entry) => !entry.internal && entry.family === "IPv4" && isDeviceLanHost(entry.address))
      .map((entry) => ({ name, address: entry.address })),
  );
}

async function runTailscale(args: readonly string[]): Promise<string> {
  const { stdout } = await execute(process.env.SENERA_TAILSCALE_PATH || "tailscale", [...args], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    encoding: "utf8",
  });
  return stdout;
}

function isMissingCommand(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function commandError(error: unknown): string {
  if (error instanceof Error && "stderr" in error && typeof error.stderr === "string" && error.stderr.trim())
    return error.stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
