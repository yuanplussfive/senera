import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { buildWorkspaceResourceUrl } from "../../api/workspaceResourceClient";
import { AppIcon } from "../ui";
import { OpenWithDefaultAppButton } from "../media/OpenWithDefaultAppButton";

/**
 * Files the editor cannot render — binaries, and text past the preview limit.
 * The desktop build hands them to the operating system; the browser keeps the
 * download as the only way out, so the button stays hidden there.
 */
export function WorkspaceUnpreviewableResource({
  httpBaseUrl,
  path,
  name,
  kind,
}: {
  readonly httpBaseUrl: string;
  readonly path: string;
  readonly name: string;
  readonly kind: "text" | "binary";
}): JSX.Element {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-md">
        <AppIcon icon="file-text" size={28} className="mx-auto text-content-muted" />
        <h3 className="mt-3 text-[14px] font-medium text-content-strong">
          {kind === "text" ? frontendMessage("resource.textTooLarge") : frontendMessage("resource.binaryTitle")}
        </h3>
        <p className="mt-1 text-[12px] leading-5 text-content-muted">
          {frontendMessage("resource.downloadDescription")}
        </p>
        <OpenWithDefaultAppButton
          name={name}
          source={buildWorkspaceResourceUrl(httpBaseUrl, path, true)}
          variant="labeled"
          className="mt-3"
        />
      </div>
    </div>
  );
}
