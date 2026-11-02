# Backend i18n

Backend user-visible errors use locale-neutral descriptors. The server keeps the
legacy `message` string for compatibility and adds a `localizedMessage` payload:

```json
{
  "message": "...",
  "localizedMessage": {
    "key": "config.providerEndpointMissing",
    "params": { "providerId": "custom" },
    "text": {
      "zh-CN": "...",
      "en-US": "..."
    }
  }
}
```

All locales are projected into the event because one broadcast can be consumed
by clients using different languages. Domain code must not depend on a client
locale.

## Adding messages

1. Add the same key to `messages.zh-CN.json` and `messages.en-US.json`.
2. Keep placeholder names identical in every locale.
3. Throw `AgentLocalizedError` for known failures, or extend it in a domain
   error that also carries stable `code` and `details` fields.
4. Use `projectAgentMessage` for a known event message and
   `projectAgentErrorMessage` at an unknown-error boundary.
5. Add or update behavior tests for the affected protocol event.

`npm run verify.i18n` enforces catalog parity, placeholder parity, English
catalog purity, frontend runtime rules, and preservation of structured error
metadata.

The frontend resolves backend messages through
`Frontend/src/i18n/backendMessage.ts`. Consumers must not read an error event's
`message` field directly when a localized payload can be present. The legacy
field is the detailed backend-default-locale text; the resolver preserves it
for that locale and selects `localizedMessage.text` for other locales.
