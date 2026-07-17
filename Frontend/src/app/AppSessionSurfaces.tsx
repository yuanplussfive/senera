import type { SocketStatus } from "../api/useAgentSocket";
import { SessionList } from "../features/session";
import type { UserProfile } from "../store/sessionStore";
import type { SettingsSectionId } from "../features/settings/types";

export interface AppSessionActions {
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  onCloseSessions: (ids: string[]) => void;
  onRefreshSessions: () => void;
  onRenameSession: (id: string, title: string) => boolean;
  onUpdateUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  onLogout?: () => Promise<void>;
  onOpenSettings: (section?: SettingsSectionId, returnFocus?: HTMLElement | null) => void;
}

export interface AppSessionSurfaceProps {
  actions: AppSessionActions;
  onClosePanel?: () => void;
  onSessionSelected?: () => void;
  presentation: "auto" | "panel";
  socketStatus: SocketStatus;
  userProfile: UserProfile;
}

export function AppSessionSurface({
  actions,
  onClosePanel,
  onSessionSelected,
  presentation,
  socketStatus,
  userProfile,
}: AppSessionSurfaceProps): JSX.Element {
  return (
    <SessionList
      presentation={presentation}
      onNewSession={actions.onNewSession}
      onCloseSession={actions.onCloseSession}
      onCloseSessions={actions.onCloseSessions}
      onRefreshSessions={actions.onRefreshSessions}
      onRenameSession={actions.onRenameSession}
      userProfile={userProfile}
      onUpdateUserProfile={actions.onUpdateUserProfile}
      onLogout={actions.onLogout}
      socketStatus={socketStatus}
      onOpenSettings={actions.onOpenSettings}
      onClosePanel={onClosePanel}
      onSessionSelected={onSessionSelected}
    />
  );
}
