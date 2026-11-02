<!-- Senera channel client customization, AGPL-3.0-only. -->
<template>
    <div class="channel-markdown" @click="handleClick" v-html="html" />
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { downloadUrl } from '@senera/resource-links'
import { renderChannelMarkdown } from '@renderer/runtime/channelMarkdown'
import { openLink } from '@renderer/function/utils/appUtil'
import { copyToClipboard } from '@renderer/function/utils/systemUtil'
import { PopInfo, PopType } from '@renderer/function/base'
import { seneraResourceBaseUrl } from '@renderer/runtime/seneraContext'
import { Img } from '@renderer/function/model/img'

const props = defineProps<{ source: string }>()
const html = computed(() => renderChannelMarkdown(props.source, seneraResourceBaseUrl()))
const viewerHost = inject<{ viewer: import('vue').Ref<{ open: (image: Img) => void } | null> }>('viewer')

async function handleClick(event: MouseEvent) {
    if (!(event.target instanceof Element)) return
    const image = event.target.closest('img')
    if (image instanceof HTMLImageElement && !image.closest('a')) {
        event.preventDefault()
        event.stopPropagation()
        viewerHost?.viewer.value?.open(new Img(image.currentSrc || image.src))
        return
    }
    const copy = event.target.closest('button.channel-code-copy')
    if (copy) {
        const source = copy.closest('.channel-code')?.querySelector('pre code')?.textContent
        if (source === undefined || source === null) return
        try {
            await copyToClipboard(source)
            new PopInfo().add(PopType.INFO, '已复制代码')
        } catch (reason) {
            new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason))
        }
        return
    }
    const link = (event.target as Element).closest('a')
    if (!link) return
    const href = link.getAttribute('href')
    if (href?.startsWith('#')) return
    event.preventDefault()
    event.stopPropagation()
    if (href && link.hasAttribute('data-resource-link')) {
        try {
            await downloadUrl(href, link.textContent ?? '')
        } catch (reason) {
            new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason))
        }
        return
    }
    if (href && URL.canParse(href, window.location.href)) {
        const url = new URL(href, window.location.href)
        if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) openLink(url.href)
    }
}
</script>

<style scoped>
.channel-markdown {
    min-width: 0;
    max-width: 100%;
    line-height: 1.65;
    overflow-wrap: anywhere;
    white-space: normal;
}
.channel-markdown :deep(> :first-child) {
    margin-top: 0;
}
.channel-markdown :deep(> :last-child) {
    margin-bottom: 0;
}
.channel-markdown :deep(p) {
    margin: 0.6em 0;
}
.channel-markdown :deep(h1),
.channel-markdown :deep(h2),
.channel-markdown :deep(h3),
.channel-markdown :deep(h4),
.channel-markdown :deep(h5),
.channel-markdown :deep(h6) {
    margin: 1em 0 0.4em;
    font-size: 1em;
    font-weight: 650;
    line-height: 1.4;
}
.channel-markdown :deep(h1) {
    font-size: 1.3em;
}
.channel-markdown :deep(h2) {
    font-size: 1.15em;
}
.channel-markdown :deep(ul),
.channel-markdown :deep(ol) {
    margin: 0.5em 0;
    padding-inline-start: 1.5em;
}
.channel-markdown :deep(li) {
    margin: 0.25em 0;
}
.channel-markdown :deep(li > p) {
    margin: 0.25em 0;
}
.channel-markdown :deep(a) {
    text-decoration: underline;
    text-underline-offset: 0.18em;
}
.channel-markdown :deep(a::before) {
    content: none;
}
.channel-markdown :deep(code) {
    padding: 0.12em 0.32em;
    border-radius: 4px;
    background: var(--color-card-2);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 0.9em;
}
.channel-markdown :deep(pre) {
    display: block;
    max-width: 100%;
    overflow: auto;
    margin: 0.75em 0;
    padding: 0.85em 1em;
    border-radius: 6px;
    background: var(--color-card-2);
    white-space: pre;
}
.channel-markdown :deep(pre code) {
    padding: 0;
    border-radius: 0;
    background: transparent;
}
.channel-markdown :deep(.channel-code) {
    margin: 0.75em 0;
    border-radius: 6px;
    background: var(--color-card-2);
    overflow: hidden;
}
.channel-markdown :deep(.channel-code pre) {
    margin: 0;
}
.channel-markdown :deep(.channel-code-toolbar) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 30px;
    padding: 0.2em 1em;
    color: var(--color-font-2);
    font-size: 0.85em;
}
.channel-markdown :deep(.channel-code-copy) {
    padding: 0.25em 0.5em;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
}
.channel-markdown :deep(.channel-code-copy:hover) {
    color: var(--color-font);
}
.channel-markdown :deep(.channel-code-copy:focus-visible) {
    outline: 1px solid currentColor;
}
.channel-markdown :deep(blockquote) {
    margin: 0.75em 0;
    padding: 0.1em 0.8em;
    border-inline-start: 3px solid var(--color-font-2);
    color: var(--color-font-2);
}
.channel-markdown :deep(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    margin: 0.75em 0;
    border-collapse: collapse;
}
.channel-markdown :deep(th),
.channel-markdown :deep(td) {
    padding: 0.4em 0.75em;
    border: 1px solid var(--color-font-2);
    text-align: start;
}
.channel-markdown :deep(img) {
    max-width: 100%;
    height: auto;
    max-height: 60vh;
    object-fit: contain;
    border-radius: 6px;
    cursor: zoom-in;
}
.channel-markdown :deep(hr) {
    margin: 1em 0;
    border: 0;
    border-top: 1px solid var(--color-font-2);
}
</style>
