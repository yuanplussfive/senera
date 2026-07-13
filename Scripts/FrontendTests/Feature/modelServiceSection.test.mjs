import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const modelServiceSectionSource = readSource(
  "../../../Frontend/src/features/settings/sections/ModelServiceSection.tsx",
);
const providerModelManagementSurfaceSource = readSource(
  "../../../Frontend/src/features/settings/sections/ProviderModelManagementSurface.tsx",
);
const providerConnectionEditorSource = readSource(
  "../../../Frontend/src/features/settings/sections/ProviderConnectionEditor.tsx",
);
const providerModelListSource = readSource(
  "../../../Frontend/src/features/chat/ModelProviderModelList.tsx",
);
const settingsWorkbenchSource = readSource(
  "../../../Frontend/src/features/settings/SettingsWorkbench.tsx",
);

test("model service orchestrator owns one connection-actions instance and one global provider dialog pair", () => {
  expect(countMatches(modelServiceSectionSource, /\buseProviderConnectionActions\s*\(\s*\{/g)).toBe(1);
  expect(countMatches(modelServiceSectionSource, /<AddProviderDialog\b/g)).toBe(1);
  expect(countMatches(modelServiceSectionSource, /<RenameProviderDialog\b/g)).toBe(1);
});

test("model service keeps the workbench shell fixed while provider panes own scrolling", () => {
  expect(settingsWorkbenchSource).toContain('activeSection.id === "model-service" ? (');
  expect(settingsWorkbenchSource).toContain('className="min-h-0 flex-1 overflow-hidden p-2 sm:p-4"');
  expect(settingsWorkbenchSource).toContain('<SettingsWorkspaceFrame className="h-full min-h-0">');
  expect(modelServiceSectionSource).toContain('className="flex min-h-0 flex-col overflow-hidden rounded-lg');
  expect(modelServiceSectionSource).toContain('className="min-h-[320px] flex-1 overflow-hidden"');
});

test("model service tablet layout keeps a 280px provider column beside provider detail", () => {
  expect(modelServiceSectionSource).toContain('layout === "tablet" ? "grid-cols-[280px_minmax(0,1fr)]"');
  expect(modelServiceSectionSource).toContain("<ProviderModelManagementSurface");
});

test("model service keeps default assignment dedicated while exposing Cherry-style quick actions", () => {
  expect(modelServiceSectionSource).toContain("onSetDefaultModel={systemConfig.setDefaultProviderModel}");
  expect(modelServiceSectionSource).toContain("<ProviderModelLifecycleDialogs");
  expect(providerModelManagementSurfaceSource).toContain("onRequestRemoveModel");
  expect(providerModelListSource).toContain("onSetDefaultModel");
  expect(providerModelListSource).toContain("chat.model.remove");
  expect(providerConnectionEditorSource).toContain("管理模型");
});

test("model service uses list-to-detail navigation on mobile", () => {
  expect(modelServiceSectionSource).toContain("mobileDetailOpen");
  expect(modelServiceSectionSource).toContain("返回供应商列表");
  expect(modelServiceSectionSource).not.toContain('role="tablist" aria-label="模型服务"');
});

test("model management defers search and keeps group editing out of the immediate-save model dialog", () => {
  expect(providerModelManagementSurfaceSource).toMatch(/\buseDeferredValue\b/);
  expect(providerModelManagementSurfaceSource).toMatch(
    /const deferredSearch = useDeferredValue\(search\)/,
  );
  expect(providerModelManagementSurfaceSource).toMatch(/deferredSearch\.trim\(\)\.toLowerCase\(\)/);
  expect(providerModelManagementSurfaceSource).toMatch(
    /onOpenModelGroups=\{\(\) => setGroupUnsupportedDialogOpen\(true\)\}/,
  );
  expect(providerModelManagementSurfaceSource).not.toMatch(/\bModelGroupsDialog\b/);
  expect(providerModelManagementSurfaceSource).not.toMatch(/\bgroupId=/);
  expect(providerModelManagementSurfaceSource).not.toMatch(/\bgroupOptions=/);
  expect(providerModelManagementSurfaceSource).not.toMatch(/\breadModelGroupId\b/);
});

test("embedded model management keeps manual add while provider editor owns catalog fetch", () => {
  expect(providerModelManagementSurfaceSource).toContain("showFetchAction");
  expect(providerModelManagementSurfaceSource).toContain("onAddManualModel={() => setManualOpen(true)}");
  expect(providerModelManagementSurfaceSource).toContain("fetchEndpoint");
  expect(providerModelManagementSurfaceSource).toContain("modelConfigId");
});

function countMatches(source, expression) {
  return source.match(expression)?.length ?? 0;
}

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
