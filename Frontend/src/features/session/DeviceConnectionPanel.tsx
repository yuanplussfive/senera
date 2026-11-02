import { useEffect, useState, type ReactNode } from "react";
import {
  AppIcon,
  Button,
  FormField,
  FormHint,
  FormLabel,
  IconButton,
  Input,
  Spinner,
  MenuSelect,
  SegmentedControl,
} from "../../shared/ui";
import { openExternalUrl } from "../../app/desktopBridge";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useFrontendLocale } from "../../i18n/useFrontendLocale";
import { formatDateTime } from "../../lib/util";
import type {
  AgentDeviceConnectionSnapshot,
  ConnectedDevice,
  PendingDevice,
  AgentDeviceConnectionMethod,
} from "../../api/deviceAuthenticationClient";

export interface DeviceConnectionPanelProps {
  snapshot?: AgentDeviceConnectionSnapshot;
  busy: boolean;
  error: string;
  pending: readonly PendingDevice[];
  devices: readonly ConnectedDevice[];
  qr?: ReactNode;
  expiresAt?: string;
  expired: boolean;
  onRefresh: () => void;
  onSaveAddress: (serverUrl: string) => void;
  onEnablePrivateNetwork: () => void;
  onSelectMethod: (method: AgentDeviceConnectionMethod) => void;
  onConfigureLan: (value: { host: string; port: number } | null) => void;
  onReview: (request: PendingDevice) => void;
  onRevoke: (device: ConnectedDevice) => void;
}

