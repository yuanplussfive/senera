// Host-owned channel APIs. Gateway tokens remain server-side. AGPL-3.0-only.
import type { HistoryRequest } from '../function/utils/historyRequest'
import { historyRequestTracker } from '../function/utils/historyRequest'
import { useChatStore } from '../state/chat'
import { useUIStore } from '../state/ui'
import { useAuthStore } from '../state/auth'
import { useContactStore } from '../state/contact'
import { resolveIncomingSession } from '../function/utils/sessionUtil'
import { PopInfo, PopType } from '../function/base'
import { nextTick } from 'vue'
import { z } from 'zod'

import { seneraClientRoot, seneraClientUrl, seneraMutationHeaders } from './seneraContext'
export { seneraClientRoot, seneraClientUrl, seneraMutationHeaders } from './seneraContext'

export async function deleteSeneraTask(target: { type: string; id: string | number }, messageId: string | number) {
    const url = seneraClientUrl('task', target)
    url.searchParams.set('messageId', String(messageId))
    const response = await fetch(url, { method: 'DELETE', credentials: 'same-origin', headers: await seneraMutationHeaders() })
    if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message ?? `删除任务失败 (${response.status})`)
    }
}

const TimelinePage = z.object({
    entries: z.array(z.object({
        sequence: z.number().int().positive(),
        key: z.string().min(1),
        payload: z.record(z.string(), z.unknown()),
        task: z.object({ sessionId: z.string().min(1), requestId: z.string().min(1) }).optional(),
    })),
    before: z.number().int().positive().nullable(),
    sync: z.object({
        cursor: z.object({ revision: z.number().int().nonnegative(), sequence: z.number().int().nonnegative() }),
        hasMore: z.boolean(), reset: z.boolean(),
    }),
})

const ConversationList = z.object({
    conversations: z.array(z.object({
        chatType: z.enum(['direct', 'group']),
        chatId: z.string().regex(/^[1-9]\d*$/),
        name: z.string(),
        latest: TimelinePage.shape.entries.element,
    })),
})
let sessionsRequest: AbortController | undefined

/** Rebuild the list from workspace history without replaying notifications or unread counters. */
export async function refreshSeneraSessions(): Promise<void> {
    if (!seneraClientRoot()) return
    sessionsRequest?.abort()
    const controller = new AbortController()
    sessionsRequest = controller
    const account = useAuthStore().loginInfo.uin
    const contacts = useContactStore()
    const active = () => !controller.signal.aborted && useAuthStore().loginInfo.uin === account
    try {
        const url = new URL(`${seneraClientRoot()}conversations`, window.location.origin)
        const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.message ?? `恢复会话失败 (${response.status})`)
        const { conversations } = ConversationList.parse(body)
        const [{ normalizeMessagesForPreview, formatMessageData }, { updateBaseOnMsgList }, { getViewTime }] = await Promise.all([
            import('../function/msg'), import('../function/utils/msgUtil'), import('../function/utils/systemUtil'),
        ])
        const previews = await Promise.all(conversations.map(async summary => {
            const { payload } = summary.latest
            const isGroup = summary.chatType === 'group'
            const [message] = payload.post_type === 'message' ? await normalizeMessagesForPreview(payload) : []
            return { summary, preview: message ? formatMessageData(message, isGroup) : { time: getViewTime(Number(payload.time)) } }
        }))
        if (!active()) return
        for (const { summary, preview } of previews) {
            const id = Number(summary.chatId)
            const current = contacts.baseOnMsgList.get(id)
            // Live traffic received while fetching owns newer previews and unread state.
            if (current?.time && Number(current.time) >= Number(preview.time)) continue
            const isGroup = summary.chatType === 'group'
            const contact = current ?? resolveIncomingSession(contacts.userList, id, isGroup, summary.name)
            if (isGroup) contact.group_name = summary.name
            else contact.nickname = summary.name
            Object.assign(contact, preview)
            contacts.baseOnMsgList.set(id, contact)
        }
        updateBaseOnMsgList()
    } catch (reason) {
        if (active()) new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason))
    } finally {
        if (sessionsRequest === controller) sessionsRequest = undefined
    }
}

interface TimelineState {
    generation: number
    before?: number | null
    latest?: AbortController
    older?: AbortController
    refreshRequested: boolean
    cursor?: { revision: number; sequence: number }
}
let pageState: TimelineState | undefined

