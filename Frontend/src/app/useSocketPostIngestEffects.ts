import { useCallback, type MutableRefObject } from "react";
import {
  EventKinds,
  type EventEnvelope,
  type UserProfileData,
  type WsRequest,
} from "../api/eventTypes";
import type { StoreState } from "../store/sessionStore";

export type SocketPostIngestEffectPlan =
  | {
      kind: "config_reloaded";
      requests: Array<Extract<WsRequest, { type: "model.list" | "plugin.config.list" }>>;
    }
  | {
      kind: "profile_snapshot";
      profile: UserProfileData;
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
        { type: "model.list" },
        { type: "plugin.config.list" },
      ],
    };
  }

  if (env.kind === EventKinds.ProfileSnapshot) {
    return {
      kind: "profile_snapshot",
      profile: env.data as UserProfileData,
    };
  }

  return null;
}

export function useSocketPostIngestEffects({
  markUserProfileSynced,
  sendRef,
}: UseSocketPostIngestEffectsOptions): SocketPostIngestEffectsHandle {
  const runSocketPostIngestEffects = useCallback((env: EventEnvelope): boolean => {
    const plan = resolveSocketPostIngestEffect(env);
    if (!plan) return false;

    if (plan.kind === "config_reloaded") {
      for (const request of plan.requests) {
        sendRef.current?.(request);
      }
      return true;
    }

    markUserProfileSynced(plan.profile);
    return true;
  }, [markUserProfileSynced, sendRef]);

  return { runSocketPostIngestEffects };
}
