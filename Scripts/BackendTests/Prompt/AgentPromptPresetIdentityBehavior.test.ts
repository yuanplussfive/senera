import { describe, expect, test } from "vitest";
import { renderAgentPromptPresetIdentity } from "../../../Source/AgentSystem/Prompt/AgentPromptPresetIdentity.js";

describe("prompt preset identity references", () => {
  test("projects only the declared host identity variables without recursive template evaluation", () => {
    const rendered = renderAgentPromptPresetIdentity(
      "{{ user }} / {{ASSISTANT}} / {{UsEr}} / {{assistant}} / {{resident}} / {{char}} / {{unknown}}",
      { user: "Ada {{assistant}}", assistant: "Nova <profile>" },
    );

    expect(rendered).toBe(
      "Ada {{assistant}} / Nova <profile> / Ada {{assistant}} / Nova <profile> / {{resident}} / {{char}} / {{unknown}}",
    );
  });
});
