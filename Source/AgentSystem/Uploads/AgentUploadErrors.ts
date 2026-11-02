import type { AgentErrorMessageKey } from "../I18n/AgentMessageCatalog.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";

export const AgentUploadFailureKinds = {
  Aborted: "Aborted",
  ConcurrencyExceeded: "ConcurrencyExceeded",
  FileCountExceeded: "FileCountExceeded",
  FileMissing: "FileMissing",
  FileTooLarge: "FileTooLarge",
  RequestTooLarge: "RequestTooLarge",
  StorageQuotaExceeded: "StorageQuotaExceeded",
} as const;

export type AgentUploadFailureKind = (typeof AgentUploadFailureKinds)[keyof typeof AgentUploadFailureKinds];

interface AgentUploadFailureDefinition {
  code: string;
  messageKey: AgentErrorMessageKey;
  statusCode: number;
}

const AgentUploadFailureDefinitions = {
  [AgentUploadFailureKinds.Aborted]: {
    code: "upload_aborted",
    messageKey: "upload.aborted",
    statusCode: 499,
  },
  [AgentUploadFailureKinds.ConcurrencyExceeded]: {
    code: "upload_concurrency_exceeded",
    messageKey: "upload.concurrencyExceeded",
    statusCode: 429,
  },
  [AgentUploadFailureKinds.FileCountExceeded]: {
    code: "upload_file_count_exceeded",
    messageKey: "upload.fileCountExceeded",
    statusCode: 413,
  },
  [AgentUploadFailureKinds.FileMissing]: {
    code: "upload_file_missing",
    messageKey: "upload.fileMissing",
    statusCode: 400,
  },
  [AgentUploadFailureKinds.FileTooLarge]: {
    code: "upload_too_large",
    messageKey: "upload.fileTooLarge",
    statusCode: 413,
  },
  [AgentUploadFailureKinds.RequestTooLarge]: {
    code: "upload_request_too_large",
    messageKey: "upload.requestTooLarge",
    statusCode: 413,
  },
  [AgentUploadFailureKinds.StorageQuotaExceeded]: {
    code: "upload_storage_quota_exceeded",
    messageKey: "upload.storageQuotaExceeded",
    statusCode: 507,
  },
} as const satisfies Record<AgentUploadFailureKind, AgentUploadFailureDefinition>;

export class AgentUploadError extends AgentLocalizedError {
  constructor(
    messageKey: AgentUploadFailureDefinition["messageKey"],
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(messageKey);
  }

  static from(kind: AgentUploadFailureKind): AgentUploadError {
    const failure = AgentUploadFailureDefinitions[kind];
    return new AgentUploadError(failure.messageKey, failure.code, failure.statusCode);
  }
}

export class AgentUploadIntegrityError extends AgentBaseError {
  constructor(
    readonly resourceUri: string,
    readonly reason: "not_a_file" | "size_mismatch" | "sha256_mismatch",
  ) {
    super(`Resource integrity verification failed for ${resourceUri}: ${reason}.`);
  }
}
