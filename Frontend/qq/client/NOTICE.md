# Senera QQ Client — corresponding source and attribution

This frontend source directory contains the editable Senera channel client, derived from
[Stapxs QQ Lite](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0) v3.5.2,
revision `0afd7f1ff1dee7933a1e344cce4700e05cd096d6`.
Copyright and original author notices are retained in the source.
Copyright © 2022–2026 Stapx Steve [林槐] and the original contributors.
The client and Senera's modifications remain licensed under AGPL-3.0-only;
see `LICENSE` and the upstream `DISCLAIMER.md`.

On 2026-10-26, Senera removed obsolete standalone onboarding, promotion,
telemetry, self-updates, native platform bridges and Tauri history storage.
Senera QQ uses the host's authenticated WebSockets and persistent timeline,
one shared foreground/retry lifecycle, the declared OneBot 11 contract,
packaged QFace assets and the MIT-licensed pinyin-pro dependency.
Product-facing branding is Senera QQ; original attribution and licensing
remain in this notice, the source headers and LICENSE.

On 2026-10-26, Senera removed the redundant standalone component publisher
and staging pipeline. The QQ document, shared assets and corresponding source
archive now ship directly in the application's unified Frontend/dist output.

On 2026-10-26, Senera moved the client into Frontend/qq, consolidated its
dependencies into the frontend manifest, and added an embedded React page.
The Vue document retains its CSS and viewport scope; channel traffic continues
through the workspace gateway. Corresponding source preserves the actual
application layout, dependency lockfile and build commands.

On 2026-10-26, Senera separated authenticated chat state from recoverable
transport interruptions, preserved uploads and drafts across reconnections,
and replaced full-file Base64 image previews with disposable object URLs and
original-file uploads through the shared resource API.

Senera contributors modified this source on 2026-10-24 to integrate the hosted
OneBot 11 client with Senera: standard protocol mapping, workspace-scoped
preferences, same-origin connection bootstrap, reconnect and chat restoration,
native media/file delivery, poke/recall notices, and sanitized Markdown messages.
Additional changes connect conversation clearing and task deletion to Senera's
history lifecycle, persist and replay notices and recall snapshots, paginate the
combined timeline, and use the host-provided display timezone.
Hosted builds omit standalone onboarding, promotion, telemetry, self-updates
and the upstream service worker. Credentials remain on the host.

On 2026-10-25, Senera integrated this Vue workspace into its shared multi-page
Vite development server and release build. Public resources are scoped to the
QQ entry, optional chat views load lazily, and publication verifies the source
fingerprint and extracts the entry's actual dependency graph. The editable
client remains AGPL-3.0-only and is built by the unified frontend project.

On 2026-10-25, Senera removed the external AMap SDK and its key requirement.
Location cards retain the native place, address and coordinates. Client startup
now runs from component mounting instead of depending on window.load, and
initialization failures are presented in the application rather than leaving
an indefinite loading indicator.

The hosted entry now declares the viewport and theme metadata used by the
client settings. Viewport scale updates share one implementation, and keyboard
shortcuts ignore malformed, composing or already-consumed events. Hosted
development pages do not start the upstream spacing/FPS inspector.

The hosted shell provides separate desktop and mobile layouts, a workspace
connection screen, and shared attachment cards for messages and quoted files.
Image quotes retain thumbnails and navigation to the original message. Files
are downloaded explicitly instead of being fetched during rendering. The
client preserves the user's automatic-connection preference on subsequent loads.

The group member and management views share accessible avatar rows and FakeQQ's
theme tokens, with a compact desktop profile panel and full-screen mobile views.
Group emoji reactions and essence messages use gateway actions and durable
server state; essence contents reuse the client's complete message renderer.

Bundled upstream resources retain their own license notices:

- QFace: https://github.com/koishijs/QFace,
  revision `8fac1fa62c16e91e3221b439ad3f9f2f5c4b1f1d`,
  in `src/renderer/src/assets/img/qq-face/`.
- Border Card UI: https://github.com/Stapxs/Border-Card-UI,
  revision `afc93141ba2fc67a25f60045d89ac707b773fe99`,
  in `src/renderer/public/bcui/`.
- FakeQQ-UI: https://github.com/Redlnn/FakeQQ-UI, version `0.3.4`,
  Copyright (c) 2024 Red_lnn, MIT; its full license is reproduced below.
  Senera uses its message and notice components, with an integration theme
  and an updated conversation shell. Protocol, media, Markdown, recall,
  quote navigation and group actions remain provided by this client.

The release's license link downloads the corresponding modified application source,
including the application build configuration and this notice. `package-lock.json`
in that download is the root workspace dependency lock used for the build.
See `README.md` for build commands. Preserve these notices when redistributing.

## FakeQQ-UI license

On 2026-10-25, Senera redesigned hosted group creation and settings for desktop
and mobile, added a local bubble and background catalogue with FakeQQ-UI
previews, and unified participant avatars with workspace profile resources.
The hosted shell shares one workspace event connection for profile updates,
Agent directory changes and conversation lifecycle events.

Hosted message normalization resolves relative media URLs against the host
page, independent of the development static asset base. History replay and
quoted media use the same URL handling as live messages.

MIT License

Copyright (c) 2024 Red_lnn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
