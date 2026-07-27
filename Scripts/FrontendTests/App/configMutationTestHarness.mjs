import { useEffect, useRef } from "react";
import { useConfigMutationController } from "../../../Frontend/src/app/useConfigMutationController.ts";

export function ConfigMutationHarness({ configSnapshot = null, send, status, handleRef }) {
  const sendRef = useRef(send);
  const statusRef = useRef(status);
  sendRef.current = send;
  statusRef.current = status;
  const handle = useConfigMutationController({
    configSnapshot,
    sendRef,
    statusRef,
  });
  useEffect(() => {
    handleRef.current = handle;
  });
  return null;
}

export function createConfigSnapshot(overrides = {}) {
  return {
    path: "Config.toml",
    version: 1,
    revision: 4,
    value: {},
    source: "sqlite",
    diagnostics: [],
    form: { version: 1, sections: [] },
    ...overrides,
  };
}

export function configMutationEvent(kind, phase, data, overrides = {}) {
  return {
    channel: "agent.event",
    kind,
    layer: phase === "session" || phase === "config" || phase === "sandbox" ? "snapshot" : "progress",
    phase,
    sequence: 1,
    timestamp: "2026-07-09T00:00:00.000Z",
    data,
    ...overrides,
  };
}
