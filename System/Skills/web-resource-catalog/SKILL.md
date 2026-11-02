---
name: web-resource-catalog
description: Select public China or global sources for anime, Cosplay, guides, materials, research, and daily information before browser automation. Use when a user needs to find a source rather than operate a known URL. 适用于先找公开网站、资料、动漫、Cosplay、素材、攻略或日常信息，再交给浏览器访问的任务。
metadata:
  senera:
    icon: globe
    recommended-tools:
      - BrowserOpen
      - BrowserRead
      - BrowserSnapshot
      - BrowserGetText
---

# Web Resource Catalog

Use this Skill to choose a source before opening the browser. It is a source guide, not a new tool.

## When to use

- The user asks where to find anime, manga, Cosplay, game guides, tutorials, assets, research, news, or daily information.
- The user asks for sources available in China, global sources, or a comparison between them.
- The browser task has an objective but no target URL.

Do not use it when the user supplies a URL or asks to operate a known page.

## Workflow

1. For Chinese-language or mainland-oriented requests, read `references/china.md`.
2. For international or cross-border requests, read `references/global.md`.
3. For a mixed request, read only the relevant sections from both references.
4. Prefer a source marked `API`, `RSS`, `Atom`, or `static`; use `browser` for public pages where visual browsing matters.
5. Open the selected source with the controlled browser and follow the Browser Automation Skill for page state, screenshots, downloads, and interactions.
6. Preserve the original link, author, date, and license when the source provides them.

## Boundaries

- These sources are for public reading and discovery. Do not invent private endpoints or use a page's internal network calls as an API.
- Do not log in, create an account, send content, buy, reserve, or publish unless the user explicitly requests that action.
- If a selected source is unavailable, report that observed result and choose another source only when it still serves the user's stated goal.

## Resources

- `references/china.md` contains mainland-oriented public sources.
- `references/global.md` contains international public sources.
