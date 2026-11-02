import type { FilePreviewRenderKind } from "../../lib/filePreview";

/** Preview data belongs to the workspace tab, independent of the originating message. */
export interface WorkspacePreviewResource {
  readonly name: string;
  readonly mime?: string;
  readonly size?: number;
  readonly source?: string;
  readonly file?: File;
  /** A producer such as a Markdown image already knows its content kind. */
  readonly previewKind?: FilePreviewRenderKind;
}
