import { EventKinds, type RunActivityChangedData } from "../../api/eventTypes";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { touchRun } from "./sessionRunProjection";

const ActivityStatusByState = {
  started: "running",
  completed: "done",
  failed: "failed",
} as const;

export const runActivityEventHandlers = {
  [EventKinds.RunActivityChanged]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as RunActivityChangedData;
    const activities = (run.activities ??= []);
    const status = ActivityStatusByState[data.state];
    const existing = activities.find((activity) => activity.id === data.activityId);
    if (existing) {
      existing.status = status;
      existing.endedAt = data.state === "started" ? undefined : env.timestamp;
    } else {
      activities.push({
        id: data.activityId,
        activity: data.activity,
        status,
        step: env.step,
        startedAt: env.timestamp,
        endedAt: data.state === "started" ? undefined : env.timestamp,
      });
    }
    run.liveActivity =
      data.state === "started"
        ? data.activity
        : [...activities].reverse().find((activity) => activity.status === "running")?.activity;
    touchRun(run);
  },
} satisfies RunEventHandlerMap;
