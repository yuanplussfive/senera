type SerializedPrimitive = string | number | boolean | null;

export type SerializedErrorValue =
  | SerializedPrimitive
  | SerializedErrorValue[]
  | { [key: string]: SerializedErrorValue | undefined };

type SerializedErrorObject = {
  name?: string;
  message?: string;
  stack?: string;
  cause?: SerializedErrorValue;
  [key: string]: SerializedErrorValue | undefined;
};

export function serializeError(error: unknown): SerializedErrorValue {
  return serializeUnknown(error, new WeakSet<object>());
}

function serializeUnknown(
  value: unknown,
  seen: WeakSet<object>,
): SerializedErrorValue {
  return (
    serializePrimitive(value)
    ?? serializeErrorInstance(value, seen)
    ?? serializeArray(value, seen)
    ?? serializeObject(value, seen)
    ?? String(value)
  );
}

function serializePrimitive(value: unknown): SerializedPrimitive | undefined {
  return value == null
    ? null
    : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? value
      : undefined;
}

function serializeErrorInstance(
  value: unknown,
  seen: WeakSet<object>,
): SerializedErrorObject | undefined {
  if (!(value instanceof Error)) {
    return undefined;
  }

  if (seen.has(value)) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  seen.add(value);

  const baseEntries = [
    ["name", value.name],
    ["message", value.message],
    ["stack", value.stack],
    ["cause", "cause" in value ? serializeUnknown(value.cause, seen) : undefined],
  ] as const;

  const extraEntries = Reflect.ownKeys(value)
    .filter((key) => typeof key === "string" && !["name", "message", "stack", "cause"].includes(key))
    .map((key) => [key, serializeUnknown(Reflect.get(value, key), seen)] as const);

  return Object.fromEntries(
    [...baseEntries, ...extraEntries].filter(([, item]) => item !== undefined),
  );
}

function serializeArray(
  value: unknown,
  seen: WeakSet<object>,
): SerializedErrorValue[] | undefined {
  return Array.isArray(value)
    ? value.map((item) => serializeUnknown(item, seen))
    : undefined;
}

function serializeObject(
  value: unknown,
  seen: WeakSet<object>,
): SerializedErrorObject | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (seen.has(value)) {
    return {
      message: "[Circular]",
    };
  }

  seen.add(value);

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, serializeUnknown(item, seen)]),
  );
}
