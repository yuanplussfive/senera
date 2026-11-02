export function deepFreeze<T>(value: T): T {
  return freezeValue(value, new WeakSet<object>());
}

function freezeValue<T>(value: T, visited: WeakSet<object>): T {
  if (value === null || typeof value !== "object" || visited.has(value)) return value;
  visited.add(value);
  for (const key of Reflect.ownKeys(value)) freezeValue(Reflect.get(value, key), visited);
  return Object.freeze(value);
}
