// Appearance is client state, independent of model prompts and OneBot message content. AGPL-3.0-only.
import { computed, watchEffect, type CSSProperties } from 'vue'
import { useSettingsStore } from '@renderer/state/settings'
import { toBackgroundImageStyle, hydrateBackgroundImage } from '@renderer/function/utils/backgroundUtil'
import { bubbleStyles, backgroundStyles } from './appearanceCatalog'

export function bubbleTokens(id: string, dark: boolean): CSSProperties {
    const bubble = bubbleStyles.find((item) => item.id === id)
    if (!bubble) return {}
    return {
        '--qq-host_bubble_bg_css_value': dark ? bubble.darkFill : bubble.fill,
        '--on_bubble_host_text': dark ? bubble.darkText : bubble.text,
        '--client-bubble-radius': bubble.radius,
        '--client-bubble-border': bubble.border,
    }
}

export function useClientAppearance() {
    const settings = useSettingsStore()
    const tokens = computed(() => bubbleTokens(settings.sysConfig.bubble_style, settings.darkMode))
    function background(scope: 'chat' | 'profile'): CSSProperties {
        const custom = settings.sysConfig[`${scope}_background`]
        const preset = backgroundStyles.find((item) => item.id === settings.sysConfig[`${scope}_wallpaper`])
        if (custom)
            return {
                backgroundImage: toBackgroundImageStyle(custom),
                backgroundSize: settings.sysConfig.chat_background_fit,
                backgroundPosition: settings.sysConfig.chat_background_align,
            }
        return preset ? { background: settings.darkMode ? preset.darkFill : preset.fill } : {}
    }
    return { tokens, background }
}

export function useClientAppearanceAssets() {
    const settings = useSettingsStore()
    watchEffect(() => {
        for (const key of ['chat_background', 'profile_background']) {
            const path = settings.sysConfig[key]
            if (path)
                void hydrateBackgroundImage(path).catch((reason: unknown) =>
                    console.error('无法读取本地背景图片', reason),
                )
        }
    })
}
