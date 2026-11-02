import { Capacitor } from "@capacitor/core";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";
import { createRoot, type Root } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { FrontendI18nProvider } from "../i18n/useFrontendLocale";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { AgentAuthenticationHttpRoutes } from "../../../Source/AgentSystem/Auth/AgentAuthenticationProtocol";
import {
  AgentDeviceAuthenticationRoutes as Routes,
  deviceAuthenticationRequest,
  normalizeMobileServerUrl,
  parseDevicePairingCode,
  deviceConnectionFailure,
  type AgentDeviceSessionGrant,
} from "../api/deviceAuthenticationClient";
import { MobileConnectionView } from "./MobileConnectionView";
import {
  NativeSession,
  installNativeDeviceTransport,
  forgetDeviceSession,
  readMobileConnections,
  readSelectedMobileServer,
  restoreDeviceSession,
  saveDeviceGrant,
  selectMobileServer,
  type MobileConnection,
} from "./nativeSession";
import "../index.css";
import "../styles/fonts-bootstrap.css";
import "./mobile.css";

const element = document.getElementById("root") as (HTMLElement & { __seneraReactRoot?: Root }) | null;
installNativeDeviceTransport();
if (!element) throw new Error("Mobile application root is missing.");
const root = element.__seneraReactRoot ?? createRoot(element);
document.documentElement.dataset.nativeMobile = "true";
element.__seneraReactRoot = root;
root.render(
  <FrontendI18nProvider>
    <MobileConnection />
  </FrontendI18nProvider>,
);

function MobileConnection(): JSX.Element {
  const [fields, setFields] = useState({ serverUrl: "", deviceName: "", loginName: "", password: "" });
  const [connections, setConnections] = useState<MobileConnection[]>([]);
  const [busy, setBusy] = useState(true);
  const [restoring, setRestoring] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    void (async () => {
      if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android")
        throw new Error(frontendMessage("mobile.nativeRequired"));
      const device = await NativeSession.getDeviceName();
      if (controller.signal.aborted) return;
      setFields((value) => ({ ...value, deviceName: device.name }));
      setConnections(await readMobileConnections());
      const selected = await readSelectedMobileServer();
      if (selected) {
        setFields((value) => ({ ...value, serverUrl: selected }));
        await connectSaved(selected, controller.signal);
      }
    })()
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(message(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBusy(false);
          setRestoring(false);
        }
      });
    return () => controller.abort();
  }, []);

  const run = (task: (signal: AbortSignal) => Promise<void>): void => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    void task(controller.signal)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(message(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBusy(false);
          setWaiting(false);
          setFields((value) => ({ ...value, password: "" }));
        }
      });
  };
  return (
    <MobileConnectionView
      {...fields}
      busy={busy}
      restoring={restoring}
      waiting={waiting}
      error={error}
      connections={connections}
      onBackgroundSettings={() => {
        void NativeSession.openBackgroundSettings().catch((failure: unknown) => setError(message(failure)));
      }}
      onField={(field, value) => setFields((previous) => ({ ...previous, [field]: value }))}
      onLogin={() =>
        run(async (signal) => {
          const serverUrl = normalizeMobileServerUrl(fields.serverUrl);
          const grant = await deviceAuthenticationRequest<AgentDeviceSessionGrant>(serverUrl, Routes.Login, {
            method: "POST",
            body: { loginName: fields.loginName, password: fields.password, deviceName: fields.deviceName },
            signal,
          });
          signal.throwIfAborted();
          await saveDeviceGrant(serverUrl, grant);
          setConnections(await readMobileConnections());
          await startConsole(serverUrl);
        })
      }
      onScan={() =>
        run(async (signal) => {
          const scanned = await CapacitorBarcodeScanner.scanBarcode({
            hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
            android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.ZXING },
          });
          signal.throwIfAborted();
          const pairing = parseDevicePairingCode(scanned.ScanResult);
          setFields((value) => ({ ...value, serverUrl: pairing.serverUrl }));
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
          await deviceAuthenticationRequest(pairing.serverUrl, Routes.Claim, {
            method: "POST",
            body: { pairingId: pairing.pairingId, code: pairing.code, deviceName: fields.deviceName, secret },
            signal,
          });
          setWaiting(true);
          while (!signal.aborted) {
            const response = await deviceAuthenticationRequest<{ state: "pending" } | AgentDeviceSessionGrant>(
              pairing.serverUrl,
              Routes.Exchange,
              { method: "POST", body: { pairingId: pairing.pairingId, secret }, signal },
            );
            if ("session" in response) {
              signal.throwIfAborted();
              await saveDeviceGrant(pairing.serverUrl, response);
              setConnections(await readMobileConnections());
              await startConsole(pairing.serverUrl);
              return;
            }
            await delay(2000, signal);
          }
        })
      }
      onCancel={() => {
        operation.current?.abort();
        setBusy(false);
        setWaiting(false);
        setRestoring(false);
      }}
      onConnect={(connection) => run((signal) => connectSaved(connection.serverUrl, signal))}
      onForget={(connection) =>
        run(async () => {
          await forgetDeviceSession(connection.serverUrl);
          setConnections(await readMobileConnections());
        })
      }
    />
  );
}

async function connectSaved(serverUrl: string, signal: AbortSignal): Promise<void> {
  if (!(await restoreDeviceSession(serverUrl))) throw new Error(frontendMessage("mobile.sessionExpired"));
  signal.throwIfAborted();
  const { session: authentication } = await deviceAuthenticationRequest<{ session: { state: string } }>(
    serverUrl,
    AgentAuthenticationHttpRoutes.Session,
    { signal },
  );
  signal.throwIfAborted();
  if (authentication.state !== "authenticated") throw new Error(frontendMessage("mobile.sessionExpired"));
  await selectMobileServer(serverUrl);
  await startConsole(serverUrl);
}

async function startConsole(serverUrl: string): Promise<void> {
  const origin = normalizeMobileServerUrl(serverUrl);
  const connection = (await readMobileConnections()).find((item) => item.serverUrl === origin);
  if (!connection) throw new Error(frontendMessage("mobile.sessionExpired"));
  // The console, media, workers and sockets all use the paired origin. Keep
  // device credentials in the connector, outside the remote document.
  await NativeSession.openWebClient({ url: `${origin}/`, serverUrl: origin, bundledConsole: true });
}

function message(error: unknown): string {
  return deviceConnectionFailure(error);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
