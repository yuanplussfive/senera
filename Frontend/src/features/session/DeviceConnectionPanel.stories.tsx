import { useState } from "react";
import { DeviceConnectionPanel, type DeviceConnectionPanelProps } from "./DeviceConnectionPanel";
import type { AgentDeviceConnectionSnapshot } from "../../api/deviceAuthenticationClient";

export default { title: "手机端/电脑配对" };

function PairingStory({
  snapshot,
  expired = false,
}: {
  snapshot: AgentDeviceConnectionSnapshot;
  expired?: boolean;
}): JSX.Element {
  const [connection, setConnection] = useState(snapshot);
  const [pending, setPending] = useState([
    { pairingId: "示例配对", deviceName: "我的 Android 手机", expiresAt: "2026-10-26T05:05:00Z" },
  ]);
  const [devices, setDevices] = useState([
    {
      id: "示例设备",
      name: "我的手机",
      lastSeenAt: "2026-10-26T05:00:00Z",
      expiresAt: "2026-10-29T05:00:00Z",
      current: false,
    },
  ]);
  const props: DeviceConnectionPanelProps = {
    snapshot: connection,
    busy: false,
    error: "",
    pending,
    devices,
    expired,
    onRefresh: () => {},
    onSelectMethod: (method) =>
      setConnection((value) => ({
        ...value,
        method,
        address: undefined,
        ...(method === "private-network" ? { privateNetwork: { state: "missing" } } : {}),
      })),
    onConfigureLan: (value) =>
      setConnection((connection) => ({
        ...connection,
        method: "lan",
        address: value ? { url: `http://${value.host}:${value.port}`, source: "lan" } : undefined,
        lan: {
          ...connection.lan!,
          state: value ? "listening" : "disabled",
          url: value ? `http://${value.host}:${value.port}` : undefined,
        },
      })),
    onSaveAddress: (url) =>
      setConnection({
        authorization: "authorized",
        csrfToken: "仅用于界面示例",
        ...(url ? { address: { url, source: "saved" } } : { privateNetwork: { state: "missing" } }),
      }),
    onEnablePrivateNetwork: () =>
      setConnection({
        authorization: "authorized",
        csrfToken: "仅用于界面示例",
        address: { url: "https://my-computer.example.ts.net", source: "private-network" },
      }),
    onReview: (request) => setPending((items) => items.filter((item) => item.pairingId !== request.pairingId)),
    onRevoke: (device) => setDevices((items) => items.filter((item) => item.id !== device.id)),
  };
  return (
    <div className="mx-auto w-full max-w-[480px] p-6">
      <DeviceConnectionPanel {...props} />
    </div>
  );
}

export const PersonalComputer = (): JSX.Element => (
  <PairingStory
    snapshot={{
      authorization: "authorized",
      csrfToken: "示例",
      method: "lan",
      recommended: "lan",
      canManageNetwork: true,
      lan: {
        state: "disabled",
        interfaces: [
          { name: "Wi-Fi", address: "192.168.1.20" },
          { name: "以太网", address: "10.0.0.20" },
        ],
        port: 5140,
      },
    }}
  />
);
export const EnablePrivateConnection = (): JSX.Element => (
  <PairingStory
    snapshot={{
      authorization: "authorized",
      csrfToken: "示例",
      method: "private-network",
      canManageNetwork: true,
      privateNetwork: { state: "available", url: "https://my-computer.example.ts.net" },
    }}
  />
);
export const PublicAddress = (): JSX.Element => (
  <PairingStory
    expired
    snapshot={{
      authorization: "authorized",
      csrfToken: "示例",
      address: { url: "https://senera.example.com", source: "current" },
    }}
  />
);
export const SignInAgain = (): JSX.Element => <PairingStory snapshot={{ authorization: "login" }} />;
export const ExistingService = (): JSX.Element => (
  <PairingStory
    snapshot={{
      authorization: "authorized",
      csrfToken: "示例",
      method: "private-network",
      canManageNetwork: true,
      privateNetwork: { state: "conflict" },
    }}
  />
);

export const LanFailure = (): JSX.Element => (
  <PairingStory
    snapshot={{
      authorization: "authorized",
      csrfToken: "示例",
      method: "lan",
      recommended: "lan",
      canManageNetwork: true,
      lan: {
        state: "failed",
        interfaces: [{ name: "Wi-Fi", address: "192.168.1.20" }],
        port: 5140,
        code: "EADDRINUSE",
        detail: "listen EADDRINUSE: address already in use 192.168.1.20:5140",
      },
    }}
  />
);
