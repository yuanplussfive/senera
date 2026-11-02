export interface DesktopHostIntegrationCapabilities {
  readonly revealWorkspace: boolean;
  readonly externalTerminal: boolean;
}

export const DesktopHostIntegrationFailureCodes = {
  Unavailable: "unavailable",
  NotFound: "not-found",
  Failed: "failed",
} as const;

export type DesktopHostIntegrationFailureCode =
  (typeof DesktopHostIntegrationFailureCodes)[keyof typeof DesktopHostIntegrationFailureCodes];

export type DesktopHostIntegrationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: DesktopHostIntegrationFailureCode;
      readonly message?: string;
    };

export function desktopHostIntegrationFailure(
  code: DesktopHostIntegrationFailureCode,
  message?: string,
): DesktopHostIntegrationResult {
  return message === undefined ? { ok: false, code } : { ok: false, code, message };
}
