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

test("model service orchestrator owns one connection-actions instance and one global provider dialog pair", () => {
  expect(countMatches(modelServiceSectionSource, /\buseProviderConnectionActions\s*\(\s*\{/g)).toBe(1);
  expect(countMatches(modelServiceSectionSource, /<AddProviderDialog\b/g)).toBe(1);
  expect(countMatches(modelServiceSectionSource, /<RenameProviderDialog\b/g)).toBe(1);
});

test("model service tablet layout keeps a 280px provider column beside provider detail", () => {
  expect(modelServiceSectionSource).toContain('layout === "tablet" ? "grid-cols-[280px_minmax(0,1fr)]"');
  expect(modelServiceSectionSource).toContain("<ProviderModelManagementSurface");
});

test("model service keeps default assignment in the dedicated default-model section", () => {
  expect(modelServiceSectionSource).not.toMatch(/onSetDefaultProviderModel/);
  expect(modelServiceSectionSource).not.toMatch(/更改默认模型/);
  expect(providerConnectionEditorSource).toContain("获取模型列表");
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
