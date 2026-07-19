import { verifyI18nRuntimeGovernance } from "./I18nRuntimeGovernance.js";
import { resolveWorkspaceRoot } from "./TestGovernance.js";

verifyI18nRuntimeGovernance({
  workspaceRoot: resolveWorkspaceRoot(),
  areas: [
    {
      root: "Frontend/src",
      include: ["."],
      exclude: ["dev", "design-system"],
      allowedFiles: ["Frontend/src/shared/ui/useClipboardCopy.ts", "Frontend/src/shared/ui/DropdownMenu.stories.tsx"],
    },
  ],
});

console.log("Frontend runtime i18n governance verified.");
