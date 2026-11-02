// Store navigation only; messages and identities remain owned by the workspace. AGPL-3.0-only.
import { watch } from 'vue'
import { login } from '../function/connect'
import { useAuthStore } from '../state/auth'
import type { BaseChatInfoElem } from '../function/elements/information'
import { seneraDirectory } from './seneraDirectory'
import { seneraClientRoot } from './seneraContext'
import { conversationAvatar } from './seneraIdentity'

interface ClientPosition {
    page: string
    chat?: Pick<BaseChatInfoElem, 'id' | 'type'>
}

export function useSeneraNavigation(
    selection: () => ClientPosition,
    restore: (page: string, chat?: BaseChatInfoElem) => void,
) {
    const root = seneraClientRoot()
    if (!root) return
    const auth = useAuthStore()
    let restoredAccount: string | undefined
    const key = () => `senera-client-navigation:${root}:${auth.loginInfo.uin}`
    const save = (position: ClientPosition) => {
        if (!login.status || restoredAccount !== String(auth.loginInfo.uin)) return
        if (!['Messages', 'Friends', 'Options'].includes(position.page)) return
        localStorage.setItem(key(), JSON.stringify(position))
    }
    watch([() => login.status, () => auth.loginInfo.uin, seneraDirectory], () => {
        const directory = seneraDirectory.value
        const account = String(auth.loginInfo.uin ?? '')
        if (!login.status || !account || !directory || restoredAccount === account) return
        const saved = localStorage.getItem(key())
        if (saved) {
            const position: ClientPosition = JSON.parse(saved)
            if (['Messages', 'Friends', 'Options'].includes(position.page)) {
                const group = position.chat?.type === 'group' && directory.groups.find(item => item.id === position.chat?.id)
                const agent = position.chat?.type === 'user' && directory.agents.find(item => item.qqUserId === position.chat?.id)
                const target = group || agent
                const chat = target && position.chat ? {
                    ...position.chat,
                    name: target.name,
                    avatar: conversationAvatar(position.chat.type, position.chat.id),
                } : undefined
                restore(position.page, chat)
                if (position.chat && !target) localStorage.removeItem(key())
            }
        }
        restoredAccount = account
        // The user may have opened a chat while the directory was still loading.
        if (!saved) save(selection())
    }, { flush: 'post', immediate: true })
    watch(selection, save, { flush: 'sync' })
}
