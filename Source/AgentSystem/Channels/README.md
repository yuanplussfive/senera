# Channels

`Channels` connects Senera sessions to external messaging platforms. The
design mirrors reference gateway architectures (notably Hermes) while keeping
the Senera invariants: everything inbound goes through the normal Session
boundary, outbound delivery follows the adapter's explicit or automatic contract, and detached
work completes through the durable delegation delivery layer.

## Supported Platforms

| Platform                    | Receive                                                                                                        | Send                                                                                                                           | Streaming                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Telegram                    | long polling (default, NAT-friendly) or webhook (`mode: webhook` + `webhookUrl`)                               | Bot API `sendMessage`/`editMessageText`                                                                                        | throttled live-preview edits       |
| QQ (official open platform) | resumable WebSocket gateway (or signed webhook) with READY/RESUME, heartbeat supervision and bounded reconnect | `v2/users`, `groups`, and `channels` message APIs with cached bearer token, native Markdown, media upload and inline keyboards | batch (QQ has no message edit API) |
| Discord                     | gateway WebSocket with heartbeat supervision, resume and exponential reconnect                                 | REST messages with `message_reference`/edits                                                                                   | throttled live-preview edits       |
| OneBot 11 (local virtual)   | authenticated workspace WebSocket on the shared Senera listener                                                | explicit `Channel*` tools in the active lane                                                                                   | none; never auto-delivered         |

## Configuration

The console listener does not wait for channel handshakes. Enabled channels
connect concurrently and publish their own connection state, so an external
platform's network delay cannot block the local OneBot client or console.

Configuration lives in the `agent-channels` system extension so the settings
workbench renders it automatically:

- `enabled`: master switch for the whole gateway.
- `defaultApprovalMode`: approval mode for channel-initiated turns
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
- `onebot11.enabled`: enables the embedded local virtual account. The QQ client
  uses `/api/channel-clients/onebot11/<workspaceId>/socket` on the Senera
  listener and authenticates with the host session. There is no additional
  listener, gateway token or user-supplied protocol identity. Existing numeric
  identities persist in workspace storage; Agent UUIDs remain authoritative.
  Contact names and avatars come from the workspace user profile and Agent
  directory. Protocol heartbeats are managed internally.
- `profileRoutes`: optional declarative routing rules that select a profile by
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
The local OneBot client uses host authentication, per-message authorization and
workspace isolation. It is not an official QQ connection and has no automatic
outbound transcript delivery.

The gateway uses OneBots for OneBot 11 actions, native WebSocket protocol handling,
CQ segments, and heartbeats. The AGPL QQ client lives under `Frontend/qq/client`,
shares the frontend dependencies and build, and opens in an independent browser
page or desktop window.
Its declared interoperability patch selects the standard
mapping by `protocol_version` without impersonating a different server. The
component's complete modified source, pinned submodules, licenses, build
inputs, and notice ship alongside its compiled web resources. Desktop users
open the component from channel settings; it receives the active connection
through an isolated preload. Server-only deployments can use another OneBot
client with the displayed endpoint.

Implementation-specific QQ administration and website credentials are not
invented. This is a local conversation, not a real QQ login. The maintained
AGPL client source lives in `Frontend/qq/client` and shares the frontend build;
the gateway implements its declared native OneBot message capabilities.

## Conversation Model

One channel conversation lane maps to exactly one senera session:

- Identity is deterministic (a hash of the canonical lane and epoch),
  so restarts resume the same conversation without registration state.
- Group lanes include the recipient Agent ID, while public conversation
  identity excludes it. Each member uses its own model, profile, preset and
  durable Senera session; native group history is shared.
- The mapping is persisted in `channels.sqlite` so `/new`
  bumps an epoch (and hence a fresh session) without losing old history.
- For the local OneBot gateway, the console transcript follows Pi's committed
  compaction boundary. Initial history reads a recent window of whole requests;
  earlier windows load on demand. Returning to the current window releases the
  archived client data after recovery completes. Failed runs, tool results,
  approvals and attachments travel with their request. The durable Session and
  native QQ timeline remain intact, and each group member follows its own Pi
  boundary. Other channel and console sessions keep their full-history behavior.
- Automatic channel busy semantics reuse the Session queue. Explicit channels use a
  durable event inbox with independent read and activation cursors. Busy
  participants resume once on the latest matching event and read accumulated
  context chronologically, instead of queuing a complete turn per message.
- All enabled group members observe activity. The directory no longer stores
  an all/addressed activation filter: the model decides whether to speak or
  listen. Own messages never activate their sender. Native mentions, replies,
  pokes and membership notices retain their verified identities.
- `ChannelWaitMessage` registers event/sender/time conditions and terminates
  inference immediately. There is no blocked model call. The wait, deadline,
  read cursor, pending trigger and continuation request identity survive
  restarts; admission receipts reconcile interrupted wake delivery.
- `/stop` pauses participation without erasing the read cursor. Fresh activity
  may resume it. `/new` cancels old work and advances its lane epoch. Removing
  or disabling a member revokes both participation and subsequent tool access.
  Only the authenticated operator can issue host control commands; peer speech
  cannot cancel another participant's work.
- `ChannelReadHistory` reads the live inbox and acknowledges only contiguous
  pages. `ChannelReadArchive` pages through the original OneBot timeline,
  including earlier messages and notices, without changing the inbox cursor.
  The two sequence spaces are deliberately separate.
