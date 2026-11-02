// Shared host directory client. AGPL-3.0-only.
import { shallowRef } from 'vue'
import { AgentDirectoryCommandSchema, AgentDirectoryHttpPath, AgentDirectorySnapshotSchema, type AgentDirectoryCommand, type AgentDirectorySnapshot } from './agentDirectoryContract.generated'
import { seneraMutationHeaders } from './seneraContext'

export const seneraDirectory = shallowRef<AgentDirectorySnapshot>()
function endpoint() {
    const url = new URL(AgentDirectoryHttpPath, window.location.origin)
    const workspaceId = document.querySelector<HTMLMetaElement>('meta[name="senera-workspace-id"]')?.content
    if (!workspaceId) throw new Error('当前页面没有 Senera 工作区上下文')
    url.searchParams.set('workspaceId', workspaceId)
    return url
}
export function adoptSeneraDirectory(data: unknown) {
    const snapshot = AgentDirectorySnapshotSchema.parse(data)
    if (!seneraDirectory.value || snapshot.revision >= seneraDirectory.value.revision) seneraDirectory.value = snapshot
    return snapshot
}
async function read(response: Response) {
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : `Agent 设置失败 (${response.status})`)
    return adoptSeneraDirectory(data)
}
export async function refreshSeneraDirectory() {
    return read(await fetch(endpoint(), { credentials: 'same-origin', cache: 'no-store' }))
}
export async function updateSeneraDirectory(command: AgentDirectoryCommand) {
    return read(await fetch(endpoint(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...await seneraMutationHeaders() }, body: JSON.stringify(AgentDirectoryCommandSchema.parse(command)) }))
}
