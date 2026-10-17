declare module "json-parse-even-better-errors" {
  export interface JsonParseError extends SyntaxError {
    code: "EJSONPARSE";
    position?: number;
    systemError?: unknown;
  }

  interface ParseJson {
    (text: string | Buffer, reviver?: (key: string, value: unknown) => unknown): unknown;
    JSONParseError: new (error: Error, text: string, context?: number, caller?: unknown) => JsonParseError;
    noExceptions: (text: string | Buffer, reviver?: (key: string, value: unknown) => unknown) => unknown;
  }

  const parseJson: ParseJson;
  export = parseJson;
}
