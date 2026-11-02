// Senera channel integration, AGPL-3.0-only.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { BaseChatInfoElem } from '@renderer/function/elements/information'
import { login } from '@renderer/function/connect'
import { seneraMutationHeaders, refreshSeneraTimeline } from './seneraClient'
import { seneraDirectory } from './seneraDirectory'
import { Connector } from '@renderer/function/connect'
import { useChatStore } from '@renderer/state/chat'
import { seneraHostConnected as connected, subscribeSeneraHost } from './seneraHost'
import { EventKinds, RunActivitySpecs, type RunActivity } from '../../../../../../src/api/generatedEventCatalog'
import { activeRunActivityLabel } from '../../../../../../src/features/workflow/runActivityLabels'

interface Conversation {
    chatType: 'direct' | 'group'
    chatId: string
    sessionId: string | null
    sessionIds: string[]
    epoch: number
    running: boolean
}

const terminalEvents: ReadonlySet<string> = new Set([EventKinds.RunCompleted, EventKinds.RunCancelled, EventKinds.RunFailed])

export function useSeneraConversation(
    selectedChat: () => BaseChatInfoElem,
    resetHistory: () => void,
    reloadHistory: () => void,
) {
    const root = document.querySelector<HTMLMetaElement>('meta[name="senera-client-root"]')?.content
    const workspaceId = document.querySelector<HTMLMetaElement>('meta[name="senera-workspace-id"]')?.content
    const hosted = Boolean(root && workspaceId)
    const conversation = ref<Conversation>()
    const busy = ref(false)
    const error = ref('')
    const activities = ref(new Map<string, RunActivity>())
    const activity = computed(() => {
        const current = conversation.value
        if (!current) return ''
        for (const sessionId of current.sessionIds) {
            const active = activities.value.get(sessionId)
            if (active) return activeRunActivityLabel(active)
        }
        return current.running ? activeRunActivityLabel('running_agent_turn') : ''
    })
    let disposed = false
    let revision = 0
    let lastReset = ''
    let lookup: AbortController | undefined

    const selection = computed(() => {
        const chat = selectedChat()
        if (!hosted || !chat.id || !['user', 'group'].includes(chat.type)) return undefined
        return { chatType: chat.type === 'group' ? ('group' as const) : ('direct' as const), chatId: String(chat.id) }
    })

    function isSelected(target: Pick<Conversation, 'chatType' | 'chatId'>) {
        return selection.value?.chatType === target.chatType && selection.value?.chatId === target.chatId
    }

    function endpoint(target: Pick<Conversation, 'chatType' | 'chatId'>, epoch?: number) {
        const url = new URL(`${root}conversation`, window.location.origin)
        url.searchParams.set('chatType', target.chatType)
        url.searchParams.set('chatId', target.chatId)
        if (epoch !== undefined) url.searchParams.set('epoch', String(epoch))
        return url
    }

    async function readConversation(response: Response): Promise<Conversation> {
        const data = await response.json()
        if (!response.ok)
            throw new Error(typeof data.message === 'string' ? data.message : `会话操作失败 (${response.status})`)
        if (
            !data ||
            !['direct', 'group'].includes(data.chatType) ||
            typeof data.chatId !== 'string' ||
            !(data.sessionId === null || typeof data.sessionId === 'string') ||
            !Array.isArray(data.sessionIds) ||
            !data.sessionIds.every((id: unknown) => typeof id === 'string') ||
            !Number.isSafeInteger(data.epoch) ||
            data.epoch < 0 ||
            typeof data.running !== 'boolean'
        ) {
            throw new Error('Senera 会话响应不符合协议')
        }
        return data
    }

    async function refresh(reloadHistory = false) {
        const target = selection.value
        const generation = ++revision
        lookup?.abort()
        lookup = new AbortController()
        if (!target || !login.status) return
        try {
            const current = await readConversation(
                await fetch(endpoint(target), {
                    credentials: 'same-origin',
                    cache: 'no-store',
                    signal: lookup.signal,
                }),
            )
            if (disposed || generation !== revision || !isSelected(target)) return
            conversation.value = current
            error.value = ''
            if (reloadHistory) reload()
        } catch (reason) {
            if (disposed || generation !== revision) return
            error.value = reason instanceof Error ? reason.message : String(reason)
        }
    }

    function reload() {
        reloadHistory()
    }

    function applyReset(target: Conversation) {
        if (!isSelected(target)) return
        const token = `${target.chatType}:${target.chatId}:${target.sessionId ?? target.epoch}`
        if (lastReset === token) return
        lastReset = token
        resetHistory()
    }

    function receive(frame: { kind: string; data?: any; sessionId?: string }) {
        if (!frame || typeof frame.kind !== 'string') return
        if (frame.kind === 'senera.connected') {
            activities.value.clear()
            void refresh(true)
            return
        }
        if (frame.kind === 'agents.snapshot') {
            try {
                const snapshot = seneraDirectory.value!
                const chat = useChatStore().chatInfo.show
                const group = snapshot.groups.find((item) => String(item.id) === String(chat.id))
                const agent = snapshot.agents.find((item) => String(item.qqUserId) === String(chat.id))
                if (chat.type === 'group' && group) {
                    chat.name = group.name
                    Connector.send('get_group_member_list', { group_id: group.id }, 'getGroupMemberList')
                } else if (agent) chat.name = agent.name
                void refresh()
                refreshSeneraTimeline()
            } catch (reason) {
                error.value = reason instanceof Error ? reason.message : String(reason)
            }
            return
        }
        const channel = frame.data?.channel ?? frame.data?.metadata?.channel
        const current = conversation.value
        const matches =
            current &&
            ((frame.sessionId !== undefined && current.sessionIds.includes(frame.sessionId)) ||
                (channel?.platform === 'onebot11' &&
                    channel.chatType === current.chatType &&
                    channel.chatId === current.chatId))
        if (!matches) return
        if (frame.kind === EventKinds.RunActivityChanged && frame.sessionId) {
            const { activity, state } = frame.data ?? {}
            if (typeof activity === 'string' && Object.hasOwn(RunActivitySpecs, activity)) {
                if (state === 'started') activities.value.set(frame.sessionId, activity as RunActivity)
                else if (activities.value.get(frame.sessionId) === activity) activities.value.delete(frame.sessionId)
            }
            return
        }
        if (frame.kind === EventKinds.RunStarted) current.running = true
        if (terminalEvents.has(frame.kind) && frame.sessionId)
            activities.value.delete(frame.sessionId)
        if (frame.kind === 'session.closed' || frame.kind === 'session.truncated') {
            if (frame.kind === 'session.truncated') lastReset = ''
            applyReset(current)
            void refresh()
        } else if (
            frame.kind === 'session.created' ||
            frame.kind === 'run.started' ||
            frame.kind === 'run.completed' ||
            frame.kind === 'run.cancelled' ||
            frame.kind === 'run.failed'
        ) {
            void refresh()
            refreshSeneraTimeline()
        }
    }

    const unsubscribe = subscribeSeneraHost(receive)

    async function clear(target: Conversation) {
        if (busy.value) return
        busy.value = true
        try {
            // Use the host's existing login and CSRF boundary, including deployments
            // with authentication enabled. Gateway credentials never enter this client.
            const headers = await seneraMutationHeaders()
            const result = await readConversation(
                await fetch(endpoint(target, target.epoch), {
                    method: 'DELETE',
                    credentials: 'same-origin',
                    headers,
                }),
            )
            applyReset(target)
            if (isSelected(target)) conversation.value = result
        } finally {
            busy.value = false
            void refresh()
        }
    }

    watch(
        () => [selection.value?.chatType, selection.value?.chatId, login.status],
        () => {
            conversation.value = undefined
            activities.value.clear()
            lastReset = ''
            void refresh()
        },
        { immediate: true, flush: 'sync' },
    )

    function resume() {
        if (document.visibilityState === 'visible') void refresh(true)
    }
    document.addEventListener('visibilitychange', resume)
    onBeforeUnmount(() => {
        disposed = true
        revision++
        lookup?.abort()
        unsubscribe()
        document.removeEventListener('visibilitychange', resume)
    })

    return {
        hosted,
        conversation,
        busy,
        error,
        activity,
        clear,
        available: computed(() => connected.value && Boolean(conversation.value) && !busy.value && !error.value),
    }
}
