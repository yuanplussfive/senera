import type { ReactNode } from "react";
import type { MotionLevel } from "../../shared/motion";
import type { LayoutPreferenceId } from "../session/types";
import type { SettingsSystemConfigHandle } from "./SettingsContracts";
import type { SettingsSectionId } from "./types";

export interface SettingsEnvironment {
  appVersion: string;
  frontendVersion: string;
  mode: string;
  surface: "desktop" | "web";
}

export interface SettingsWorkbenchProps {
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  onPendingChangesChange?: (pending: boolean) => void;
  shellActions?: ReactNode;
  environment: SettingsEnvironment;
  values: Record<LayoutPreferenceId, boolean>;
  motionLevel: MotionLevel;
  onValueChange: (id: LayoutPreferenceId, value: boolean) => void;
  onMotionLevelChange: (level: MotionLevel) => void;
  systemConfig?: SettingsSystemConfigHandle;
}

export type SettingsContentProps = Omit<
  SettingsWorkbenchProps,
  "section" | "onSectionChange" | "onPendingChangesChange" | "shellActions"
>;
