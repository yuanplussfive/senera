# Frontend Kill-Slop Audit

Audit date: 2026-07-14

Workspace chrome constraints updated: 2026-07-16

Scope: `Frontend/src`, `Frontend/README.md`, and frontend Storybook/Ladle stories. Generated output and dependencies are excluded.

## Result

| Stage                  | Groups | Hits |
| ---------------------- | -----: | ---: |
| Before the first pass  |     19 |  352 |
| Before this audit pass |     12 |  228 |
| After confirmed fixes  |     12 |  177 |

The remaining group count is not a quality score. Each remaining hit below has a code-level reason to stay or is outside the shipped product surface.

## Confirmed Fixes

| Files                                                                                | Finding                                                    | Resolution                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ModelProviderModelList.tsx`, `RemoteModelPickerDialog.tsx`                          | Nested group/count pills and colored model-state pills     | Small-radius group controls, inline counts, neutral state surfaces         |
| `ModelCapabilityControls.tsx`                                                        | Capability icons wrapped in repeated circular tiles        | Bare semantic icons; state remains in the switch and text                  |
| `ModelProviderPanels.tsx`, `ProviderConnectionList.tsx`, `VectorModelConfigView.tsx` | Stock green status pills                                   | Neutral surfaces with the project moss color used only for state text      |
| `PresetOverlays.tsx`                                                                 | Blur overlays and large-radius floating panels             | Opaque surfaces, 8px radius, no backdrop blur                              |
| `ScrollToBottomButton.tsx`                                                           | Floating pill with blur, ring, and wide shadow             | 8px radius and one compact, colorless shadow                               |
| `PluginConfigViews.tsx`, model dialogs, provider lifecycle dialogs                   | Product surfaces still using `rounded-xl`                  | Unified to `rounded-lg`                                                    |
| `ChatComposer.tsx`                                                                   | Regular UI guidance inherited monospace                    | UI sans for guidance; monospace retained on keyboard keys and file metrics |
| `ProfileFooter.tsx`, `SessionRows.tsx`                                               | Connection and session summaries rendered as terminal text | UI sans with tabular numerals where needed                                 |
| `ThinkingSummaryBar.tsx`, `WorkflowRunControls.tsx`, `StepNode.tsx`                  | Summary labels and status copy rendered as terminal text   | UI sans; durations and counts use tabular numerals                         |
| `PresetWorkspace.tsx`, `PresetSidebar.tsx`                                           | Format controls and ordinary metadata overused monospace   | UI sans for labels; tabular numerals for measured values                   |
| `JsonConfigArrayFieldControl.tsx`                                                    | Hard-coded warm surface `#f6f0e7`                          | Existing configuration surface token                                       |

## Retained Findings

### 06: Gradient

- `shared/code/CollapsibleCodeBlock.tsx`: the bottom fade indicates clipped code and points to hidden content. It is local and functional, not atmospheric decoration.

### 07 and 24: Brand Mark

- `shared/ui/Logo.tsx`: the serif wordmark and primitive SVG paths are the existing Senera brand asset. They are not reused as generic UI decoration.

### 09: Underline

- `styles/markdown.css`: underline is applied to actual Markdown links.

### 12 and 15: Non-Product Sources

- `design-system/tokens/*.stories.tsx`: typography specimens intentionally demonstrate type tokens.
- `shared/ui/Button.stories.tsx`: stars are placeholder icon content in component stories.
- `Frontend/README.md`: the arrow documents an event relationship.

### 16: Pulse

- `features/chat/ChatComposer.tsx`: pulse appears only when upload progress is indeterminate. It communicates an active transfer and is removed once a ratio exists.

### 19: Circular Geometry

Retained circles are constrained to shapes that are conventionally circular:

- Avatars and avatar crop masks: `MessageChrome.tsx`, `ProfileFooter.tsx`.
- Toggle tracks and knobs: model, plugin, provider, appearance, and JSON configuration controls.
- Progress bars and loading dots: `ChatComposer.tsx`, `HistoryRecoveryState.tsx`, `AgentExecutionFeed.tsx`.
- Status dots: session, workflow, plugin, and connection status.
- Scrollbar thumbs and color swatches: `ScrollArea.tsx`, `useAppearance.tsx`.
- Data-type tokens: `DataView.tsx`; these describe typed runtime values rather than marketing badges.

### 21: Large Radius

- `HistoryRecoveryState.tsx`: skeleton geometry mirrors the real chat bubbles.
- `UserMessageRow.tsx`: the message bubble uses one large outer radius and a smaller speaker corner; it is not nested inside another rounded surface.
- `SessionList.tsx`: `rounded-xl` is reserved for the single Desktop/Wide persistent workspace sidebar shell. It separates navigation chrome from the continuous chat canvas and is not repeated on session rows or nested cards.
- Remaining hits are design-system stories.

### 22: Clipped Borders

The product hits put `overflow-hidden`, `border`, and `rounded-lg` on the same element. The border owns the arc, so clipping does not erase its corners. This applies to:

- Message editing and model list groups.
- Plugin configuration lists.
- Profile and settings surfaces.
- JSON array/table controls.
- Context and dropdown menus.

Story-only hits are excluded from product QA.

### 27: Three-Column Layouts

- `PresetWorkspace.tsx`: three mutually exclusive format options form a segmented control.
- `SettingsWorkbench.tsx`: three mutually exclusive motion levels are a settings option set with descriptions.
- `JsonConfigArrayFieldControl.tsx`, `JsonConfigForm.tsx`: responsive form fields, not statistic or feature cards.
- Remaining hits are component stories.

### 33: Monospace

Retained monospace text is limited to technical values:

- Source code, raw JSON/TOML, shell commands, paths, URIs, IDs, and rule names.
- Timestamps, duration readouts, byte counts, line counts, and token counts.
- Keyboard shortcuts.
- Design-token specimens in stories.

Ordinary navigation, status copy, summaries, and descriptive text use the UI font.

## Visual QA

- Desktop: 1440 x 960, long assistant response with persistent workflow panel.
- Mobile: 390 x 844, long response and composer.
- Checked: no horizontal overflow, no clipped composer controls, no overlapping headers, and stable panel boundaries.

## Regression Checklist

- Run the scanner and review new hits; do not treat the hit count as a pass/fail score.
- Reject new page-level radial gradients, backdrop-blur surfaces, and `transition-all`.
- Keep ordinary product surfaces at 6-10px radius. The Desktop/Wide persistent workspace sidebar may use 12px as the single shell-level exception; avatars, toggles, progress tracks, and chat bubbles continue to follow their geometry.
- Do not separate persistent chat workspace regions primarily with full-height `border-r` or full-width high-contrast top-bar `border-b`; use shell spacing, neutral surface contrast, and the existing semantic surface shadow. Low-contrast `border-r`/`border-b` boundaries remain valid inside the settings workbench, forms, tables, and other functional editing shells when they clarify navigation or field grouping.
- Keep the central conversation workspace as one continuous canvas; do not wrap it in another rounded, bordered card.
- Preserve Electron drag regions and the window-controls inset when changing workspace chrome.
- Use monospace only when character alignment or literal technical identity matters.
- Prefer neutral state surfaces; reserve terra, moss, umber, and brick for state signals.
- Verify changed surfaces at 390px and 1440px before merging.
