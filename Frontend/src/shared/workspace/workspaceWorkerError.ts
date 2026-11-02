import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export function workspaceWorkerError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error instanceof ErrorEvent) {
    return (
      error.message || frontendMessage("resource.workerFailed", { source: error.filename || window.location.origin })
    );
  }
  return frontendMessage("resource.workerFailed", { source: window.location.origin });
}
