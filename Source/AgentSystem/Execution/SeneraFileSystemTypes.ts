import { AgentBaseError } from "../Core/AgentBaseError.js";

export type SeneraOperationResult<TValue, TError> =
  { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: TError };

export interface SeneraOperationContext {
  readonly abortSignal?: AbortSignal;
}

export type SeneraFileErrorCode =
  | "aborted"
  | "not_found"
  | "permission_denied"
  | "not_directory"
  | "is_directory"
  | "invalid"
  | "not_supported"
  | "unknown";

export class SeneraFileError extends AgentBaseError {
  constructor(
    readonly code: SeneraFileErrorCode,
    message: string,
    readonly path?: string,
    cause?: Error,
  ) {
    super(message, cause ? { cause } : undefined);
  }
}

export interface SeneraFileInfo {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink";
  readonly size: number;
  readonly mtimeMs: number;
}
