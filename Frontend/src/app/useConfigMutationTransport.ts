import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { WsRequest } from "../api/eventTypes";
import type { ConfigMutationSendRequest, SocketTransportRefs } from "./configMutationContracts";

export interface ConfigMutationTransport {
  readOpenTransport: (offlineMessage: string) => ConfigMutationSendRequest | null;
  sendWhenOpen: (request: WsRequest) => boolean;
}

export function useConfigMutationTransport({ sendRef, statusRef }: SocketTransportRefs): ConfigMutationTransport {
  const readOpenTransport = useCallback(
    (offlineMessage: string): ConfigMutationSendRequest | null => {
      const send = sendRef.current;
      if (statusRef.current !== "open" || !send) {
        toast.error(offlineMessage);
        return null;
      }
      return send;
    },
    [sendRef, statusRef],
  );

  const sendWhenOpen = useCallback(
    (request: WsRequest): boolean => {
      const send = sendRef.current;
      return statusRef.current === "open" && Boolean(send?.(request));
    },
    [sendRef, statusRef],
  );

  return useMemo(
    () => ({
      readOpenTransport,
      sendWhenOpen,
    }),
    [readOpenTransport, sendWhenOpen],
  );
}
