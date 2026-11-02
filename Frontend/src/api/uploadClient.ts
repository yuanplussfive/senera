import type { UploadAttachmentData } from "./uploadTypes";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { resolveBackendMessage, type BackendMessageData } from "../i18n/backendMessage";
import { uploadResource, ResourceUploadError } from "./resourceUpload";
import type { UploadFileOptions } from "./resourceUpload";
export { buildResourceContentUrl, buildResourceUploadUrl, DEFAULT_UPLOAD_TIMEOUT_MS } from "./resourceUpload";
export type { UploadProgress, UploadFileOptions, UploadResponse } from "./resourceUpload";

export interface UploadErrorResponse {
  ok: false;
  error?: BackendMessageData & {
    code?: string;
  };
}

export async function uploadFile(
  uploadUrl: string,
  file: File,
  options: UploadFileOptions = {},
): Promise<UploadAttachmentData> {
  try {
    return await uploadResource(uploadUrl, file, options);
  } catch (error) {
    if (!(error instanceof ResourceUploadError)) throw error;
    const message = error.code === "failed" ? resolveBackendMessage(error.backendError) : undefined;
    throw new Error(message ?? frontendMessage(`upload.${error.code}`, { fields: error.fields.join(", ") }), {
      cause: error,
    });
  }
}