- Each wake carries a contiguous `channel_inbox` page of complete events,
  including native segments and upload references. Prefetch uses the published
  history tool's default page size and the configured artifact observation
  token ceiling with the recipient model's estimator. Whole events that do not
  fit stay unread (`hasMore`); no synthetic summary or partial message is
  substituted. Admission alone does not acknowledge this page: a subsequent
  channel tool or successful completion does. Rejected/failed turns retain it.
- Sending text, replies, media and pokes checks for unread activity. A
  `needs_review` receipt carries newer events and performs no outbound action.
  The next model decision may revise, stay silent or send; `allowUnread=true`
  explicitly permits an independent contribution despite newer discussion.
  Reads in the same parallel tool batch cannot authorize another action in
  that batch. A matching arrival before waiting similarly returns context
  without suspending inference. Own messages do not require review.
- Wait `senderIds` applies to ordinary messages and ambient recall/membership
  events. Selected native mention/reply/poke listeners remain independent of
  that sender filter. Narrow waits have no implicit expiry; an Agent chooses
  its own meaningful `wakeAt` when it intends to return proactively.
- Session history resources remove corresponding inbox task bindings as well
  as native protocol records. Delayed ingestion and reads verify records
  against the protocol history, so removed messages or notices cannot become
  fresh triggers. A conversation clear also removes its participants and waits.

## Outbound Rendering

`AgentChannelRunRenderer` consumes the standard `AgentDomainEvent` stream of
one request and produces channel messages:

- `run.started`: opens the rendering lane without emitting synthetic status
  text.
- `assistant.message.created`: model-authored prefaces are delivered before a
  tool batch; final answers remain separate when a preface was sent.
- `model.delta`: throttled live-preview edits (default 800 ms / 24 chars,
  injectable) only on platforms that support message edits. Timer edits share
  the event lane, so an older preview cannot overwrite the final answer.
- Tool lifecycle events stay in the execution feed; model-authored prefaces
  and final answers are the visible channel delivery boundaries.
- Automatic channels project authored resources deterministically through the shared Markdown and workspace boundary. Tool artifacts alone are never published.
- `run.completed/failed/cancelled`: final answer, failure or cancellation
  message. Long answers are split by the platform's max length while code
  fences stay balanced; Telegram receives MarkdownV2 escaping and degrades to
  plain text if a send is rejected.

QQ official and local OneBot deliberately opt out of this renderer. Both share
a durable inbox, explicit channel tools and model-selected waits. Official QQ
retains its native event, passive-reply and proactive-send restrictions; it
does not expose the local simulator's poke, archive or native quote capabilities.
The local client can send a message into Senera, but Senera only sends a OneBot
event when the model explicitly sends, replies, sends media, pokes or recalls through the
current-lane channel tools. Read and wait tools never send messages. Native
group mentions use `mentionIds`; a group poke uses `targetId`, both validated
against host-owned participant identities. The model cannot choose another
conversation or impersonate another account.

An inbound OneBot `send_*_msg` action is acknowledged after its complete
segments and readable media have been accepted. The client renders its own
successful send; the gateway does not echo it as a received assistant message.
The resulting Senera turn is queued asynchronously, so model execution does
not hold the action response open. Media-only messages use the same upload
ingestion as console messages. Attachments are resolved before a waiting tool
can consume a message, and that message is not also queued as a second turn.

Message IDs and complete ordered segments persist in the gateway's SQLite
store. History is paginated rather than truncated to an in-memory window.
The protocol returns chronological pages; host tools can read the latest
records first. Owned media is stored in the isolated gateway directory and
rehydrated against the current origin, so changing the port preserves history.
Recalls check message ownership and the canonical conversation lane.

### Host-owned final publication

Explicit channels publish only through successful channel tool calls. Automatic
channels render the authored terminal response through deterministic Markdown
projection, validating resource references and preserving text/media order.
There is no preface or final-response rewriting model or configuration switch.
Host-generated proactive activities may submit an already structured
`AgentChannelActivity` on automatic channels; they use the same adapter and
receipt boundary. Explicit channels decide their own follow-up through durable
waits and channel tools.

Detached background work stays in the durable task inbox by default. A host
may explicitly bind an `AgentDelegationCompletionPort` when a channel needs a
separate external notification; that delivery is durable, idempotent, and
retried by `AgentDelegationCompletionDelivery`, but never creates a hidden
parent-session turn.

## Delivery Resilience

`AgentChannelDelivery` serializes one lane's sends, retries transient
failures with injectable backoff, honors platform flood-control windows
(`retry_after`), and drops only after the configured attempt budget while
logging the dropped payload. The renderer uses `enqueueAndWait` for user-facing
text and media, so a delivery receipt is required before a part is marked as
sent. If a preview can no longer be edited, the full final answer is sent as a
new message and still requires a delivery receipt. One rejected operation is
reported to its caller without blocking later events. `queue_full`, `stopped`, `unsupported`, and `retry_exhausted` remain
distinct failure states; a failed turn produces one best-effort channel notice
instead of being reported as completed.

## HTTP Entries

- `POST /api/channels/telegram/webhook`: Telegram webhook mode.
- `POST /api/channels/qq/webhook`: QQ callbacks.

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
