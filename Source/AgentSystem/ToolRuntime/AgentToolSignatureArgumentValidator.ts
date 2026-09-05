import { Ajv } from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import { agentStructuredIssuePathToPointer } from "../Diagnostics/AgentStructuredIssue.js";
import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import type { AgentPromptContractProperty, AgentPromptContractView } from "../Prompt/AgentPromptContractTypes.js";

const schemaOptions = {
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
} as const;

const schemaValidators = {
  "draft-07": new Ajv(schemaOptions),
  "2019-09": new Ajv2019(schemaOptions),
  "2020-12": new Ajv2020(schemaOptions),
} as const;

const schemaDialectDefinitions = [
  {
    dialect: "draft-07" as const,
    canonicalUri: "http://json-schema.org/draft-07/schema#",
    aliases: [
      "http://json-schema.org/draft-07/schema",
      "http://json-schema.org/draft-07/schema#",
      "https://json-schema.org/draft-07/schema",
      "https://json-schema.org/draft-07/schema#",
    ],
    validator: schemaValidators["draft-07"],
  },
  {
    dialect: "2019-09" as const,
    canonicalUri: "https://json-schema.org/draft/2019-09/schema",
    aliases: [
      "http://json-schema.org/draft/2019-09/schema",
      "http://json-schema.org/draft/2019-09/schema#",
      "https://json-schema.org/draft/2019-09/schema",
      "https://json-schema.org/draft/2019-09/schema#",
    ],
    validator: schemaValidators["2019-09"],
  },
  {
    dialect: "2020-12" as const,
    canonicalUri: "https://json-schema.org/draft/2020-12/schema",
    aliases: [
      "http://json-schema.org/draft/2020-12/schema",
      "http://json-schema.org/draft/2020-12/schema#",
      "https://json-schema.org/draft/2020-12/schema",
      "https://json-schema.org/draft/2020-12/schema#",
    ],
    validator: schemaValidators["2020-12"],
  },
] as const;

const schemaDialectAliases = new Map<string, (typeof schemaDialectDefinitions)[number]>(
  schemaDialectDefinitions.flatMap((definition) => definition.aliases.map((alias) => [alias, definition] as const)),
);

const validators = new WeakMap<object, ValidateFunction>();

export interface AgentToolContractValidationIssue {
  readonly keyword: string;
  readonly message: string;
  readonly path: readonly (string | number)[];
  readonly pointer: string;
  readonly schemaPointer: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export function validateToolSignatureArguments(input: {
  contract: AgentPromptContractView;
  args: Record<string, unknown>;
}): AgentToolContractValidationIssue[] {
  return validateToolContractValue({
    schema: input.contract.jsonSchema,
    value: input.args,
  });
}

export function validateToolContractValue(input: {
  schema: Readonly<Record<string, unknown>>;
  value: unknown;
}): AgentToolContractValidationIssue[] {
  const validate = validatorFor(input.schema);
  if (validate(input.value)) return [];
  return (validate.errors ?? []).map(projectAjvIssue);
}

export function formatAgentToolContractValidationIssue(
  issue: AgentToolContractValidationIssue,
  rootLabel: string,
): string {
  const path = issue.path.reduce<string>(
    (result, part) => (typeof part === "number" ? `${result}[${part}]` : result ? `${result}.${part}` : part),
    "",
  );
  return `${path ? `${rootLabel}.${path}` : rootLabel}: ${issue.message}`;
}

export function projectAgentToolContractDiagnostics(
  issues: readonly AgentToolContractValidationIssue[],
  contract?: AgentPromptContractView,
): AgentSourceDiagnostic[] {
  return issues.map((issue) => {
    const property = contract ? findContractProperty(contract.properties, issue.path) : undefined;
    const contractView = property ? projectPropertyContract(property) : undefined;
    return {
      severity: "error",
      code: issue.keyword,
      message: issue.message,
      pointer: issue.pointer,
      path: issue.path,
      ...(contractView ? { suggestion: contractView.signature } : {}),
      context: {
        schemaPointer: issue.schemaPointer,
        parameters: issue.parameters,
        ...(contractView ? { contract: contractView } : {}),
      },
    };
  });
}

export function assertToolContractSchema(schema: Record<string, unknown>): void {
  validatorFor(schema);
}

function validatorFor(schema: Readonly<Record<string, unknown>>): ValidateFunction {
  const cached = validators.get(schema);
  if (cached) return cached;
  const dialect = schemaDialectFor(schema);
  const declaredDialect = schema.$schema;
  const schemaForCompilation =
    typeof declaredDialect === "string" && declaredDialect !== dialect.canonicalUri
      ? { ...schema, $schema: dialect.canonicalUri }
      : schema;
  const validate = dialect.validator.compile(schemaForCompilation);
  validators.set(schema, validate);
  return validate;
}

function schemaDialectFor(schema: Readonly<Record<string, unknown>>): (typeof schemaDialectDefinitions)[number] {
  const declaredDialect = schema.$schema;
  if (declaredDialect === undefined) return schemaDialectDefinitions[0];
  if (typeof declaredDialect !== "string") {
    throw new Error("JSON Schema $schema must be a URI string when provided.");
  }
  const dialect = schemaDialectAliases.get(declaredDialect);
  if (!dialect) throw new Error(`Unsupported JSON Schema dialect: ${declaredDialect}`);
  return dialect;
}

function projectAjvIssue(error: ErrorObject): AgentToolContractValidationIssue {
  const path = [...jsonPointerPath(error.instancePath), ...ajvParameterPath(error.params)];
  return {
    keyword: error.keyword,
    message: error.message ?? "JSON Schema validation failed",
    path,
    pointer: agentStructuredIssuePathToPointer(path) || "/",
    schemaPointer: error.schemaPath,
    parameters: { ...error.params },
  };
}

function ajvParameterPath(parameters: Record<string, unknown>): Array<string | number> {
  const property = parameters.additionalProperty ?? parameters.missingProperty;
  return typeof property === "string" && property.length > 0 ? [property] : [];
}

function jsonPointerPath(pointer: string): Array<string | number> {
  return pointer
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((segment) => (/^(?:0|[1-9]\d*)$/u.test(segment) ? Number(segment) : segment));
}

function findContractProperty(
  properties: readonly AgentPromptContractProperty[],
  path: readonly (string | number)[],
): AgentPromptContractProperty | undefined {
  let candidates = properties;
  let selected: AgentPromptContractProperty | undefined;
  for (const segment of path) {
    if (typeof segment === "number") {
      selected = selected?.element;
    } else {
      selected = candidates.find((property) => property.name === segment) ?? selected?.element;
    }
    if (!selected) return undefined;
    candidates = selected.children.length > 0 ? selected.children : (selected.element?.children ?? []);
  }
  return selected;
}

function projectPropertyContract(property: AgentPromptContractProperty): {
  readonly path: string;
  readonly signature: string;
  readonly description?: string;
} {
  return {
    path: property.path,
    signature: `${property.name}${property.required ? "" : "?"}: ${property.typeText}`,
    ...(property.comment ? { description: property.comment } : {}),
  };
}
