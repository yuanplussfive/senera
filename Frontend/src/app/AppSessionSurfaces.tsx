import type { SocketStatus } from "../api/useAgentSocket";
import { SessionList } from "../features/session";
import type { UserProfile } from "../store/sessionStore";

export interface AppSessionActions {
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  onCloseSessions: (ids: string[]) => void;
  onRefreshSessions: () => void;
  onRenameSession: (id: string, title: string) => void;
  onUpdateUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
}

export interface AppSessionSurfaceProps {
  actions: AppSessionActions;
  onClosePanel?: () => void;
  onOpenSessionPanel?: () => void;
  onSessionSelected?: () => void;
  presentation: "auto" | "panel" | "rail";
  socketStatus: SocketStatus;
  userProfile: UserProfile;
}

export function AppSessionSurface({
  actions,
  onClosePanel,
  onOpenSessionPanel,
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
      socketStatus={socketStatus}
      onOpenSessionPanel={onOpenSessionPanel}
      onClosePanel={onClosePanel}
      onSessionSelected={onSessionSelected}
    />
  );
}
