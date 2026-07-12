import * as AjvModule from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { AgentPromptContractView } from "../Prompt/AgentPromptContractProjector.js";

const Ajv = (AjvModule.default ?? AjvModule) as unknown as typeof import("ajv").default;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});

const validators = new WeakMap<Record<string, unknown>, ValidateFunction>();

export function validateToolSignatureArguments(input: {
  contract: AgentPromptContractView;
  args: Record<string, unknown>;
  path: Array<string | number>;
}): string[] {
  const validate = validatorFor(input.contract.jsonSchema);
  return validate(input.args) ? [] : (validate.errors ?? []).map((error) => formatAjvIssue(error, input.path));
}

function validatorFor(schema: Record<string, unknown>): ValidateFunction {
  const cached = validators.get(schema);
  if (cached) {
    return cached;
  }

  const validate = ajv.compile(schema);
  validators.set(schema, validate);
  return validate;
}

function formatAjvIssue(error: ErrorObject, rootPath: readonly (string | number)[]): string {
  const path = formatIssuePath([...rootPath, ...jsonPointerPath(error.instancePath), ...ajvParamPath(error)]);
  return `${path}: ${error.message ?? "JSON Schema validation failed"}`;
}

function ajvParamPath(error: ErrorObject): Array<string | number> {
  const params = error.params as Record<string, unknown>;
  const property = params.additionalProperty ?? params.missingProperty;
  return typeof property === "string" && property.length > 0 ? [property] : [];
}

function jsonPointerPath(pointer: string): Array<string | number> {
  return pointer
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((segment) => {
      const index = Number(segment);
      return Number.isInteger(index) && String(index) === segment ? index : segment;
    });
}

function formatIssuePath(path: readonly (string | number)[]): string {
  return path.map((part) => (typeof part === "number" ? `[${part}]` : part)).join(".");
}
