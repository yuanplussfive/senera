import type { UploadAttachmentData } from "./uploadTypes";
import { uploadFile, type UploadFileOptions } from "./uploadClient";

/** One selected file has one resource per workspace endpoint, including retries after message-send failure. */
export class AttachmentUploadTask {
  private resource?: UploadAttachmentData;
  private pending?: Promise<UploadAttachmentData>;
  private endpoint?: string;

  constructor(
    readonly file: File,
    resource?: UploadAttachmentData,
  ) {
    this.resource = resource;
  }

  get uploaded(): UploadAttachmentData | undefined {
    return this.resource;
  }

  upload(url: string, options: UploadFileOptions = {}): Promise<UploadAttachmentData> {
    options.signal?.throwIfAborted();
    if (this.endpoint && this.endpoint !== url)
      return Promise.reject(new Error("An attachment belongs to a different workspace endpoint."));
    this.endpoint = url;
    if (this.resource) return Promise.resolve(this.resource);
    return (this.pending ??= uploadFile(url, this.file, options)
      .then((resource) => (this.resource = resource))
      .finally(() => {
        this.pending = undefined;
      }));
  }
}