/** Messages and notices use one durable cursor; replay never invokes live-event handlers. */
export async function loadSeneraTimeline(request: HistoryRequest, older = false) {
    const chat = useChatStore()
    const ui = useUIStore()
    if (!historyRequestTracker.isActive(request.generation, chat.chatInfo.show)) return
    if (pageState?.generation !== request.generation) {
        pageState?.latest?.abort()
        pageState?.older?.abort()
        pageState = { generation: request.generation, refreshRequested: false }
    }
    const state = pageState
    const channel = older ? 'older' : 'latest'
    if (state[channel]) {
        if (!older) state.refreshRequested = true
        return
    }
    if (older && (state.before === null || state.before === undefined)) return
    const controller = new AbortController()
    state[channel] = controller
    const active = () => pageState === state && !controller.signal.aborted && historyRequestTracker.isActive(request.generation, chat.chatInfo.show)
    const url = seneraClientUrl('timeline', { type: request.type, id: request.id })
    if (older && state.before !== undefined && state.before !== null) {
        url.searchParams.set('before', String(state.before))
    } else if (!older && state.cursor) {
        url.searchParams.set('after', String(state.cursor.sequence))
        url.searchParams.set('revision', String(state.cursor.revision))
    }
    const loadingHistory = older || chat.messageList.length === 0
    if (loadingHistory) ui.nowGetHistory = true
    try {
        const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.message ?? `加载历史失败 (${response.status})`)
        const page = TimelinePage.parse(body)
        if (older && state.cursor && page.sync.cursor.revision !== state.cursor.revision) {
            void loadSeneraTimeline(request)
            return
        }
        if (!older && page.sync.hasMore && (!state.cursor || page.sync.reset || page.sync.cursor.sequence <= state.cursor.sequence))
            throw new Error('消息增量游标未推进，无法继续同步')
        const { normalizeMessagesForPreview, prepareChannelNotice } = await import('../function/msg')
        const entries = await Promise.all(page.entries.map(async entry => {
            const payload = entry.payload
            let node: any
            if (payload.post_type === 'notice') {
                node = prepareChannelNotice({ ...payload, historical: true })
                if (payload.originMsg) {
                    const [original] = await normalizeMessagesForPreview({ ...z.record(z.string(), z.unknown()).parse(payload.originMsg), post_type: 'message' })
                    if (original?.sender && String(original.sender.user_id) === String(useAuthStore().loginInfo.uin)) node.originMsg = original
                    else delete node.originMsg
                }
            } else {
                const [message] = await normalizeMessagesForPreview(payload)
                if (!message) throw new Error('OneBot 消息无法解析')
                node = message
            }
            return { ...node, timelineKey: entry.key, timelineSequence: entry.sequence, seneraTask: entry.task }
        }))
        if (!active()) return
        const merged = new Map<string, any>()
        for (const node of page.sync.reset ? [] : chat.messageList) {
            const key = node.timelineKey ?? (node.message_id !== undefined ? `message:${node.message_id}` : node.fake_message_id)
            if (key) merged.set(String(key), node)
        }
        for (const entry of entries) merged.set(entry.timelineKey, entry)
        const recalled = new Set(entries.filter(node => node.notice_type?.includes('recall')).map(node => String(node.message_id)))
        for (const id of recalled) merged.delete(`message:${id}`)
        const pan = document.getElementById('msgPan')
        const previousHeight = pan?.scrollHeight ?? 0
        const previousTop = pan?.scrollTop ?? 0
        const wasEmpty = chat.messageList.length === 0
        chat.messageList = [...merged.values()].sort((a, b) => {
            if (a.timelineSequence !== undefined && b.timelineSequence !== undefined) return a.timelineSequence - b.timelineSequence
            if (a.timelineSequence !== undefined) return -1
            if (b.timelineSequence !== undefined) return 1
            return Number(a.time ?? 0) - Number(b.time ?? 0)
        })
        if (older || state.before === undefined || page.sync.reset) state.before = page.before
        if (!older) {
            state.cursor = page.sync.cursor
            state.refreshRequested ||= page.sync.hasMore
        }
        ui.canLoadHistory = state.before !== null
        ui.loadHistoryFail = false
        ui.historyBeforeTime = undefined
        await nextTick()
        if (active() && pan && document.getElementById('msgPan') === pan) {
            const behavior = pan.style.scrollBehavior
            pan.style.scrollBehavior = 'auto'
            if (older) pan.scrollTop = previousTop + pan.scrollHeight - previousHeight
            else if (wasEmpty) pan.scrollTop = pan.scrollHeight
            pan.style.scrollBehavior = behavior
        }
    } catch (reason) {
        if (!active()) return
        ui.loadHistoryFail = true
        new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason))
    } finally {
        state[channel] = undefined
        if (active()) {
            if (loadingHistory) ui.nowGetHistory = Boolean(state.older)
            if (!older && state.refreshRequested) {
                state.refreshRequested = false
                void loadSeneraTimeline(request)
            }
        }
    }
}

export function refreshSeneraTimeline(): boolean {
    if (!seneraClientRoot()) return false
    const request = historyRequestTracker.current()
    if (request) void loadSeneraTimeline(request)
    return true
}
