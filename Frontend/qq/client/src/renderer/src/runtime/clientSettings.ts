// Client preferences describe real rendering and composer behavior. AGPL-3.0-only.
export type ClientSetting = {
    key: string
    label: string
    description?: string
} & ({ type: 'switch'; inverse?: boolean } | { type: 'select'; options: readonly { value: string; label: string }[] })

export interface ClientSettingSection {
    id: string
    title: string
    settings: readonly ClientSetting[]
}

export const clientSettings: Record<'general' | 'notifications', readonly ClientSettingSection[]> = {
    general: [
        {
            id: 'composer',
            title: '聊天',
            settings: [
                {
                    key: 'send_key',
                    label: '发送快捷键',
                    description: '其余 Enter 组合键用于换行。',
                    type: 'select',
                    options: [
                        { value: 'none', label: 'Enter' },
                        { value: 'ctrl', label: 'Ctrl + Enter' },
                        { value: 'shift', label: 'Shift + Enter' },
                        { value: 'alt', label: 'Alt + Enter' },
                        { value: 'meta', label: '⌘ + Enter' },
                    ],
                },
                {
                    key: 'quick_send',
                    label: '输入框快捷操作',
                    type: 'select',
                    options: [
                        { value: 'default', label: '展开工具' },
                        { value: 'img', label: '发送图片' },
                        { value: 'file', label: '发送文件' },
                        { value: 'face', label: '打开表情' },
                    ],
                },
                {
                    key: 'close_respond',
                    label: '表情回应',
                    description: '在消息下方显示表情回应。',
                    type: 'switch',
                    inverse: true,
                },
                {
                    key: 'opt_fast_animation',
                    label: '减少界面动画',
                    description: '减少切换和展开时的动态效果。',
                    type: 'switch',
                },
            ],
        },
        {
            id: 'conversations',
            title: '会话列表',
            settings: [
                {
                    key: 'session_display_mode',
                    label: '显示会话',
                    type: 'select',
                    options: [
                        { value: 'recent', label: '最近聊天' },
                        { value: 'all', label: '全部联系人与群聊' },
                    ],
                },
                {
                    key: 'bubble_sort_user',
                    label: '收起不活跃的群聊',
                    description: '没有未读或重要消息的群聊归入群助手。',
                    type: 'switch',
                },
            ],
        },
        {
            id: 'music',
            title: '音乐播放',
            settings: [
                {
                    key: 'glabal_lyric',
                    label: '显示歌词横幅',
                    description: '在界面顶部显示当前播放音乐的歌词。',
                    type: 'switch',
                },
                {
                    key: 'original_lyrics',
                    label: '仅显示原文歌词',
                    description: '关闭后同时显示可用的翻译歌词，重新播放后生效。',
                    type: 'switch',
                },
            ],
        },
        {
            id: 'media',
            title: '图片与表情',
            settings: [
                {
                    key: 'opt_no_auto_load_image',
                    label: '自动加载图片',
                    description: '关闭后点击图片占位再加载，减少流量和内存占用。',
                    type: 'switch',
                    inverse: true,
                },
                { key: 'use_super_face', label: '播放超级表情', type: 'switch' },
                {
                    key: 'send_face',
                    label: '点击表情直接发送',
                    description: '关闭后先插入输入框，可继续编辑。',
                    type: 'switch',
                },
                {
                    key: 'record_recent_emoji',
                    label: '常用表情记录',
                    type: 'select',
                    options: [
                        { value: 'none', label: '不记录' },
                        { value: 'order', label: '按最近使用' },
                        { value: '100times', label: '按最近 100 次频率' },
                        { value: '500times', label: '按最近 500 次频率' },
                    ],
                },
            ],
        },
    ],
    notifications: [
        {
            id: 'notifications',
            title: '消息提醒',
            settings: [
                {
                    key: 'close_notice',
                    label: '消息通知',
                    description: '仅控制提醒，不影响接收消息和 Agent 执行。',
                    type: 'switch',
                    inverse: true,
                },
                {
                    key: 'group_notice_type',
                    label: '群消息通知方式',
                    description: '@我、@全体和特别关心的消息仍会提醒。',
                    type: 'select',
                    options: [
                        { value: 'none', label: '仅重要消息' },
                        { value: 'inner', label: '应用内通知' },
                        { value: 'all', label: '应用内与系统通知' },
                    ],
                },
                { key: 'use_favicon_notice', label: '标签页未读提示', type: 'switch' },
            ],
        },
    ],
}

export function filterClientSettings(
    page: keyof typeof clientSettings,
    query: string,
): readonly ClientSettingSection[] {
    const search = query.trim().toLocaleLowerCase()
    if (!search) return clientSettings[page]
    return clientSettings[page]
        .map((section) => ({
            ...section,
            settings: section.title.toLocaleLowerCase().includes(search)
                ? section.settings
                : section.settings.filter((item) =>
                      `${item.label} ${item.description ?? ''}`.toLocaleLowerCase().includes(search),
                  ),
        }))
        .filter((section) => section.settings.length > 0)
}
