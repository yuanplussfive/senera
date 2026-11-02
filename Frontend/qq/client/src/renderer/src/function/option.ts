/*
 * @FileDescription: 设置功能模块
 * @Author: Stapxs
 * @Date:
 *      2022/09/27
 *      2022/12/07
 * @Version:
 *      1.0 - 初始版本
 *      1.5 - 重构为 ts 版本，代码格式优化
 * @Description: 设置功能相关模块
 */

import app from '@renderer/main'
import languageConfig from '@renderer/assets/l10n/_l10nconfig.json'

import { i18n } from '@renderer/main'
import { Logger, LogType } from './base'
import { useSettingsStore } from '@renderer/state/settings'
import { useUIStore } from '@renderer/state/ui'
import { useChatStore } from '@renderer/state/chat'
import { BotMsgType, isBotMsgType } from './elements/information'
import {
    getPortableFileLang,
    getTrueLang,
} from '@renderer/function/utils/systemUtil'
import { applyCustomThemeColor } from '@renderer/function/utils/bcuiTheme'
import { applyBcuiTheme } from '@renderer/function/utils/bcuiTheme'
import { updateBaseOnMsgList } from './utils/msgUtil'
import { refreshFavicon } from './favicon'
import {
    readAgentQqClientPreferencesKey as optionStorageKey,
    parseAgentQqClientPreferences,
    serializeAgentQqClientPreferences,
} from '../../../../../../../Source/AgentSystem/Channels/Client/AgentQqClientPreferences'

let cacheConfigs: { [key: string]: any }

// 设置项的初始值，防止下拉菜单选项为空或者首次使用初始错误
export const optDefault: { [key: string]: any } = {
    // System
    address: '',
    top_info: {},
    notice_group: {},
    auto_connect: false,
    // View
    language: 'zh-CN',
    opt_dark: false,
    opt_auto_dark: true,
    theme_color: 0,
    chat_background: '',
    bubble_style: 'classic',
    chat_wallpaper: 'none',
    profile_wallpaper: 'cloud',
    profile_background: '',
    chat_background_blur: 0,
    chat_background_align: 'center',
    chat_background_fit: 'cover',
    opt_fast_animation: false,
    chat_more_blur: false,
    glass_effect: false,
    fs_adaptation: 0,
    opt_revolve: false,
    use_favicon_notice: true,
    use_super_face: true,
    opt_ind_message: false,
    opt_no_auto_load_image: false,
    // Function
    close_notice: false,
    bubble_sort_user: true,
    session_display_mode: 'recent' as 'recent' | 'all',
    close_respond: false,
    msg_taill: '',
    quick_send: 'default',
    group_notice_type: 'none',
    send_face: false,
    use_breakline: true,
    send_key: 'none',
    record_recent_emoji: '100times' as 'none' | 'order' | '100times' | '500times',
    glabal_lyric: true,
    original_lyrics: false,
    // Dev
    msg_type: BotMsgType.Array,
    log_level: 'err',
    debug_msg: false,
    custom_css: '',
}

// =============== 设置项事件 ===============

const configFunction: { [key: string]: (value: any) => void } = {
    language: setLanguage,
    opt_dark: setDarkMode,
    opt_auto_dark: setAutoDark,
    theme_color: changeTheme,
    msg_type: setMsgType,
    opt_revolve: viewRevolve,
    opt_fast_animation: updateFarstAnimation,
    bubble_sort_user: clearGroupAssist,
    session_display_mode: clearGroupAssist,
    use_favicon_notice: setFaviconNotice,
    custom_css: injectCustomCss,
    opt_ind_message: updateChatPan
}

function updateChatPan() {
    const uiStore = useUIStore()
    const chatStore = useChatStore()
    chatStore.chatInfo.show.id = 0
    uiStore.openSideBar = true
}


function setFaviconNotice(_: boolean) {
    refreshFavicon()
}

