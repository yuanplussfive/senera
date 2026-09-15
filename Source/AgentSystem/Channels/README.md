# Channels

`Channels` connects Senera sessions to external messaging platforms. The
design mirrors reference gateway architectures (notably Hermes) while keeping
the Senera invariants: everything inbound goes through the normal Session
boundary, everything outbound renders the standard event stream, and detached
work completes through the durable delegation delivery layer.

## Supported Platforms

| Platform                    | Receive                                                                                                        | Send                                         | Streaming                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------- |
| Telegram                    | long polling (default, NAT-friendly) or webhook (`mode: webhook` + `webhookUrl`)                               | Bot API `sendMessage`/`editMessageText`      | throttled live-preview edits |
| QQ (official open platform) | resumable WebSocket gateway (or signed webhook) with READY/RESUME, heartbeat supervision and bounded reconnect | `v2/users                                    | groups                       | channels` message APIs with cached bearer token, native Markdown, media upload and inline keyboards | batch (QQ has no message edit API) |
| Discord                     | gateway WebSocket with heartbeat supervision, resume and exponential reconnect                                 | REST messages with `message_reference`/edits | throttled live-preview edits |

## Configuration

Configuration lives in the `agent-channels` system extension so the settings
workbench renders it automatically:

- `enabled` — master switch for the whole gateway.
- `defaultApprovalMode` — approval mode for channel-initiated turns
  (`agent` by default). QQ approval prompts use native callback keyboards;
  button clicks are ACKed first and then routed through the normal session
  authorization boundary.
- `telegram.token/mode/webhookUrl/webhookSecret/allowedUsers/allowAllUsers`.
- `qq.appId/appSecret/mode/webhookSecret/allowedUsers/groupAllowedUsers/allowAllUsers/dmPolicy/groupPolicy`.
  `QQ_APP_ID` and `QQ_CLIENT_SECRET` are accepted as environment fallbacks for
  unattended Hermes-style deployments.
- QQ also accepts Hermes-compatible snake_case aliases (`app_id`,
  `client_secret`, `allow_from`, `group_allow_from`, `dm_policy`,
  `group_policy`, `markdown_support`, `stream_progress`, and the upload/
  timeout aliases). Empty canonical values fall through to a meaningful alias.
- QQ outbound media accepts hosted URLs, data URIs/base64 and local paths. Files above the inline limit use the official prepare/part-finish/complete upload flow; all parts are bounded and retried.
- QQ keyboards use native callback/link actions. `INTERACTION_CREATE` events
  are acknowledged before being forwarded to the session control plane;
  unauthorized operators are ignored after the ACK. Long keyboard messages
  keep all remaining text chunks after the first keyboard-bearing message.
- QQ callback webhooks answer the op=13 verification challenge immediately.
  Normal callback signatures use `webhookSecret` when supplied, otherwise the
  required AppSecret, matching the official platform contract.
- QQ inbound attachments preserve image/video/audio/file metadata, quoted
  `message_type=103` context, `asr_refer_text`, and `voice_wav_url`; the shared
  upload resolver materializes CDN URLs with a short-lived QQ bearer token.
  An optional `qq.stt` OpenAI-compatible endpoint (or `QQ_STT_*` environment
  variables) can transcribe voice attachments when QQ did not provide a native
  transcript.
- `discord.token/allowedUsers/allowAllUsers/intents`.
- `profileRoutes` — optional declarative routing rules that select a profile by
  surface, platform, chat shape or opaque lane identifiers. Rules are
  ranked by priority and selector specificity; an unresolved tie is rejected
  explicitly instead of silently choosing one. The resolved registry is read
  from the live configuration for each new channel turn, so a configuration
  update does not require a process restart.

Authorization is explicit per channel. QQ follows the settings contract and
defaults `allowAllUsers` to `true`; disable it and provide `allowedUsers` (and
the group policy/allowlist) when the bot must be private. Telegram and Discord
remain fail-closed by default. `pairing` remains closed until a pairing
workflow is installed, so an accidental configuration cannot expose the agent.

