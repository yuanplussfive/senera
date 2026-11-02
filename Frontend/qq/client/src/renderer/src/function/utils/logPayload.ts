/** Keep diagnostic payloads on one structured log line, including errors and repeated references. */
export function serializeLogPayload(data: unknown): string | undefined {
    const seen = new WeakSet<object>()
    return JSON.stringify(data, (_key, value: unknown) => {
        if (typeof value === 'bigint') return value.toString()
        if (value && typeof value === 'object') {
            if (seen.has(value)) return '[Reference]'
            seen.add(value)
        }
        return value instanceof Error
            ? { name: value.name, message: value.message, stack: value.stack, cause: value.cause }
            : value
    })
}
