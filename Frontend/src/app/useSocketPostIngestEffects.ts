import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { toast } from "sonner";
import {
  EventKinds,
  type EventEnvelope,
  type SessionCompactedData,
  type SessionExportedData,
  type SessionRuntimeStatusData,
  type UserProfileData,
  type WsRequest,
} from "../api/eventTypes";
import { readEventSessionId } from "../api/eventCorrelation";
import type { StoreState } from "../store/sessionStore";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export type SocketPostIngestEffectPlan =
  | {
      kind: "config_reloaded";
      requests: Array<
        Extract<
          WsRequest,
          {
            type: "config.get" | "model.list" | "sandbox.status" | "systemTool.list" | "workspace.get";
          }
        >
      >;
    }
  | {
      kind: "profile_snapshot";
      profile: UserProfileData;
    }
  | {
      kind: "runtime_status_refresh";
      sessionId: string;
    }
  | {
      kind: "runtime_status_observed";
      sessionId?: string;
    }
  | {
      kind: "session_notice";
      variant: "message" | "success";
      title: string;
      description?: string;
      refreshSessionId?: string;
    };

export interface UseSocketPostIngestEffectsOptions {
  markUserProfileSynced: StoreState["markUserProfileSynced"];
  sendRef: MutableRefObject<((request: WsRequest) => boolean) | null>;
}

export interface SocketPostIngestEffectsHandle {
  runSocketPostIngestEffects: (env: EventEnvelope) => boolean;
}

export function resolveSocketPostIngestEffect(env: EventEnvelope): SocketPostIngestEffectPlan | null {
  if (env.kind === EventKinds.ConfigReloaded) {
    return {
      kind: "config_reloaded",
      requests: [
        { type: "config.get" },
        { type: "workspace.get" },
        { type: "model.list" },
        { type: "sandbox.status" },
        { type: "systemTool.list" },
      ],
    };
  }

  if (env.kind === EventKinds.ProfileSnapshot) {
    return {
      kind: "profile_snapshot",
      profile: env.data as UserProfileData,
    };
  }

  if (env.kind === EventKinds.SessionCompacted) {
    const data = env.data as SessionCompactedData;
    return {
      kind: "session_notice",
      variant: "success",
      title: frontendMessage("session.piCompactCompleted"),
      description: frontendMessage("session.piCompactSummary", {
        before: data.tokensBefore,
        after: data.estimatedTokensAfter ?? frontendMessage("session.piTokenEstimatePending"),
      }),
      refreshSessionId: data.sessionId,
    };
  }

  if (env.kind === EventKinds.SessionExported) {
    const data = env.data as SessionExportedData;
    return {
      kind: "session_notice",
      variant: "success",
      title: frontendMessage("session.piExportCompleted", { format: data.format.toUpperCase() }),
      description: data.path,
    };
  }

  if (env.kind === EventKinds.SessionRuntimeStatus) {
    const data = env.data as SessionRuntimeStatusData;
    return { kind: "runtime_status_observed", sessionId: readEventSessionId({ sessionId: env.sessionId, data }) };
  }

  const sessionId = readEventSessionId(env);
  if (
    sessionId &&
    (env.kind === EventKinds.RunStarted ||
      env.kind === EventKinds.RunActivityChanged ||
      env.kind === EventKinds.ModelStarted ||
      env.kind === EventKinds.ToolCallStarted ||
      env.kind === EventKinds.ToolCallCompleted ||
      env.kind === EventKinds.ToolCallFailed ||
      env.kind === EventKinds.RunCompleted ||
      env.kind === EventKinds.RunFailed ||
      env.kind === EventKinds.RunCancelled ||
      env.kind === EventKinds.ModelCompleted)
  ) {
    return { kind: "runtime_status_refresh", sessionId };
  }

  return null;
}

export function useSocketPostIngestEffects({
  markUserProfileSynced,
  sendRef,
}: UseSocketPostIngestEffectsOptions): SocketPostIngestEffectsHandle {
  const runtimeRefreshStatesRef = useRef(
    new Map<
      string,
      {
        timer?: ReturnType<typeof setTimeout>;
        inFlight: boolean;
        dirty: boolean;
      }
    >(),
  );

  const scheduleRuntimeStatusRefresh = useCallback(
    (sessionId: string, delayMs = 0): void => {
      const states = runtimeRefreshStatesRef.current;
      const state = states.get(sessionId) ?? { inFlight: false, dirty: false };
      states.set(sessionId, state);
      state.dirty = true;
      if (state.inFlight || state.timer !== undefined) return;
      const dispatch = (): void => {
        state.timer = undefined;
        if (state.inFlight || !state.dirty) return;
        const sent = sendRef.current?.({ type: "session.runtime_status", sessionId }) === true;
        if (!sent) {
          state.dirty = true;
          return;
        }
        state.dirty = false;
        state.inFlight = true;
      };
      if (delayMs <= 0) {
        dispatch();
      } else {
        state.timer = setTimeout(dispatch, delayMs);
      }
    },
    [sendRef],
  );

  const observeRuntimeStatus = useCallback(
    (sessionId: string | undefined): void => {
      if (!sessionId) return;
      const state = runtimeRefreshStatesRef.current.get(sessionId);
      if (!state) return;
      state.inFlight = false;
      if (state.dirty) scheduleRuntimeStatusRefresh(sessionId);
    },
    [scheduleRuntimeStatusRefresh],
  );

  useEffect(
    () => () => {
      for (const state of runtimeRefreshStatesRef.current.values()) {
        if (state.timer !== undefined) clearTimeout(state.timer);
      }
      runtimeRefreshStatesRef.current.clear();
    },
    [],
  );

  const runSocketPostIngestEffects = useCallback(
    (env: EventEnvelope): boolean => {
      const plan = resolveSocketPostIngestEffect(env);
      if (!plan) return false;

      if (plan.kind === "config_reloaded") {
        for (const request of plan.requests) {
          sendRef.current?.(request);
        }
        return true;
      }

      if (plan.kind === "runtime_status_refresh") {
        scheduleRuntimeStatusRefresh(plan.sessionId);
        return true;
      }

      if (plan.kind === "runtime_status_observed") {
        observeRuntimeStatus(plan.sessionId);
        return true;
      }

      if (plan.kind === "session_notice") {
        const notify = plan.variant === "success" ? toast.success : toast.message;
        notify(plan.title, { description: plan.description });
        if (plan.refreshSessionId) {
          scheduleRuntimeStatusRefresh(plan.refreshSessionId, 0);
        }
        return true;
      }

      markUserProfileSynced(plan.profile);
      return true;
    },
    [markUserProfileSynced, observeRuntimeStatus, scheduleRuntimeStatusRefresh, sendRef],
  );

  return { runSocketPostIngestEffects };
}