function injectCustomCss(value: string) {
    // 移除旧的自定义 CSS
    const oldStyle = document.getElementById('custom-css-inject')
    if (oldStyle) {
        document.head.removeChild(oldStyle)
    }

    // 如果有新的 CSS 内容，注入它
    if (value && value.trim() !== '') {
        const style = document.createElement('style')
        style.id = 'custom-css-inject'
        style.textContent = value
        document.head.appendChild(style)
        new Logger().add(LogType.UI, '已注入自定义 CSS')
    }
}

function clearGroupAssist() {
    updateBaseOnMsgList()
}

function updateFarstAnimation(value: boolean) {
    const existing = document.getElementById('disable-transitions')
    existing?.remove()
    if (!value) return
    const style = document.createElement('style')
    style.textContent = `*, *::before, *::after {
        transition-duration: 0s !important;
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
    }`
    style.id = 'disable-transitions'
    document.head.appendChild(style)
}

function viewRevolve(value: boolean) {
    const baseApp = document.getElementById('base-app')
    if (baseApp && value) {
        if (baseApp.classList.contains('no-touch')) {
            baseApp.classList.remove('no-touch')
            // 把这个选项设置为 false
            save('opt_revolve', false)
        } else {
            baseApp.classList.add('no-touch')
        }
    }
}

function setMsgType(value: unknown) {
    const type = Number(value)
    if (!isBotMsgType(type)) throw new Error('消息发送格式无效')
    useUIStore().msgType = type
}

/**
 * 加载语言文件并设置为当前的语言
 * @param name 语言文件名（不是实际语言代码）
 */
function setLanguage(name: string) {
    // 加载语言文件
    const lang = getPortableFileLang(name)
    i18n.global.setLocaleMessage(name, lang)
    app.config.globalProperties.$i18n.locale = name
    // 检查是否设置了备选语言
    let get = false
    for (let i = 0; i < languageConfig.length; i++) {
        if (
            languageConfig[i].value == name &&
            (languageConfig[i] as any).fallback
        ) {
            const fbname = (languageConfig[i] as any).fallback
            const fbLang = getPortableFileLang(fbname)
            i18n.global.setLocaleMessage(fbname, fbLang)
            get = true
            app.config.globalProperties.$i18n.fallbackLocale = fbname
            break
        }
    }
    if (!get) {
        app.config.globalProperties.$i18n.fallbackLocale = 'zh-CN'
    }
    // 刷新 html 语言标签
    const htmlBody = document.querySelector('html')
    if (htmlBody !== null) {
        htmlBody.setAttribute('lang', getTrueLang())
    }
}

/**
 * 设置暗黑模式
 * @param value 是否启用暗黑模式
 */
function setDarkMode(value = true) {
    if (value === true) {
        changeColorMode('dark')
    } else {
        changeColorMode('light')
    }
}

/**
 * 设置自动暗黑模式
 * @param value 是否启用自动暗黑模式
 */
function setAutoDark(value: boolean) {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const opt = document.getElementById('opt_view_dark')
    if (value == true) {
        // 刷新一次颜色模式
        if (media.matches) {
            setDarkMode()
        } else {
            setDarkMode(false)
        }
        // 创建颜色模式变化监听
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', (e) => {
                if (get('opt_auto_dark')) {
                    const prefersDarkMode = e.matches
                    new Logger().add(
                        LogType.UI,
                        '正在自动切换颜色模式为：' + prefersDarkMode,
                    )
                    if (prefersDarkMode) {
                        setDarkMode()
                    } else {
                        setDarkMode(false)
                    }
                    // 刷新主题色
                    runAS('opt_auto_win_color', get('opt_auto_win_color'))
                }
            })
        }
        // 将颜色模式设置项移除
        if (opt) opt.style.display = 'none'
    } else {
        if (opt) opt.style.display = 'flex'
        setDarkMode(Boolean(get('opt_dark')))
    }
}

/**
 * 修改颜色模式
 * @param mode 颜色模式
 */