## Conversation Model

One channel conversation lane maps to exactly one senera session:

- Identity is deterministic (`senera_channel_<hash(platform,chatType,chatId,userId,threadId,epoch)>`),
  so restarts resume the same conversation without registration state.
- The mapping is persisted in `channels.sqlite` (migration 0001) so `/new`
  bumps an epoch (and hence a fresh session) without losing old history.
- Busy semantics reuse the Session queue: an inbound message while a turn is
  running is queued as `follow_up` instead of interrupting the model. `/stop`
  cancels the active run through the normal cancellation boundary.

## Outbound Rendering

`AgentChannelRunRenderer` consumes the standard `AgentDomainEvent` stream of
one request and produces channel messages:

- `run.started` — opens the rendering lane without emitting synthetic status
  text.
- `assistant.message.created` — model-authored prefaces are delivered before a
  tool batch; final answers remain separate when a preface was sent.
- `model.delta` — throttled live-preview edits (default 800 ms / 24 chars,
  injectable) only on platforms that support message edits.
- `tool.call.started` — one compact `调用 <tool>` line per invocation (opt-out
  `streamProgress`).
- Every channel final answer goes through the host-owned ordered-parts
  serializer. The serializer keeps its protocol guidance in the stable system
  prefix; the current user payload carries a bounded `resource_manifest`
  generated from the same Markdown AST and workspace boundary used by delivery.
  Canonical `senera://resource/...` references are preferred, public `http(s)`
  URLs remain unchanged, and relative/absolute local paths are emitted with
  their verified workspace absolute path. Unresolved paths stay text rather
  than being guessed.
  A resource is published only when the serializer emits an explicit resource
  part or a host job submits an `AgentChannelActivity` with a current-turn
  publication set. Tool observations and Artifact assets are availability
  metadata, never implicit outbound messages.
- `run.completed/failed/cancelled` — final answer, failure or cancellation
  message. Long answers are split by the platform's max length while code
  fences stay balanced; Telegram receives MarkdownV2 escaping and degrades to
  plain text if a send is rejected.

### Host-owned final publication

The model does not publish directly to a channel. Once a channel run reaches
its terminal assistant response, the host serializes that response into
ordered text, resource, and code parts, validates the resource boundary, and
delivers the parts exactly once through the adapter. This keeps media intent,
paragraph boundaries, delivery receipts, and finalization history on one
path. Host-generated proactive activities may submit an already structured
`AgentChannelActivity`; they still use the same adapter delivery boundary.

Detached background work completes through `AgentDelegationCompletionPort`
(durable, idempotent, retried by `AgentDelegationCompletionDelivery`); the
channel service looks up the owning lane and delivers the result summary.

## Delivery Resilience

`AgentChannelDelivery` serializes one lane's sends, retries transient
failures with injectable backoff, honors platform flood-control windows
(`retry_after`), and drops only after the configured attempt budget while
logging the dropped payload. The renderer uses `enqueueAndWait` for user-facing
text and media, so a delivery receipt is required before a part is marked as
sent. `queue_full`, `stopped`, `unsupported`, and `retry_exhausted` remain
distinct failure states; a failed turn produces one best-effort channel notice
instead of being reported as completed.

## HTTP Entries

- `POST /api/channels/telegram/webhook` — Telegram webhook mode.
- `POST /api/channels/qq/webhook` — QQ callbacks.

Both entries are registered ahead of the CSRF-guarded routes: their
authentication is the platform secret (Telegram secret token, QQ HMAC
signature), not a browser session. Telegram requires its dedicated
`webhookSecret`; QQ signs with `webhookSecret` when supplied and otherwise the
required AppSecret. Requests that cannot be authenticated fail closed with an
error status.

## Testing

```bash
npx vitest run --config vitest.backend.config.ts Scripts/BackendTests/Channels
```

Adapters accept an injected `AgentChannelHttpTransport`, so every network
failure path (flood control, HTTP 400 fallback, token revalidation, webhook
rejection) is exercised without external connectivity.
