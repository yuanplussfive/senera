import { verifyI18nRuntimeGovernance } from "./I18nRuntimeGovernance.js";
import { resolveWorkspaceRoot } from "./TestGovernance.js";

verifyI18nRuntimeGovernance({
  workspaceRoot: resolveWorkspaceRoot(),
  areas: [
    {
      root: "Source/AgentSystem",
      include: ["Auth", "Sandbox", "Session"],
    },
  ],
});

console.log("Agent runtime i18n governance verified.");
