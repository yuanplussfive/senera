import type { AgentWorldPromptContext, AgentWorldPromptContextValue } from "../World/AgentWorldPromptContext.js";

export interface AgentSceneContext {
  readonly enabled: boolean;
  readonly attention: AgentSceneAttention | null;
  readonly moment: AgentSceneMoment | null;
  readonly current: {
    readonly location: string | null;
    readonly activity: string | null;
    readonly bodyState: string | null;
    readonly emotionState: string | null;
    readonly relationship: string | null;
    readonly interruptedBy: string | null;
    readonly nextPlan: AgentScenePlan | null;
  };
  readonly recentEvent: AgentSceneEvent | null;
}

export interface AgentSceneAttention {
  readonly source: "interruption" | "activity" | "recent_event" | "next_plan" | "moment";
  readonly text: string;
}

export interface AgentSceneMoment {
  readonly worldName: string;
  readonly timeZone: string;
  readonly instant: string;
  readonly localDate: string;
  readonly localTime: string;
  readonly weekdayLabel: string;
  readonly phaseLabel: string;
  readonly dayElapsed: string;
  readonly dayRemaining: string;
}

export interface AgentScenePlan {
  readonly label: string;
  readonly at: string;
  readonly kind: string;
}

export interface AgentSceneEvent {
  readonly type: string;
  readonly occurredAt: string;
  readonly summary: string;
}

export const EmptyAgentSceneContext: AgentSceneContext = {
  enabled: false,
  attention: null,
  moment: null,
  current: {
    location: null,
    activity: null,
    bodyState: null,
    emotionState: null,
    relationship: null,
    interruptedBy: null,
    nextPlan: null,
  },
  recentEvent: null,
};

/**
 * Projects the world snapshot into the small, present-tense context that a
 * resident needs when choosing the next line. Full world data stays available
 * in the runtime reference section; this projection only selects current focus.
 */
export function compileAgentSceneContext(input: { readonly world: AgentWorldPromptContextValue }): AgentSceneContext {
  const world = input.world;
  if (!world) return EmptyAgentSceneContext;

  const moment = {
    worldName: world.world.name,
    timeZone: world.time.timeZone,
    instant: world.time.instant,
    localDate: world.time.localDate,
    localTime: world.time.localTime,
    weekdayLabel: world.time.weekdayLabel,
    phaseLabel: world.time.phaseLabel,
    dayElapsed: world.time.dayElapsed,
    dayRemaining: world.time.dayRemaining,
  };
  const current = {
    location: world.resident.location,
    activity: world.resident.activity,
    bodyState: world.resident.bodyState,
    emotionState: world.resident.emotionState,
    relationship: world.resident.relationship,
    interruptedBy: world.resident.interruptedBy,
    nextPlan: world.resident.nextPlan ? projectPlan(world.resident.nextPlan) : null,
  };
  const recentEvent = projectRecentEvent(world);

  return {
    enabled: true,
    attention: projectAttention({ moment, current, recentEvent }),
    moment,
    current,
    recentEvent,
  };
}

function projectAttention(input: {
  readonly moment: AgentSceneMoment;
  readonly current: AgentSceneContext["current"];
  readonly recentEvent: AgentSceneEvent | null;
}): AgentSceneAttention {
  if (input.current.interruptedBy) {
    return { source: "interruption", text: input.current.interruptedBy };
  }
  if (input.current.activity) {
    return { source: "activity", text: input.current.activity };
  }
  if (input.recentEvent) {
    return { source: "recent_event", text: input.recentEvent.summary };
  }
  if (input.current.nextPlan) {
    return { source: "next_plan", text: input.current.nextPlan.label };
  }
  return {
    source: "moment",
    text: `${input.moment.localDate} ${input.moment.localTime} ${input.moment.phaseLabel}`,
  };
}

function projectPlan(plan: AgentWorldPromptContext["resident"]["nextPlan"]): AgentScenePlan | null {
  if (!plan) return null;
  return { label: plan.label, at: plan.at, kind: plan.kind };
}

function projectRecentEvent(world: AgentWorldPromptContext): AgentSceneEvent | null {
  const recent = world.timeline.reduce<AgentWorldPromptContext["timeline"][number] | null>((latest, candidate) => {
    if (!latest) return candidate;
    return compareSceneEvents(candidate, latest) > 0 ? candidate : latest;
  }, null);
  return recent ? { type: recent.type, occurredAt: recent.occurredAt, summary: recent.summary } : null;
}

function compareSceneEvents(
  left: AgentWorldPromptContext["timeline"][number],
  right: AgentWorldPromptContext["timeline"][number],
): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id);
}
