import { subscribeAgentTransportObservations } from "../../api/agentTransportObserver";
import { useEventJournalStore } from "./eventJournalStore";

let installed = false;

export function installEventJournalRecorder(): void {
  if (installed) return;
  installed = true;
  subscribeAgentTransportObservations((observations) => {
    useEventJournalStore.getState().append(observations);
  });
}
