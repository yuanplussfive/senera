import * as AjvModule from "ajv";
import type { ValidateFunction } from "ajv";
import { formatAjvIssue } from "../Diagnostics/AgentValidationIssue.js";
import type { AgentPromptContractView } from "../Prompt/AgentPromptContractTypes.js";

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
  return validate(input.args)
    ? []
    : (validate.errors ?? []).map((error) =>
        formatAjvIssue(error, {
          rootPath: input.path,
          rootLabel: "arguments",
          numericPathStyle: "brackets",
        }),
      );
}

export function assertToolContractSchema(schema: Record<string, unknown>): void {
  validatorFor(schema);
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
