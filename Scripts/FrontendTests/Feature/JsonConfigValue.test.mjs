import { expect, test } from "vitest";
import { sameJsonValue, sameJsonValueReconciled } from "../../../Frontend/src/shared/config/JsonConfigValue.ts";

const REDACTED = "__senera_redacted_secret__";

test("reconciled comparison treats a redacted placeholder as matching a non-empty draft", () => {
  expect(sameJsonValueReconciled("sk-real", REDACTED)).toBe(true);
  expect(sameJsonValueReconciled({ ApiKey: "sk-real" }, { ApiKey: REDACTED })).toBe(true);
  expect(
    sameJsonValueReconciled(
      { ModelProviderEndpoints: [{ Id: "p", ApiKey: "sk-real" }] },
      { ModelProviderEndpoints: [{ Id: "p", ApiKey: REDACTED }] },
    ),
  ).toBe(true);
});

test("reconciled comparison treats an empty draft as a real edit", () => {
  expect(sameJsonValueReconciled("", REDACTED)).toBe(false);
  expect(sameJsonValueReconciled({ ApiKey: "" }, { ApiKey: REDACTED })).toBe(false);
});

test("reconciled comparison still detects non-secret differences", () => {
  expect(sameJsonValueReconciled({ BaseUrl: "a" }, { BaseUrl: "b" })).toBe(false);
  expect(sameJsonValueReconciled({ ApiKey: "sk", BaseUrl: "a" }, { ApiKey: REDACTED, BaseUrl: "b" })).toBe(false);
  expect(sameJsonValueReconciled({ ApiKey: "sk" }, { ApiKey: REDACTED, Extra: "x" })).toBe(false);
});

test("strict comparison never treats a placeholder as matching a real value", () => {
  expect(sameJsonValue("sk-real", REDACTED)).toBe(false);
  expect(sameJsonValue({ ApiKey: "sk-real" }, { ApiKey: REDACTED })).toBe(false);
});
