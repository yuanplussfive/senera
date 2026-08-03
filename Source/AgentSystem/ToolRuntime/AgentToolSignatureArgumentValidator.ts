import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";
import { formatAjvIssue } from "../Diagnostics/AgentValidationIssue.js";
import type { AgentPromptContractView } from "../Prompt/AgentPromptContractTypes.js";

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
  return validateToolContractValue({
    schema: input.contract.jsonSchema,
    value: input.args,
    path: input.path,
    label: "arguments",
  });
}

export function validateToolContractValue(input: {
  schema: Readonly<Record<string, unknown>>;
  value: unknown;
  path: Array<string | number>;
  label: string;
}): string[] {
  const validate = validatorFor(input.schema);
  return validate(input.value)
    ? []
    : (validate.errors ?? []).map((error) =>
        formatAjvIssue(error, {
          rootPath: input.path,
          rootLabel: input.label,
          numericPathStyle: "brackets",
        }),
      );
}

export function assertToolContractSchema(schema: Record<string, unknown>): void {
  validatorFor(schema);
}

function validatorFor(schema: Readonly<Record<string, unknown>>): ValidateFunction {
  const cached = validators.get(schema);
  if (cached) {
    return cached;
  }

  const validate = ajv.compile(schema);
  validators.set(schema, validate);
  return validate;
}
