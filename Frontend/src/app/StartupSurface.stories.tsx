import type { Story } from "@ladle/react";
import startupSurfaceHtml from "../../public/startup.html?raw";

/**
 * Preview of the desktop startup surface. The app loads `Frontend/public/startup.html`
 * (shipped as `Frontend/dist/startup.html`) before its server is ready, so this story
 * renders that exact file instead of a copy of its markup — editing the asset changes
 * both the preview and the real launch, and Ladle reloads it in place.
 */
type PreviewTheme = "light" | "dark";

function withTheme(theme?: PreviewTheme): string {
  // Without an override the document follows `prefers-color-scheme`, which is what a
  // real launch does.
  return theme
    ? startupSurfaceHtml.replace('<html lang="zh-CN">', `<html lang="zh-CN" data-theme="${theme}">`)
    : startupSurfaceHtml;
}

function StartupSurfaceFrame({ theme, label }: { theme?: PreviewTheme; label: string }): JSX.Element {
  return <iframe title={label} className="h-full w-full border-0" srcDoc={withTheme(theme)} />;
}

export const DesktopStartup: Story = () => (
  <div className="h-dvh w-full">
    <StartupSurfaceFrame label="启动画面（跟随系统外观）" />
  </div>
);

export const ThemeComparison: Story = () => (
  <div className="flex h-dvh w-full flex-col gap-4 p-4">
    <p className="text-[13px] leading-6 text-content-secondary">
      同一份 <code>Frontend/public/startup.html</code>
      ：左浅右深。真实启动跟随系统外观，窗口底色与这里的画布色一致，所以切到应用首帧不会换色。
    </p>
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
      <div className="min-h-0 overflow-hidden rounded-lg border border-line-subtle">
        <StartupSurfaceFrame theme="light" label="启动画面（浅色）" />
      </div>
      <div className="min-h-0 overflow-hidden rounded-lg border border-line-subtle">
        <StartupSurfaceFrame theme="dark" label="启动画面（深色）" />
      </div>
    </div>
  </div>
);
