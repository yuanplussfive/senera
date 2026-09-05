import { useCallback, type MutableRefObject } from "react";
import { toast } from "sonner";
import {
  EventKinds,
  type EventEnvelope,
  type SessionCompactedData,
  type SessionExportedData,
  type UserProfileData,
  type WsRequest,
} from "../api/eventTypes";
import type { StoreState } from "../store/sessionStore";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export type SocketPostIngestEffectPlan =
  | {
      kind: "config_reloaded";
      requests: Array<
        Extract<
          WsRequest,
          {
            type: "config.get" | "model.list" | "preset.list" | "sandbox.status" | "systemTool.list";
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
        { type: "model.list" },
        { type: "preset.list" },
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
    return { kind: "runtime_status_observed" };
  }

  if (
    env.sessionId &&
    (env.kind === EventKinds.RunStarted ||
      env.kind === EventKinds.ModelStarted ||
      env.kind === EventKinds.ToolCallCompleted ||
      env.kind === EventKinds.ToolCallFailed ||
      env.kind === EventKinds.RunCompleted ||
      env.kind === EventKinds.RunFailed ||
      env.kind === EventKinds.RunCancelled ||
      env.kind === EventKinds.ModelCompleted)
  ) {
    return { kind: "runtime_status_refresh", sessionId: env.sessionId };
  }

  return null;
}

export function useSocketPostIngestEffects({
  markUserProfileSynced,
  sendRef,
}: UseSocketPostIngestEffectsOptions): SocketPostIngestEffectsHandle {
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
        sendRef.current?.({ type: "session.runtime_status", sessionId: plan.sessionId });
        return true;
      }

      if (plan.kind === "runtime_status_observed") return true;

      if (plan.kind === "session_notice") {
        const notify = plan.variant === "success" ? toast.success : toast.message;
        notify(plan.title, { description: plan.description });
        if (plan.refreshSessionId) {
          sendRef.current?.({ type: "session.runtime_status", sessionId: plan.refreshSessionId });
        }
        return true;
      }

      markUserProfileSynced(plan.profile);
      return true;
    },
    [markUserProfileSynced, sendRef],
  );

  return { runSocketPostIngestEffects };
}
