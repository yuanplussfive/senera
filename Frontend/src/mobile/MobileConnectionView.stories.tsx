import { useState } from "react";
import { MobileConnectionView, type MobileConnectionViewProps } from "./MobileConnectionView";
import "./mobile.css";

export default { title: "手机端/连接电脑" };

function ConnectionStory({
  waiting = false,
  restoring = false,
  error = "",
}: {
  waiting?: boolean;
  restoring?: boolean;
  error?: string;
}): JSX.Element {
  const [fields, setFields] = useState({
    serverUrl: "https://computer.example.com",
    deviceName: "我的手机",
    loginName: "",
    password: "",
  });
  const [connections, setConnections] = useState([
    { serverUrl: "https://computer.example.com", name: "我的电脑", deviceName: "我的手机" },
  ]);
  const props: MobileConnectionViewProps = {
    ...fields,
    connections,
    waiting,
    restoring,
    busy: waiting || restoring,
    error,
    onField: (field, value) => setFields((previous) => ({ ...previous, [field]: value })),
    onLogin: () => {},
    onScan: () => {},
    onCancel: () => {},
    onBackgroundSettings: () => {},
    onConnect: (connection) => setFields((previous) => ({ ...previous, serverUrl: connection.serverUrl })),
    onForget: (connection) =>
      setConnections((previous) => previous.filter((item) => item.serverUrl !== connection.serverUrl)),
  };
  return <MobileConnectionView {...props} />;
}

export const AccountLogin = (): JSX.Element => <ConnectionStory />;
export const RestoringConnection = (): JSX.Element => <ConnectionStory restoring />;
export const WaitingForComputer = (): JSX.Element => <ConnectionStory waiting />;
export const ConnectionError = (): JSX.Element => <ConnectionStory error="连接请求失败，请检查网络和电脑上的服务。" />;
