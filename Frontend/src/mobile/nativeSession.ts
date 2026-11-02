import { registerPlugin } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { Preferences } from "@capacitor/preferences";
import { z } from "zod";
import {
  normalizeMobileServerUrl,
  setDeviceAuthenticationTransport,
  type AgentDeviceSessionGrant,
} from "../api/deviceAuthenticationClient";

interface NativeSessionPlugin {
  getDeviceName(): Promise<{ name: string }>;
  setCookie(options: { url: string; cookie: string }): Promise<void>;
  openWebClient(options: { url: string; serverUrl: string; bundledConsole?: boolean }): Promise<void>;
  openBackgroundSettings(): Promise<void>;
  download(options: { url: string; serverUrl: string; fileName?: string }): Promise<void>;
  request(options: {
    id: string;
    url: string;
    method: string;
    body?: string;
    csrfToken?: string;
  }): Promise<{ status: number; body: string }>;
  cancelRequest(options: { id: string }): Promise<void>;
}
export const NativeSession = registerPlugin<NativeSessionPlugin>("SeneraDeviceSession");

export function installNativeDeviceTransport(): void {
  setDeviceAuthenticationTransport(async (url, options) => {
    options.signal?.throwIfAborted();
    const id = crypto.randomUUID();
    const cancel = (): void => {
      void NativeSession.cancelRequest({ id });
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await NativeSession.request({
        id,
        url,
        method: options.method ?? "GET",
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        csrfToken: options.csrfToken,
      });
      options.signal?.throwIfAborted();
      return result;
    } finally {
      options.signal?.removeEventListener("abort", cancel);
    }
  });
}
const ConnectionsKey = "senera.mobile.connections";
const SelectedServerKey = "senera.mobile.selectedServer";
const Connections = z.array(z.object({ serverUrl: z.string(), name: z.string(), deviceName: z.string() }).strict());
export type MobileConnection = z.infer<typeof Connections>[number];

async function credentialKey(serverUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeMobileServerUrl(serverUrl)));
  return `senera.device.${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function readMobileConnections(): Promise<MobileConnection[]> {
  const { value } = await Preferences.get({ key: ConnectionsKey });
  if (value === null) return [];
  return Connections.parse(JSON.parse(value)).map((item) => ({
    ...item,
    serverUrl: normalizeMobileServerUrl(item.serverUrl),
  }));
}

export async function saveDeviceGrant(serverUrl: string, grant: AgentDeviceSessionGrant): Promise<void> {
  const origin = normalizeMobileServerUrl(serverUrl);
  await SecureStorage.set(await credentialKey(origin), grant.cookie);
  await NativeSession.setCookie({ url: origin, cookie: grant.cookie });
  const connections = await readMobileConnections();
  await Preferences.set({
    key: ConnectionsKey,
    value: JSON.stringify([
      { serverUrl: origin, name: grant.session.account.displayName, deviceName: grant.deviceName },
      ...connections.filter((item) => item.serverUrl !== origin),
    ]),
  });
  await Preferences.set({ key: SelectedServerKey, value: origin });
}

export async function restoreDeviceSession(serverUrl: string): Promise<boolean> {
  const cookie = await SecureStorage.get(await credentialKey(serverUrl));
  if (cookie === null) return false;
  if (typeof cookie !== "string") throw new Error("Invalid stored device credential.");
  await NativeSession.setCookie({ url: normalizeMobileServerUrl(serverUrl), cookie });
  return true;
}

export async function forgetDeviceSession(serverUrl: string): Promise<void> {
  const key = await credentialKey(serverUrl);
  const cookie = await SecureStorage.get(key);
  if (typeof cookie === "string") {
    const name = cookie.slice(0, cookie.indexOf("="));
    await NativeSession.setCookie({
      url: normalizeMobileServerUrl(serverUrl),
      cookie:
        new URL(serverUrl).protocol === "http:"
          ? `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
          : `${name}=; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=0`,
    });
  }
  await SecureStorage.remove(key);
  await Preferences.set({
    key: ConnectionsKey,
    value: JSON.stringify((await readMobileConnections()).filter((item) => item.serverUrl !== serverUrl)),
  });
  const selected = await Preferences.get({ key: SelectedServerKey });
  if (selected.value === serverUrl) await Preferences.remove({ key: SelectedServerKey });
}

export async function readSelectedMobileServer(): Promise<string | null> {
  return (await Preferences.get({ key: SelectedServerKey })).value;
}

export async function openMobileConnections(): Promise<void> {
  await Preferences.remove({ key: SelectedServerKey });
  window.location.reload();
}

export async function selectMobileServer(serverUrl: string): Promise<void> {
  await Preferences.set({ key: SelectedServerKey, value: normalizeMobileServerUrl(serverUrl) });
}
