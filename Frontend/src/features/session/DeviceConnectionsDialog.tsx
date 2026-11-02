import { useCallback, useEffect, useRef, useState } from "react";
import { AppIcon, Dialog, DialogActionButton, DialogActions, DialogContent } from "../../shared/ui";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useFrontendLocale } from "../../i18n/useFrontendLocale";
import { useActiveServerAuthentication } from "../../app/useServerAuthentication";
import {
  AgentDeviceAuthenticationRoutes as Routes,
  DeviceAuthenticationError,
  deviceAuthenticationRequest,
  type AgentDeviceConnectionSnapshot,
  type ConnectedDevice,
  type PendingDevice,
} from "../../api/deviceAuthenticationClient";
import { DeviceConnectionPanel } from "./DeviceConnectionPanel";

interface Pairing {
  pairingId: string;
  code: string;
  expiresAt: string;
  serverUrl: string;
}

export function DeviceConnectionsDialog({
  open,
  onOpenChange,
  httpBaseUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  httpBaseUrl: string;
}): JSX.Element {
  const authentication = useActiveServerAuthentication();
  const revalidateAuthentication = authentication.revalidate;
  const activeCsrfToken =
    authentication.state.status === "authenticated" && authentication.state.authentication.state === "authenticated"
      ? authentication.state.authentication.csrfToken
      : undefined;
  const [snapshot, setSnapshot] = useState<AgentDeviceConnectionSnapshot>();
  const [pairing, setPairing] = useState<Pairing>();
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [devices, setDevices] = useState<ConnectedDevice[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reviewId, setReviewId] = useState<string | undefined>(undefined);
  const seenPairingIds = useRef(new Set<string>());
  const autoRefreshedPairing = useRef<string | undefined>(undefined);
  useFrontendLocale();
  const operation = useRef<AbortController | undefined>(undefined);
  const canvas = useRef<HTMLCanvasElement>(null);
  const expired = pairing !== undefined && Date.parse(pairing.expiresAt) <= now;
  const reviewRequest = reviewId ? pending.find((request) => request.pairingId === reviewId) : undefined;

  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Date.parse(pairing.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing]);

  const createPairing = useCallback(
    async (connection: AgentDeviceConnectionSnapshot, signal: AbortSignal, keepCurrent = false): Promise<void> => {
      if (!keepCurrent) setPairing(undefined);
      if (connection.authorization !== "authorized" || !connection.address) {
        setPairing(undefined);
        return;
      }
      const code = await deviceAuthenticationRequest<Omit<Pairing, "serverUrl">>(httpBaseUrl, Routes.Pairings, {
        method: "POST",
        body: {},
        csrfToken: connection.csrfToken,
        signal,
      });
      signal.throwIfAborted();
      setPairing({ ...code, serverUrl: connection.address.url });
      setNow(Date.now());
    },
    [httpBaseUrl],
  );

  const load = useCallback(
    async (signal: AbortSignal, refresh = false): Promise<void> => {
      const connection = await deviceAuthenticationRequest<AgentDeviceConnectionSnapshot>(
        httpBaseUrl,
        `${Routes.Connection}${refresh ? "?refresh=true" : ""}`,
        { signal },
      );
      signal.throwIfAborted();
      if (connection.authorization === "login") throw new DeviceAuthenticationError("authentication_required", 401);
      setSnapshot(connection);
      await createPairing(connection, signal);
    },
    [createPairing, httpBaseUrl],
  );

  const reportFailure = useCallback(
    async (failure: unknown, signal: AbortSignal): Promise<void> => {
      if (signal.aborted) return;
      if (failure instanceof DeviceAuthenticationError && failure.status === 401) {
        const result = await revalidateAuthentication();
        if (signal.aborted || result === "authorized" || result === "anonymous" || result === "superseded") return;
      }
      if (!signal.aborted)
        setError(failure instanceof Error ? failure.message : frontendMessage("mobile.requestFailed"));
    },
    [revalidateAuthentication],
  );

  const run = useCallback(
    (task: (signal: AbortSignal) => Promise<void>): void => {
      operation.current?.abort();
      const controller = new AbortController();
      operation.current = controller;
      setBusy(true);
      setError("");
      void task(controller.signal)
        .catch((failure: unknown) => reportFailure(failure, controller.signal))
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    },
    [reportFailure],
  );

  useEffect(() => {
    if (!open) return;
    run((signal) => load(signal));
    return () => {
      operation.current?.abort();
      setPairing(undefined);
      setSnapshot(undefined);
      setPending([]);
      setDevices([]);
    };
  }, [activeCsrfToken, load, open, run]);

  const csrfToken = snapshot?.authorization === "authorized" ? snapshot.csrfToken : undefined;
  useEffect(() => {
    if (!open || !csrfToken) return;
    const controller = new AbortController();
    let refreshing = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async (): Promise<void> => {
      if (controller.signal.aborted || refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const [list, requests] = await Promise.all([
          deviceAuthenticationRequest<{ devices: ConnectedDevice[] }>(httpBaseUrl, Routes.Devices, {
            signal: controller.signal,
          }),
          deviceAuthenticationRequest<{ pending: PendingDevice[] }>(httpBaseUrl, Routes.Pairings, {
            signal: controller.signal,
          }),
        ]);
        if (controller.signal.aborted) return;
        setDevices(list.devices);
        setPending(requests.pending);
        setNow(Date.now());
        timer = setTimeout(() => void refresh(), 2000);
      } catch (failure) {
        if (controller.signal.aborted) return;
        await reportFailure(failure, controller.signal);
      } finally {
        refreshing = false;
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [csrfToken, httpBaseUrl, open, reportFailure]);

  useEffect(() => {
    if (!pairing || !canvas.current || expired) return;
    let disposed = false;
    void import("qrcode")
      .then(async ({ toCanvas }) => {
        if (disposed || !canvas.current) return;
        await toCanvas(
          canvas.current,
          JSON.stringify({
            version: 1,
            serverUrl: pairing.serverUrl,
            pairingId: pairing.pairingId,
            code: pairing.code,
          }),
          { width: 216, margin: 2 },
        );
      })
      .catch((failure: unknown) => {
        if (!disposed) setError(failure instanceof Error ? failure.message : frontendMessage("mobile.requestFailed"));
      });
    return () => {
      disposed = true;
    };
  }, [expired, pairing]);

  useEffect(() => {
    if (!open || !pending.length) return;
    const unseen = pending.find((request) => !seenPairingIds.current.has(request.pairingId));
    if (!unseen) return;
    for (const request of pending) seenPairingIds.current.add(request.pairingId);
    setReviewId(unseen.pairingId);
  }, [open, pending]);

  useEffect(() => {
    if (!open || !expired || !pairing || snapshot?.authorization !== "authorized") return;
    if (autoRefreshedPairing.current === pairing.pairingId) return;
    autoRefreshedPairing.current = pairing.pairingId;
    const controller = new AbortController();
    void createPairing(snapshot, controller.signal, true).catch((failure: unknown) => {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : frontendMessage("mobile.requestFailed"));
    });
    return () => controller.abort();
  }, [createPairing, expired, open, pairing, snapshot]);

  const decide = (request: PendingDevice, approve: boolean): void => {
    setReviewId(undefined);
    run(async (signal) => {
      await deviceAuthenticationRequest(httpBaseUrl, Routes.Approve, {
        method: "POST",
        body: { pairingId: request.pairingId, approve },
        csrfToken,
        signal,
      });
      if (signal.aborted) return;
      setPending((list) => list.filter((item) => item.pairingId !== request.pairingId));
      // 批准后保留当前二维码，等手机用已批准的配对完成 exchange。
      // 此时立即轮换会让后端删除旧配对，手机随后 exchange 会得到 pairing_unavailable。
      if (!approve && snapshot?.authorization === "authorized") await createPairing(snapshot, signal, true);
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title={frontendMessage("mobile.connectPhone")}
          className="w-[min(480px,calc(100vw-24px))]"
          bodyClassName="overflow-y-auto px-6 pb-6"
        >
          <DeviceConnectionPanel
            snapshot={snapshot}
            busy={busy}
            error={error}
            pending={pending}
            devices={devices}
            qr={
              pairing ? (
                <canvas ref={canvas} className="max-w-full rounded-lg" aria-label={frontendMessage("mobile.qrCode")} />
              ) : undefined
            }
            expiresAt={pairing?.expiresAt}
            expired={expired}
            onRefresh={() => run((signal) => load(signal, true))}
            onSaveAddress={(serverUrl) =>
              run(async (signal) => {
                if (!csrfToken) return;
                const connection = await deviceAuthenticationRequest<AgentDeviceConnectionSnapshot>(
                  httpBaseUrl,
                  Routes.Connection,
                  { method: "POST", body: { serverUrl }, csrfToken, signal },
                );
                signal.throwIfAborted();
                setSnapshot(connection);
                await createPairing(connection, signal);
              })
            }
            onSelectMethod={(method) =>
              run(async (signal) => {
                const connection = await deviceAuthenticationRequest<AgentDeviceConnectionSnapshot>(
                  httpBaseUrl,
                  Routes.Connection,
                  {
                    method: "POST",
                    body: { method },
                    csrfToken,
                    signal,
                  },
                );
                signal.throwIfAborted();
                setSnapshot(connection);
                await createPairing(connection, signal);
              })
            }
            onConfigureLan={(value) =>
              run(async (signal) => {
                const connection = await deviceAuthenticationRequest<AgentDeviceConnectionSnapshot>(
                  httpBaseUrl,
                  Routes.Lan,
                  {
                    method: "POST",
                    body: value,
                    csrfToken,
                    signal,
                  },
                );
                signal.throwIfAborted();
                setSnapshot(connection);
                await createPairing(connection, signal);
              })
            }
            onEnablePrivateNetwork={() =>
              run(async (signal) => {
                if (!csrfToken) return;
                const connection = await deviceAuthenticationRequest<AgentDeviceConnectionSnapshot>(
                  httpBaseUrl,
                  Routes.PrivateNetwork,
                  { method: "POST", body: {}, csrfToken, signal },
                );
                signal.throwIfAborted();
                setSnapshot(connection);
                await createPairing(connection, signal);
              })
            }
            onReview={(request) => setReviewId(request.pairingId)}
            onRevoke={(device) =>
              run(async (signal) => {
                await deviceAuthenticationRequest(httpBaseUrl, Routes.Devices, {
                  method: "DELETE",
                  body: { deviceId: device.id },
                  csrfToken,
                  signal,
                });
                if (!signal.aborted) setDevices((list) => list.filter((item) => item.id !== device.id));
              })
            }
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={reviewRequest !== undefined}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setReviewId(undefined);
        }}
      >
        <DialogContent
          title={frontendMessage("mobile.approvalTitle")}
          description={frontendMessage("mobile.approvalDescription")}
          className="w-[min(420px,calc(100vw-28px))]"
          bodyClassName="px-6 pb-2"
          footerClassName="border-t border-line-subtle bg-surface-subtle/35"
          footer={
            <DialogActions>
              <DialogActionButton disabled={busy} onClick={() => reviewRequest && decide(reviewRequest, false)}>
                {frontendMessage("mobile.deny")}
              </DialogActionButton>
              <DialogActionButton
                variant="primary"
                disabled={busy}
                onClick={() => reviewRequest && decide(reviewRequest, true)}
              >
                {frontendMessage("mobile.allow")}
              </DialogActionButton>
            </DialogActions>
          }
        >
          <div className="flex items-start gap-3 rounded-xl border border-line-default bg-surface-subtle/55 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-surface text-accent-content">
              <AppIcon icon="login" size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="break-words text-[15px] font-medium text-content-primary">{reviewRequest?.deviceName}</p>
              <p className="mt-1 text-xs leading-5 text-content-secondary">{frontendMessage("mobile.confirmDevice")}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
