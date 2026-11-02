import { ServerAuthenticationError, type ServerAuthorizedAuthentication } from "./authClient";
import type { ServerAuthenticationController } from "./serverAuthentication";

/** Document bootstraps can wait; reactive surfaces subscribe without this extra lifecycle. */
export function waitForServerAuthorization(
  controller: ServerAuthenticationController,
): Promise<ServerAuthorizedAuthentication> {
  return new Promise((resolve, reject) => {
    const signal = controller.signal;
    const cleanup = () => {
      unsubscribe();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const inspect = () => {
      const state = controller.store.getState();
      if (state.status === "loading" || state.status === "revalidating") return;
      cleanup();
      if (state.status === "authenticated") resolve(state.authentication);
      else
        reject(
          state.status === "failed"
            ? state.error
            : new ServerAuthenticationError(401, "Senera authentication is required."),
        );
    };
    const unsubscribe = controller.store.subscribe(inspect);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    inspect();
  });
}
