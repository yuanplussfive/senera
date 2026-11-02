import { ServerAuthenticationController } from "../src/api/serverAuthentication";
import { ClientConnectionLifecycle } from "../src/api/connectionLifecycle";

/** Cookies authorize both documents; protocol identity never acts as a server credential. */
export const qqAuthentication = new ServerAuthenticationController(window.location.origin);
const lifecycle = new ClientConnectionLifecycle({
  suspend: () => undefined,
  resume: () => {
    void qqAuthentication.revalidate();
  },
});
export function startQqAuthentication(): void {
  qqAuthentication.start();
  lifecycle.start();
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    lifecycle.stop();
    qqAuthentication.stop();
  });
