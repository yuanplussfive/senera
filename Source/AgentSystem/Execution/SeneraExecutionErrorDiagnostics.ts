import { SeneraExecutionError, type SeneraExecutionErrorCode } from "./SeneraExecutionTypes.js";

export function attachSeneraExecutionDiagnostic(
  primary: SeneraExecutionError,
  key: string,
  diagnostic: SeneraExecutionError,
): SeneraExecutionError {
  const existingDiagnostics = isRecord(primary.details.diagnostics) ? primary.details.diagnostics : {};
  return new SeneraExecutionError(
    primary.code,
    primary.message,
    {
      ...primary.details,
      diagnostics: {
        ...existingDiagnostics,
        [key]: {
          code: diagnostic.code,
          message: diagnostic.message,
          details: diagnostic.details,
        },
      },
    },
    new AggregateError([primary, diagnostic], `Execution ${key} diagnostic.`),
  );
}

export function normalizeSeneraExecutionDiagnostic(
  error: unknown,
  code: SeneraExecutionErrorCode,
  details: Record<string, unknown>,
): SeneraExecutionError {
  if (error instanceof SeneraExecutionError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  return new SeneraExecutionError(code, cause.message, details, cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
