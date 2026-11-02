// Host context and authentication are independent of chat rendering. AGPL-3.0-only.
import { qqAuthentication } from '../../../../../authentication'
export function seneraClientRoot() {
    return document.querySelector<HTMLMetaElement>('meta[name="senera-client-root"]')?.content
}

export function seneraResourceBaseUrl() {
    const workspaceId = document.querySelector<HTMLMetaElement>('meta[name="senera-workspace-id"]')?.content
    if (!workspaceId) return undefined
    const url = new URL(window.location.origin)
    url.searchParams.set('workspaceId', workspaceId)
    return url.toString()
}

export function seneraConsoleUrl(section?: string) {
    const path = document.querySelector<HTMLMetaElement>('meta[name="senera-console-path"]')?.content
    if (!path) throw new Error('当前页面没有主控台导航上下文')
    const url = new URL(path, window.location.origin)
    if (url.origin !== window.location.origin) throw new Error('主控台必须与渠道使用同一服务')
    const workspaceId = document.querySelector<HTMLMetaElement>('meta[name="senera-workspace-id"]')?.content
    if (workspaceId) url.searchParams.set('workspaceId', workspaceId)
    if (section) url.searchParams.set('settings', section)
    return url.href
}

export function seneraClientUrl(resource: string, target: { type: string; id: string | number }) {
    const root = seneraClientRoot()
    if (!root) throw new Error('当前页面没有 Senera 渠道上下文')
    const url = new URL(`${root}${resource}`, window.location.origin)
    url.searchParams.set('chatType', target.type === 'group' ? 'group' : 'direct')
    url.searchParams.set('chatId', String(target.id))
    return url
}

export const seneraMutationHeaders = qqAuthentication.mutationHeaders
