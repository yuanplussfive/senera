// Profile and Agent directory are host-owned; QQ IDs identify participants, not avatar providers. AGPL-3.0-only.
import { shallowRef } from 'vue'
import {
    AgentUserProfileSchema,
    AgentResourceHttpRoutes,
    type AgentUserProfile,
} from './agentDirectoryContract.generated'
import { seneraClientRoot } from './seneraContext'
import { seneraDirectory } from './seneraDirectory'
import { useAuthStore } from '@renderer/state/auth'
import assistantAvatar from '@renderer/assets/senera.generated.svg'

export const seneraProfile = shallowRef<AgentUserProfile>()
const svg = (body: string) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#e8edf3"/>${body}</svg>`)}`
const personAvatar = svg(
    '<circle cx="32" cy="24" r="11" fill="#7d8c9e"/><path d="M12 57c0-23 40-23 40 0" fill="#7d8c9e"/>',
)
const groupAvatar = svg(
    '<circle cx="24" cy="25" r="9" fill="#7d8c9e"/><circle cx="44" cy="27" r="7" fill="#a6b1c0"/><path d="M6 54c0-22 36-22 36 0" fill="#7d8c9e"/><path d="M40 39c12-2 19 4 19 15H45" fill="#a6b1c0"/>',
)

export function adoptSeneraProfile(value: unknown) {
    const profile = AgentUserProfileSchema.parse(value)
    seneraProfile.value = profile
    useAuthStore().loginInfo.nickname = profile.name
}

function resourceUrl(path: string) {
    const url = new URL(AgentResourceHttpRoutes.WorkspaceContent, window.location.origin)
    url.searchParams.set('path', path)
    const workspace = document.querySelector<HTMLMetaElement>('meta[name="senera-workspace-id"]')?.content
    if (!workspace) throw new Error('当前页面没有 Senera 工作区上下文')
    url.searchParams.set('workspaceId', workspace)
    return url.href
}

export function userAvatar(id: string | number | null | undefined): string {
    if (!seneraClientRoot()) return `https://q1.qlogo.cn/g?b=qq&s=0&nk=${id}`
    const directory = seneraDirectory.value
    if (String(directory?.operatorId) === String(id) || String(useAuthStore().loginInfo.uin) === String(id)) {
        const profile = seneraProfile.value
        return profile?.avatarPath ? resourceUrl(profile.avatarPath) : personAvatar
    }
    const agent = directory?.agents.find((entry) => String(entry.qqUserId) === String(id))
    return agent?.avatarPath ? resourceUrl(agent.avatarPath) : assistantAvatar
}

export function conversationAvatar(type: string, id: string | number): string {
    if (type !== 'group') return userAvatar(id)
    return seneraClientRoot() ? groupAvatar : `https://p.qlogo.cn/gh/${id}/${id}/0`
}
