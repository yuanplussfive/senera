// Senera channel Markdown rendering. AGPL-3.0-only.
import MarkdownIt from 'markdown-it'
import xss, { getDefaultWhiteList } from 'xss'
import { parseResourceId, parseWorkspaceResourceLocator, resolveResourceContentUrl } from '@senera/resource-links'

interface MarkdownEnvironment {
    resourceBaseUrl?: string
}

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true })
const validateLink = markdown.validateLink
markdown.validateLink = (source) =>
    Boolean(parseWorkspaceResourceLocator(source) || parseResourceId(source)) || validateLink(source)
markdown.renderer.rules.link_open = (tokens, index, options, environment: MarkdownEnvironment, renderer) => {
    const token = tokens[index]
    const href = token.attrGet('href')
    if (href && environment.resourceBaseUrl) {
        const resourceUrl = resolveResourceContentUrl(environment.resourceBaseUrl, href)
        if (resourceUrl) {
            token.attrSet('href', resourceUrl)
            token.attrSet('data-resource-link', 'true')
        }
    }
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
    return renderer.renderToken(tokens, index, options)
}
const renderImage = markdown.renderer.rules.image!
markdown.renderer.rules.image = (tokens, index, options, environment: MarkdownEnvironment, renderer) => {
    const token = tokens[index]
    const source = token.attrGet('src')
    if (source && environment.resourceBaseUrl) {
        const resourceUrl = resolveResourceContentUrl(environment.resourceBaseUrl, source)
        if (resourceUrl) token.attrSet('src', resourceUrl)
    }
    token.attrSet('loading', 'lazy')
    token.attrSet('decoding', 'async')
    return renderImage(tokens, index, options, environment, renderer)
}
const renderFence = markdown.renderer.rules.fence!
markdown.renderer.rules.fence = (tokens, index, options, environment, renderer) => {
    const language = markdown.utils.escapeHtml(tokens[index].info.trim().split(/\s+/)[0])
    return (
        `<div class="channel-code"><div class="channel-code-toolbar"><span>${language}</span>` +
        '<button type="button" class="channel-code-copy" aria-label="复制代码">复制</button></div>' +
        renderFence(tokens, index, options, environment, renderer) +
        '</div>'
    )
}
const sanitizeOptions = {
    whiteList: {
        ...getDefaultWhiteList(),
        code: ['class'],
        th: ['align'],
        td: ['align'],
        div: ['class'],
        button: ['type', 'class', 'aria-label'],
        a: ['href', 'title', 'target', 'rel', 'data-resource-link'],
        img: ['src', 'alt', 'title', 'loading', 'decoding'],
    },
}

export function renderChannelMarkdown(source: string, resourceBaseUrl?: string): string {
    return xss(markdown.render(source, { resourceBaseUrl }), sanitizeOptions)
}
