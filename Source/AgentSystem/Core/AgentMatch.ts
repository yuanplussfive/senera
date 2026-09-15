export function matchByField<TField extends string, TValue extends Record<TField, string>, TResult>(
  value: TValue,
  field: TField,
  handlers: {
    [TTag in TValue[TField]]: (entry: Extract<TValue, Record<TField, TTag>>) => TResult;
  },
): TResult {
  const tag = value[field] as TValue[TField];
  const handler = handlers[tag];
  return handler(value as Extract<TValue, Record<TField, TValue[TField]>>);
}

export function matchByKind<TValue extends { kind: string }, TResult>(
  value: TValue,
  handlers: {
    [TKind in TValue["kind"]]: (entry: Extract<TValue, { kind: TKind }>) => TResult;
  },
): TResult {
  return matchByField(value, "kind", handlers);
}

export function matchByType<TValue extends { type: string }, TResult>(
  value: TValue,
  handlers: {
    [TType in TValue["type"]]: (entry: Extract<TValue, { type: TType }>) => TResult;
  },
): TResult {
  return matchByField(value, "type", handlers);
}
