// OneBot actions acknowledge server-owned state; notices carry the same snapshot. AGPL-3.0-only.
import { Connector } from './connect'
import { getOneBotResponseError } from './utils/fileTransferUtil'
import { useAuthStore } from '@renderer/state/auth'
import { useChatStore } from '@renderer/state/chat'

export async function callMessageAction(action: string, params: Record<string, unknown>) {
    const response = await Connector.callRawApi(action, params)
    const error = getOneBotResponseError(response)
    if (error) throw new Error(error)
    return response
}

export function applyMessageAnnotations(snapshot: Record<string, any>) {
    const chat = useChatStore()
    if (snapshot.group_id !== undefined && Number(snapshot.group_id) !== chat.chatInfo.show.id) return
    const message = chat.messageList.find((item) => String(item.message_id) === String(snapshot.message_id))
    if (!message) return
    if (snapshot.emoji_like !== undefined) message.emoji_like = snapshot.emoji_like
    if (snapshot.emojis !== undefined) message.emojis = snapshot.emojis
    if (snapshot.is_essence !== undefined) message.is_essence = snapshot.is_essence
}

export async function toggleMessageReaction(message: Record<string, any>, emojiId: number) {
    const auth = useAuthStore()
    const action = auth.jsonMap.send_respond?.name
    if (!action) return
    const enabled = !message.emojis?.[emojiId]?.some((id: number) => Number(id) === Number(auth.loginInfo.uin))
    const response = await callMessageAction(action, {
        group_id: useChatStore().chatInfo.show.id,
        message_id: message.message_id,
        emoji_id: String(emojiId),
        is_set: enabled,
    })
    if (response.data?.message_id !== undefined) applyMessageAnnotations(response.data)
}
