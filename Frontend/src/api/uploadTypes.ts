/** Resource upload metadata shared by console and channel clients. */
export interface UploadAttachmentData {
  resourceUri: string;
  name: string;
  mime: string;
  size: number;
  sha256?: string;
  status: "uploaded";
}
