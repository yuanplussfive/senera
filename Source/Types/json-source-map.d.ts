declare module "json-source-map" {
  export interface JsonSourceLocation {
    line: number;
    column: number;
    pos: number;
  }

  export interface JsonSourcePointer {
    key?: JsonSourceLocation;
    keyEnd?: JsonSourceLocation;
    value?: JsonSourceLocation;
    valueEnd?: JsonSourceLocation;
  }

  export interface JsonSourceMapResult<T = unknown> {
    data: T;
    pointers: Record<string, JsonSourcePointer>;
  }

  export function parse<T = unknown>(source: string, reviver?: unknown, options?: unknown): JsonSourceMapResult<T>;

  export function stringify(
    data: unknown,
    replacer?: unknown,
    options?: unknown,
  ): {
    json: string;
    pointers: Record<string, JsonSourcePointer>;
  };
}
