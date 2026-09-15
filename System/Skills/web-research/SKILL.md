---
name: web-research
description: Research current external information from web pages, news, official documentation, release notes, companies, products, policies, or other facts that may have changed. Use when answers need fresh web evidence, source comparison, or verification against public sources. 适用于联网搜索、查找最新资料、新闻、官方文档或版本信息，并对公开来源进行核验和对比。
metadata:
  senera:
    recommended-tools:
      - WebSearch
      - WebFetch
---

# Web Research

Use `WebSearch` to gather current external evidence and `WebFetch` when the result page needs to be read. Both default to the configured deadline; use `timeoutMs` only when a specific source needs a longer or shorter bounded wait. Omit `WebFetch.maxBytes` for ordinary pages so the configured response budget applies. When setting it, prefer a large budget: the tool retains and marks the available prefix when a page exceeds the budget, so a truncated result must not be treated as complete evidence.

1. Turn the request into one or more concrete search queries.
2. Prefer official and primary sources when available.
3. Narrow by domain, topic, country, or date only when the request justifies it.
4. Compare sources for consequential or disputed claims.
5. Ground the answer in returned URLs and distinguish source facts from synthesis.
