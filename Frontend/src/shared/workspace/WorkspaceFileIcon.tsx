import { createContext, useContext, useId, useMemo, type ReactNode } from "react";
import { getBuiltInSpriteSheet } from "@pierre/trees";
import { cn } from "../../lib/util";
import { resolveWorkspaceFileIcon, WorkspaceFileTreeIcons } from "./workspaceFileIcons";

const SpriteScope = createContext<string | undefined>(undefined);

/** One local dependency sprite per workbench, shared by every file tab and header. */
export function WorkspaceFileIconScope({ children }: { readonly children: ReactNode }): JSX.Element {
  const inherited = useContext(SpriteScope);
  const id = useId();
  const prefix = inherited ?? `workspace-files-${id}`;
  const sprite = useMemo(
    () =>
      inherited
        ? ""
        : getBuiltInSpriteSheet(WorkspaceFileTreeIcons.set)
            .replace(/\bid="([^"]+)"/gu, `id="${prefix}-$1"`)
            .replace(/url\(#([^)]+)\)/gu, `url(#${prefix}-$1)`),
    [inherited, prefix],
  );
  if (inherited) return <>{children}</>;
  return (
    <SpriteScope.Provider value={prefix}>
      {/* Only the installed dependency's static SVG reaches this adapter. */}
      <span hidden aria-hidden="true" dangerouslySetInnerHTML={{ __html: sprite }} />
      {children}
    </SpriteScope.Provider>
  );
}

export function WorkspaceFileIcon({
  path,
  size = 14,
  className,
}: {
  readonly path: string;
  readonly size?: number;
  readonly className?: string;
}): JSX.Element {
  const prefix = useContext(SpriteScope);
  if (!prefix) throw new Error("WorkspaceFileIcon requires a WorkspaceFileIconScope.");
  const icon = resolveWorkspaceFileIcon(path);
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox ?? "0 0 16 16"}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
      data-workspace-file-icon={icon.token}
    >
      <use href={`#${prefix}-${icon.name}`} />
    </svg>
  );
}
