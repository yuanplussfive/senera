import { RotateCcw } from "lucide-react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import {
  AppearancePreferenceControl,
  defaultAppearancePreference,
  isDefaultAppearancePreference,
  useAppearance,
  useSetAppearancePreference,
} from "../../../shared/theme";
import { Button } from "../../../shared/ui";

export function AppearanceSettings(): JSX.Element {
  const { preference } = useAppearance();
  const setAppearancePreference = useSetAppearancePreference();
  const usesDefault = isDefaultAppearancePreference(preference);

  return (
    <div className="max-w-[760px]">
      <AppearancePreferenceControl />
      {!usesDefault ? (
        <div className="mt-4 flex justify-end border-t border-ink-200/60 pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAppearancePreference(defaultAppearancePreference)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {frontendMessage("settings.appearance.reset")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