export function DeviceConnectionPanel(props: DeviceConnectionPanelProps): JSX.Element {
  const { snapshot, busy, error, pending, devices } = props;
  const locale = useFrontendLocale();
  const [serverUrl, setServerUrl] = useState(snapshot?.address?.url ?? "");
  const [lanHost, setLanHost] = useState("");
  const [lanPort, setLanPort] = useState("");
  useEffect(() => {
    setLanHost(
      snapshot?.lan?.url
        ? new URL(snapshot.lan.url).hostname
        : snapshot?.lan?.interfaces.length === 1
          ? snapshot.lan.interfaces[0].address
          : "",
    );
    setLanPort(snapshot?.lan?.port ? String(snapshot.lan.port) : "");
  }, [snapshot?.lan]);
  useEffect(() => {
    setServerUrl(snapshot?.address?.url ?? "");
  }, [snapshot?.address?.url]);
  const network = snapshot?.privateNetwork;
  const method = snapshot?.method ?? (snapshot?.address ? "domain" : "lan");
  return (
    <div className="space-y-5 text-sm">
      <p className="leading-6 text-content-secondary">{frontendMessage("mobile.pairingSimpleDescription")}</p>
      {!snapshot ? (
        <div role="status" className="flex items-center gap-2 py-6 text-content-muted">
          <Spinner size="sm" />
          {frontendMessage("mobile.detectingConnection")}
        </div>
      ) : null}
      {snapshot?.authorization === "authorized" ? (
        <section className="space-y-4" aria-label={frontendMessage("mobile.connectionMethod")}>
          <SegmentedControl<AgentDeviceConnectionMethod>
            ariaLabel={frontendMessage("mobile.connectionMethod")}
            value={method}
            disabled={busy}
            className="w-full"
            options={[
              { value: "lan", label: frontendMessage("mobile.methodLan") },
              { value: "domain", label: frontendMessage("mobile.methodDomain") },
              { value: "private-network", label: frontendMessage("mobile.methodPrivate") },
            ]}
            onChange={props.onSelectMethod}
          />
          {snapshot.recommended ? (
            <p className="text-xs leading-5 text-content-muted">
              {frontendMessage(snapshot.recommended === "lan" ? "mobile.recommendLan" : "mobile.recommendDomain")}
            </p>
          ) : null}
          {method === "lan" ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                props.onConfigureLan({ host: lanHost, port: Number(lanPort) });
              }}
            >
              <p className="leading-6 text-content-secondary">{frontendMessage("mobile.lanDescription")}</p>
              {snapshot.lan?.interfaces.length ? (
                <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-end gap-3">
                  <FormField>
                    <FormLabel>{frontendMessage("mobile.lanInterface")}</FormLabel>
                    <MenuSelect
                      value={lanHost}
                      ariaLabel={frontendMessage("mobile.lanInterface")}
                      placeholder={frontendMessage("mobile.lanInterface")}
                      size="md"
                      disabled={busy || !snapshot.canManageNetwork}
                      triggerClassName="w-full"
                      options={snapshot.lan.interfaces.map((item) => ({
                        value: item.address,
                        label: `${item.name} · ${item.address}`,
                      }))}
                      onChange={setLanHost}
                    />
                  </FormField>
                  <FormField>
                    <FormLabel>
                      <label htmlFor="device-lan-port">{frontendMessage("mobile.lanPort")}</label>
                    </FormLabel>
                    <Input
                      id="device-lan-port"
                      size="sm"
                      type="number"
                      min={1}
                      max={65535}
                      required
                      value={lanPort}
                      disabled={busy || !snapshot.canManageNetwork}
                      onChange={(event) => setLanPort(event.target.value)}
                    />
                  </FormField>
                </div>
              ) : (
                <p className="text-content-muted">{frontendMessage("mobile.lanNoInterface")}</p>
              )}
              {snapshot.canManageNetwork ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    loading={busy}
                    disabled={!lanHost || !lanPort || snapshot.lan?.state === "unavailable"}
                  >
                    {frontendMessage(snapshot.lan?.state === "listening" ? "mobile.lanApply" : "mobile.lanEnable")}
                  </Button>
                  {snapshot.lan?.state === "listening" ? (
                    <Button type="button" variant="ghost" disabled={busy} onClick={() => props.onConfigureLan(null)}>
                      {frontendMessage("mobile.lanDisable")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-content-muted">{frontendMessage("mobile.networkLocalOnly")}</p>
              )}
              {snapshot.lan?.state === "failed" ? (
                <div role="alert" className="space-y-2 text-brick-600">
                  <p>
                    {frontendMessage(
                      snapshot.lan.code === "EADDRINUSE"
                        ? "mobile.lanPortUsed"
                        : snapshot.lan.code === "EACCES"
                          ? "mobile.lanDenied"
                          : snapshot.lan.code === "lan_interface_unavailable"
                            ? "mobile.lanInterfaceLost"
                            : "mobile.lanFailed",
                    )}
                  </p>
                  <p className="break-all text-xs">{snapshot.lan.detail}</p>
                </div>
              ) : null}
            </form>
          ) : null}
        </section>
      ) : null}
      {snapshot?.authorization === "login" ? (
        <p role="status" className="text-content-secondary">
          {frontendMessage("mobile.signInToApprove")}
        </p>
      ) : null}
      {snapshot?.address ? (
        <section aria-label={frontendMessage("mobile.connectPhone")}>
          <div className="flex items-center gap-3">
            <AppIcon icon="link" size={18} className="shrink-0 text-content-muted" />
            <div className="min-w-0 flex-1">
              <p className="break-all font-medium">{new URL(snapshot.address.url).host}</p>
              <p className="mt-0.5 text-xs text-content-muted">
                {frontendMessage(
                  snapshot.address.source === "lan"
                    ? "mobile.lanReady"
                    : snapshot.address.source === "private-network"
                      ? "mobile.privateConnectionReady"
                      : "mobile.addressDetected",
                )}
              </p>
            </div>
            <IconButton label={frontendMessage("mobile.refreshConnection")} disabled={busy} onClick={props.onRefresh}>
              <AppIcon icon="refresh" size={16} />
            </IconButton>
          </div>
          <div className="flex min-h-56 flex-col items-center justify-center py-4">
            <div className="relative flex items-center justify-center">
              {props.qr ?? <Spinner size="sm" />}
              {props.expired ? (
                <div
                  role="status"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-surface-canvas px-3 text-center"
                >
                  <Spinner size="sm" />
                  <p className="text-xs leading-5 text-content-secondary">{frontendMessage("mobile.refreshingCode")}</p>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={props.onRefresh}>
                    {frontendMessage("mobile.refreshNow")}
                  </Button>
                </div>
              ) : null}
            </div>
            {props.expiresAt && !props.expired ? (
              <>
                <p className="mt-2 text-xs text-content-muted">
                  {frontendMessage("mobile.codeExpiry", {
                    time: formatExpiryTime(props.expiresAt, locale),
                  })}
                </p>
                <p className="mt-1 text-xs text-content-muted">{frontendMessage("mobile.codeAutoRefresh")}</p>
              </>
            ) : null}
          </div>
        </section>
      ) : null}
      {network && method === "private-network" ? (
        <section className="space-y-3" aria-label={frontendMessage("mobile.privateConnection")}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium">{frontendMessage("mobile.privateConnection")}</h3>
            <IconButton label={frontendMessage("mobile.refreshConnection")} disabled={busy} onClick={props.onRefresh}>
              <AppIcon icon="refresh" size={16} />
            </IconButton>
          </div>
          <p className="leading-6 text-content-secondary">{frontendMessage("mobile.privateConnectionDescription")}</p>
          <p className="leading-6 text-content-secondary">
            {frontendMessage(
              network.state === "missing"
                ? "mobile.networkInstall"
                : network.state === "offline"
                  ? "mobile.networkSignIn"
                  : network.state === "available"
                    ? "mobile.networkEnable"
                    : network.state === "conflict"
                      ? "mobile.networkConflict"
                      : network.state === "serving"
                        ? "mobile.privateConnectionReady"
                        : "mobile.networkFailed",
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {network.state === "available" && snapshot?.canManageNetwork ? (
              <Button loading={busy} onClick={props.onEnablePrivateNetwork}>
                {frontendMessage("mobile.enablePrivateConnection")}
              </Button>
            ) : null}
            {network.state === "missing" || network.state === "offline" ? (
              <Button
                variant="ghost"
                onClick={() => {
                  void openExternalUrl("https://tailscale.com/download");
                }}
              >
                {frontendMessage("mobile.openTailscale")}
              </Button>
            ) : null}
          </div>
          {network.detail && (network.state === "failed" || network.state === "conflict") ? (
            <details className="text-xs text-content-muted">
              <summary className="cursor-pointer">{frontendMessage("mobile.connectionDetails")}</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono">
                {network.detail}
              </pre>
            </details>
          ) : null}
        </section>
      ) : null}
      {snapshot?.authorization === "authorized" && method === "domain" ? (
        <section className="border-t border-line-subtle pt-4">
          <h3 className="text-content-secondary">{frontendMessage("mobile.customAddress")}</h3>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              props.onSaveAddress(serverUrl);
            }}
          >
            <FormField>
              <FormLabel>
                <label htmlFor="device-server-address">{frontendMessage("mobile.serverAddress")}</label>
              </FormLabel>
              <Input
                id="device-server-address"
                type="url"
                inputMode="url"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://"
              />
              <FormHint>{frontendMessage("mobile.savedAddressHint")}</FormHint>
            </FormField>
            <div className="flex items-center gap-2">
              <Button type="submit" loading={busy}>
                {frontendMessage("mobile.saveAddress")}
              </Button>
              {snapshot.address?.source === "saved" ? (
                <Button type="button" variant="ghost" disabled={busy} onClick={() => props.onSaveAddress("")}>
                  {frontendMessage("mobile.useDetectedAddress")}
                </Button>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}
      {pending.length ? (
        <section className="space-y-3" aria-label={frontendMessage("mobile.pendingDevices")}>
          <h3 className="font-medium">{frontendMessage("mobile.pendingDevices")}</h3>
          {pending.map((request) => (
            <div key={request.pairingId} className="flex flex-wrap items-center gap-3 border-t border-line-subtle py-3">
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">{request.deviceName}</p>
                <p className="mt-1 text-xs text-content-secondary">{frontendMessage("mobile.waitingApproval")}</p>
              </div>
              <Button size="sm" disabled={busy} onClick={() => props.onReview(request)}>
                {frontendMessage("mobile.approvalReview")}
              </Button>
            </div>
          ))}
        </section>
      ) : null}
      {snapshot?.authorization === "authorized" ? (
        <section className="border-t border-line-subtle pt-4" aria-label={frontendMessage("mobile.connectedDevices")}>
          <h3 className="mb-2 font-medium">{frontendMessage("mobile.connectedDevices")}</h3>
          {devices.length ? (
            devices.map((device) => (
              <div key={device.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{device.name}</p>
                  <p className="mt-1 text-xs text-content-muted">{formatDateTime(device.lastSeenAt)}</p>
                </div>
                <Button variant="ghost" disabled={busy} onClick={() => props.onRevoke(device)}>
                  {frontendMessage("mobile.revoke")}
                </Button>
              </div>
            ))
          ) : (
            <p className="py-2 text-xs text-content-muted">{frontendMessage("mobile.noDevices")}</p>
          )}
        </section>
      ) : null}
      {error ? (
        <div role="alert" className="flex items-start gap-3 text-brick-600">
          <p className="min-w-0 flex-1 break-words leading-6">{error}</p>
          <Button variant="ghost" disabled={busy} onClick={props.onRefresh}>
            {frontendMessage("mobile.retryConnection")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function formatExpiryTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
}
