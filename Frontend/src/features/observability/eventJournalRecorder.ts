import { subscribeAgentTransportObservations } from "../../api/agentTransportObserver";

let installation: Promise<void> | undefined;

export function installEventJournalRecorder(): Promise<void> {
  if (installation) return installation;
  const nextInstallation = import("./eventJournalStore")
    .then(({ useEventJournalStore }) => {
      subscribeAgentTransportObservations((observations) => {
        useEventJournalStore.getState().append(observations);
      });
    })
    .catch((error: unknown) => {
      if (installation === nextInstallation) installation = undefined;
      throw error;
    });
  installation = nextInstallation;
  return nextInstallation;
}