export function changeColorMode(mode: string) {
    const settingsStore = useSettingsStore()
    if (!settingsStore.firstLoad) {
        // 启用颜色渐变动画
        document.body.style.transition =
            'background, color, background-color .3s'
    } else {
        settingsStore.firstLoad = false
    }
    applyBcuiTheme(mode === 'dark' ? 'dark' : 'light')
    // 如果主题色模式是自定，则刷新系统主题色
    getRaw('theme_color').then((themeColor) => {
        if(themeColor && Number(themeColor) > 10) {
            const colorUpdate = ('000000' + Number(themeColor).toString(16)).slice(-6)
            applyCustomThemeColor(colorUpdate)
        }
    })
    // 刷新页面主题色
    const meta = document.getElementsByName('theme-color')[0]
    if (meta) {
        (meta as HTMLMetaElement).content = getComputedStyle(
            document.documentElement,
        ).getPropertyValue('--color-main')
    }
    // 记录
    settingsStore.darkMode = mode === 'dark'
    // 刷新图标
    refreshFavicon()
}

/**
 * 设置主题色
 * @param id 主题色编号
 */
function changeTheme(id: number) {
    if(id < 10) {
        document.documentElement.style.setProperty(
            '--color-main',
            'var(--color-main-' + id + ')',
        )
        const meta = document.getElementsByName('theme-color')[0]
        if (meta) {
            (meta as HTMLMetaElement).content = getComputedStyle(
                document.documentElement,
            ).getPropertyValue('--color-main-' + id)
        }
    } else {
        const color = ('000000' + Number(id).toString(16)).slice(-6)
        applyCustomThemeColor(color)
    }
    // 避免 css 未加载完
    setTimeout(refreshFavicon, 10)
}

// =============== 设置基础功能 ===============

/**
 * 读取并序列化 localStorage 中的设置项
 * @returns 设置项集合
 */
function readStoredOptions(): Record<string, string> {
    return parseAgentQqClientPreferences(localStorage.getItem(optionStorageKey()))
}

export async function load(): Promise<{ [key: string]: any }> {
    return loadOptData(readStoredOptions())
}

function loadOptData(data: { [key: string]: any }) {
    const options: { [key: string]: any } = {}
    let optChanged = false
    Object.keys(data).forEach((key) => {
        if (!Object.hasOwn(optDefault, key)) {
            optChanged = true
            return
        }
        const value = data[key]
        if (value === 'true' || value === 'false') {
            options[key] = value === 'true'
        } else if (value === 'null') {
            options[key] = null
        } else if (typeof value == 'string') {
            try {
                options[key] = decodeURIComponent(value)
            } catch (e: unknown) {
                // 如果 decodeURIComponent 失败（比如 CSS 内容有特殊字符），直接使用原值
                options[key] = value
            }
            try {
                const result = JSON.parse(options[key])
                if (typeof result === 'object' && result !== null) {
                    options[key] = result
                }
            } catch (e: unknown) {
                // ignore
            }
        } else {
            options[key] = value
        }
        if (key === 'msg_type') {
            const type = Number(options[key])
            options[key] = isBotMsgType(type) ? type : optDefault.msg_type
            if (options[key] !== value) optChanged = true
        }
        // 执行设置项操作
        run(key, options[key])
    })
    // 初始化不存在的需要进行初始化的值
    Object.keys(optDefault).forEach((key) => {
        if (options[key] === undefined) {
            optChanged = true
            options[key] = optDefault[key]
        }
    })
    // 保存
    if (optChanged) {
        saveAll(options)
    }
    // 保存返回
    cacheConfigs = options
    return options
}

/**
 * 执行设置项对应的方法
 * @param name 设置项名称
 * @param value 设置项值
 */
export function run(name: string, value: any) {
    if (typeof configFunction[name] === 'function') configFunction[name](value)
}

