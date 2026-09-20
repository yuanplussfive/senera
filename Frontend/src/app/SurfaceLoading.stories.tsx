import type { Story } from "@ladle/react";
import { ApplicationSurfaceLoading, SettingsSurfaceLoading } from "./SurfaceLoading";

export const Application: Story = () => <ApplicationSurfaceLoading />;

export const SettingsDesktop: Story = () => <SettingsSurfaceLoading presentation="desktop" />;

export const SettingsOverlay: Story = () => (
  <div className="min-h-dvh bg-surface-canvas p-8 text-content-primary">
    <h2 className="text-[15px] font-semibold">设置加载覆盖层</h2>
    <p className="mt-2 text-[12px] leading-5 text-content-secondary">真实设置面板载入前保留窗口与内容区域的几何。</p>
    <SettingsSurfaceLoading presentation="overlay" />
  </div>
);