/**
 * 获取设置项值
 * @param name 设置项名称
 * @returns 设置项值（如果没有则为 null）
 */
export function get(name: string): any {
    const value = cacheConfigs?.[name]
    if (value === undefined) return null
    if (typeof value !== 'string') return value
    try { return JSON.parse(value) } catch { return value }
}

/**
 * 获取原始设置项值
 * @param name 设置项名称
 * @returns 设置项值（如果没有则为 null）
 * @description <strong>注意：</strong>
 * 此方法获取原始设置项值，不会对值进行 T/F 转换、JSON 解析、URL 解码等操作；
 * 设置存储在 WebStorage 中，需要特别注意预防上述未转换导致的错误。
 */
export function getRaw(name: string) {
    return Promise.resolve(readStoredOptions()[name] ?? null)
}

/**
 * 保存设置项
 * @param name 设置项名称
 * @param value 设置项值
 */
export function save(name: string, value: any) {
    cacheConfigs[name] = value
    saveAll()
}
export function saveAll(config = {} as { [key: string]: any }) {
    if (Object.keys(config).length == 0) {
        Object.assign(config, cacheConfigs)
    }
    const encoded = Object.fromEntries(Object.entries(config).map(([key, value]) => [
        key, encodeURIComponent(typeof value === 'object' ? JSON.stringify(value) : value),
    ]))
    localStorage.setItem(optionStorageKey(), serializeAgentQqClientPreferences(encoded))


}

/**
 * 保存并触发设置项操作
 * @param name 设置项名称
 * @param value 设置项值
 */
export function runAS(name: string, value: any) {
    save(name, value)
    run(name, value)
}

/**
 * 通过 DOM 事件保存并触发设置项操作
 * @param event DOM 事件
 */
export function runASWEvent(event: Event) {
    const sender = event.target as HTMLElement
    if (sender != null) {
        const type = sender.nodeName
        const name = sender.getAttribute('name')
        let value = null as any
        switch (type) {
            case 'SELECT': {
                value = (sender as HTMLSelectElement).options[
                    (sender as HTMLSelectElement).selectedIndex
                ].value
                break
            }
            case 'INPUT': {
                switch ((sender as HTMLInputElement).type) {
                    case 'checkbox': {
                        value = (sender as HTMLInputElement).checked
                        break
                    }
                    case 'radio': {
                        value = sender.dataset.id
                        break
                    }
                    case 'color':
                    case 'range':
                    case 'number':
                    case 'text': {
                        value = (sender as HTMLInputElement).value
                        break
                    }
                }
                break
            }
        }
        if (name !== null) {
            runAS(name, value)
        }
    }
    // 有些设置项需要重启/刷新
    if (sender.dataset.reload == 'true') {
        const { $t } = app.config.globalProperties
        const html =
            '<span>' +
            $t('此操作将在重启应用后生效，现在就要重启吗？') +
            '</span>'

        const uiStore = useUIStore()
        const popInfo = {
            svg: 'trash-arrow-up',
            html: html,
            title: $t('重启应用'),
            button: [
                {
                    text: app.config.globalProperties.$t('确定'),
                    fun: () => {
                        location.reload()
                    },
                },
                {
                    text: app.config.globalProperties.$t('取消'),
                    master: true,
                    fun: () => {
                        uiStore.popBoxList.shift()
                    },
                },
            ],
        }
        uiStore.popBoxList.push(popInfo)
    }
}

/**
 * 删除设置项
 * @param name 设置项名称
 */
export function remove(name: string) {
    delete cacheConfigs[name]
    saveAll()
}

// ================ 工具方法 ================
export function checkDefault(name: string) {
    const settingsStore = useSettingsStore()
    return (settingsStore.sysConfig[name] == undefined ||
        settingsStore.sysConfig[name] == optDefault[name]) ? '' : 'changed'
}

export default {
    get,
    getRaw,
    load,
    save,
    run,
    runAS,
    runASWEvent,
    remove,
    checkDefault,
}
