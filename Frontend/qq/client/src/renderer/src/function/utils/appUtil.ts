import { seneraDirectory } from '@renderer/runtime/seneraDirectory'
import { wheelMask } from '../input'
import { canStartSwipe, DirectionalSwipe } from './directionalSwipe'
import { addTooltip, TooltipController } from '../tooltip'
import { VueCompData } from '../elements/vueComp'
import { loadSeneraTimeline } from '@renderer/runtime/seneraClient'
export { useEventListener, useKeyboard } from './useDomEvents'
import { downloadUrl, openExternalLink } from '@senera/resource-links'
import { PopInfo, PopType } from '../base'
import option from '@renderer/function/option'


import { Connector, login } from '@renderer/function/connect'
import { BaseChatInfoElem, MenuEventData } from '@renderer/function/elements/information'
import { useAuthStore } from '@renderer/state/auth'
import { useContactStore } from '@renderer/state/contact'
import { useChatStore } from '@renderer/state/chat'
import { useUIStore } from '@renderer/state/ui'
import {
    nextTick,
    Directive,
    WatchHandle,
    onMounted,
    onUnmounted,
    ref,
    watchEffect,
    watch,
    shallowReactive,
    ShallowRef,
    shallowRef,
    Component,
    DirectiveBinding,
    Ref,
} from 'vue'
import {
    createHistoryEcho,
    historyRequestTracker,
    isSameHistorySession,
    type HistoryRequest,
} from './historyRequest'


/**
 * 滚动到目标消息（不自动加载）
 * @param seqName DOM 名（chat-xx）
 */
export function scrollToMsg(seqName: string, showAnimation: boolean, showHighlight = true, centerInView = false): boolean {
    const msg = document.getElementById(seqName)
    if (msg) {
        const pan = document.getElementById('msgPan')
        if (pan !== null) {
            if (showAnimation === false) {
                pan.style.scrollBehavior = 'unset'
            } else {
                pan.style.scrollBehavior = 'smooth'
            }
            // A programmatic quote jump must not trigger scroll-at-zero paging.
            pan.scrollTop = centerInView? Math.max(1, msg.offsetTop - (pan.clientHeight - msg.offsetHeight) / 2): msg.offsetTop - msg.offsetHeight + 10
            pan.style.scrollBehavior = 'smooth'
            if (showHighlight) {
                msg.style.transition = 'background 1s'
                msg.style.background = 'rgba(0, 0, 0, 0.06)'
                setTimeout(() => {
                    msg.style.background = 'unset'
                    setTimeout(() => {
                        msg.style.transition = 'background .3s'
                    }, 1100)
                }, 3000)
            }
            return true
        }
    }
    return false
}

/**
 * 打开链接
 * @param url 链接
 * @param external 是否外部打开
 */
export function openLink(url: string) {
    void openExternalLink(url).catch(error => new PopInfo().add(PopType.ERR, error instanceof Error ? error.message : String(error)))
}

/**
 * 加载历史消息
 * @param info 聊天基本信息
 */
export async function loadHistory(info: BaseChatInfoElem) {
    const chatStore = useChatStore()
    const uiStore = useUIStore()
    const request = historyRequestTracker.begin(info)

    chatStore.messageList = []
    uiStore.nowGetHistory = false
    uiStore.canLoadHistory = true
    uiStore.loadHistoryFail = false
    uiStore.historyBeforeTime = undefined

    await loadSeneraTimeline(request)
}
export function loadHistoryMessage(
    id: number,
    type: string,
    count = 20,
    echo?: string,
    messageId: string | number = 0,
) {
    const authStore = useAuthStore()
    const chatStore = useChatStore()
    if (echo === undefined) {
        const request = historyRequestTracker.current()
        if (!request || !isSameHistorySession(request, { id, type }) ||
            !historyRequestTracker.isActive(request.generation, chatStore.chatInfo.show)) return false
        echo = createHistoryEcho('getChatHistoryFist', request)
    }
    let name: string
    const fullPage = authStore.jsonMap.message_list?.pagerType == 'full'
    if (authStore.jsonMap.message_list && type != 'group') {
        name = authStore.jsonMap.message_list.private_name
    } else {
        name = authStore.jsonMap.message_list.name
    }

    Connector.send(
        name ?? 'get_chat_history',
        {
            group_id: type == 'group' ? id : undefined,
            user_id: type != 'group' ? id : undefined,
            message_id: messageId,
            count: fullPage ? chatStore.messageList.length + count : count,
        },
        echo,
    )
    return true
}

/** Load an older page for the active chat, including alternate chat views. */
export function loadMoreHistoryMessages(
    request: HistoryRequest | undefined = historyRequestTracker.current(),
) {
    const chatStore = useChatStore()
    if (!request || !historyRequestTracker.isActive(
        request.generation,
        chatStore.chatInfo.show,
    )) return false

    void loadSeneraTimeline(request, true)
    return true
}

/**
 * 重新加载用户列表
 */
export function reloadUsers() {
    // 加载用户列表
    if (login.status) {
        const authStore = useAuthStore()
        const contactStore = useContactStore()
        contactStore.userList = []
        let friendName = 'get_friend_list'
        let groupName = 'get_group_list'
        if (authStore.jsonMap.user_list?.name) {
            friendName = authStore.jsonMap.user_list.name.split('|')[0]
            groupName = authStore.jsonMap.user_list.name.split('|')[1]
        } else if (
            authStore.jsonMap.friend_list?.name &&
            authStore.jsonMap.group_list?.name
        ) {
            friendName = authStore.jsonMap.friend_list.name
            groupName = authStore.jsonMap.group_list.name
        }
        Connector.send(friendName, {}, 'getFriendList')
        Connector.send(groupName, {}, 'getGroupList')
    }
}

/**
* 获取 Cookie
*/
export function reloadCookies(domain = 'qun.qq.com') {
    if (useAuthStore().jsonMap.get_cookies === null) return
    Connector.send(
        'get_cookies',
        { domain: domain },
        'getCookies_' + domain,
    )
}

/**
 * 通过用户和消息 ID 跳转到对应的消息
 * @param id
 * @param msgId
 */
export function jumpToChat(userId: string, msgId: string) {
    const chatStore = useChatStore()
    const contactStore = useContactStore()
    if (chatStore.chatInfo.show.id != Number(userId)) {
        const body = document.getElementById('user-' + userId)
        if (body === null) {
            // 从缓存列表里寻找这个 ID
            for (let i = 0; i < contactStore.userList.length; i++) {
                const item = contactStore.userList[i]
                const id =
                    item.user_id !== undefined ? item.user_id : item.group_id
                if (String(id) === userId) {
                    // 把它插入到显示列表的第一个
                    contactStore.showList?.unshift(item)
                    nextTick(() => {
                        const bodyNext = document.getElementById(
                            'user-' + userId,
                        )
                        if (bodyNext !== null) {
                            // 添加一个消息跳转标记
                            bodyNext.dataset.jump = msgId
                            // 然后点一下它触发聊天框切换
                            bodyNext.click()
                        }
                    })
                    break
                }
            }
        } else {
            body.click()
        }
    } else {
        // 当前聊天已经打开，是没有焦点触发的消息通知；直接滚动到消息。
        scrollToMsg(msgId, true)
    }
}

/**
 * 下载文件
 * @param url 文件链接
 * @param name 文件名
 * @param onprocess 下载进度回调
 * @param oncancel 下载取消回调
 * @returns 下载取消句柄
 */
export function downloadFile(
    url: string,
    name: string,
    onprocess: (event: ProgressEvent & { [key: string]: any }) => undefined,
    oncancel: (event: ProgressEvent & { [key: string]: any }) => undefined,
    oncomplete?: (mode: 'completed' | 'delegated') => void,
    onerror?: (error: Error) => void,
): { cancel: () => void } {
    const controller = new AbortController()
    void downloadUrl(url, name, {
        signal: controller.signal,
        onProgress: ({ loaded, total }) => onprocess(new ProgressEvent('progress', { loaded, total, lengthComputable: total !== undefined })),
    })
        .then(mode => oncomplete?.(mode))
        .catch((error) => {
            if (controller.signal.aborted) { oncancel(new ProgressEvent('abort')); return }
            const failure = error instanceof Error ? error : new Error(String(error))
            if (onerror) onerror(failure)
            else new PopInfo().add(PopType.ERR, failure.message)
        })
    return {
        cancel: () => controller.abort(),
    }

}

/**
* 切换群组通知状态
* @param group_id 群组 ID
* @param open 是否开启通知
*/
export function changeGroupNotice(group_id: number, open: boolean) {
    const authStore = useAuthStore()
    const noticeInfo = option.get('notice_group') ?? {}
    const list = noticeInfo[authStore.loginInfo.uin]
    if (open) {
        if (list) {
            list.push(group_id)
        } else {
            noticeInfo[authStore.loginInfo.uin] = [group_id]
        }
        option.save('notice_group', noticeInfo)
    } else {
        if (list) {
            const index = list.indexOf(group_id)
            if (index >= 0) {
                list.splice(index, 1)
            }
        }
        option.save('notice_group', noticeInfo)
    }
}

/**
 * 是否应该自动聚焦输入框
 * @returns
 */
export function shouldAutoFocus(): boolean {
    return !window.matchMedia('(pointer: coarse)').matches
}

/**
 * 判断是不是机器人
 * @param id 用户id
 * @returns
 */
export function isRobot(id: number | string): boolean {
    return seneraDirectory.value?.agents.some(agent => String(agent.qqUserId) === String(id)) ?? false
}

//#region == use封装 ========================================
/**
 * 用来封装一个停留事件的处理, 支持传递额外上下文
 * 适用于鼠标或触摸事件，停留一段时间后触发
 * 例如：长按菜单,鼠标悬浮等
 * @param getPos 从事件里提取坐标的函数
 * @param continueTime 成功的持续时间
 * @param hooks 钩子函数 支持成功时,失败时,退出时
 * @returns {
 *   acceptStartEvent: (event: T, exArg?: E) => void, // 接受开始事件
 *   acceptUpdateEvent: (event: T) => void, // 接受更新事件
 *   acceptEndEvent: (event: T) => void // 接受结束事件
 * }
 */
export function useStayEvent<T extends Event, C>(
    getPos: (event: T) => { x: number, y: number } | void,
    hooks: {
        onFit?: ((eventData: MenuEventData, ctx: C) => void)
        | ((eventData: MenuEventData) => void)
        | ((ctx: C) => void)
        | (() => void)
        onLeave?: ((ctx: C) => void)
        | (() => void)
        onFail?: ((ctx: C) => void)
        | (() => void)
    },
    continueTime: number,
): {
    handle: (event: T, ctx?: C | undefined) => void,
    handleEnd: (event: T) => void,
} {
    // 表示结束
    let end: boolean = true
    // 表示是否符合条件
    let fit: boolean = false
    // 记录开始位置
    let startPos: { x: number, y: number } | undefined = undefined
    // settiemout
    let timeout: number
    // 开始时事件数据
    let startEventData: MenuEventData
    // 额外参数
    let ctx: C | undefined
    const handle = (event: T, _ctx?: C | undefined) => {
        if (end) _acceptStartEvent(event, _ctx)
        else _acceptUpdateEvent(event)
    }
    const handleEnd = (event: T) => {
        if (end) return
        _acceptEndEvent(event)
    }
    const _acceptStartEvent = (event: T, _ctx?: C | undefined) => {
        fit = false
        end = false
        ctx = _ctx
        startPos = getPos(event) as { x: number, y: number }
        if (!startPos) return
        startEventData = {
            x: startPos.x,
            y: startPos.y,
            target: event.target as HTMLElement,
        }
        timeout = setTimeout(() => {
            fit = true
            _callFit()
        }, continueTime) as unknown as number
    }
    const _acceptUpdateEvent = (event: T) => {
        if (end) return
        const pos = getPos(event)
        if (!pos) return
        if (!startPos) return
        // 位置改变
        if (Math.abs(pos.x - startPos.x) > 10 ||
            Math.abs(pos.y - startPos.y) > 10) {
            _setEnd()
        }
    }
    const _acceptEndEvent = (event: T) => {
        if (end) return
        _setEnd()
        if (getPos(event)) _acceptUpdateEvent(event)
    }
    // ==工具函数=====================================
    const _setEnd = () => {
        end = true
        if (fit) _callLeave()
        else _callFail()
        // 清除定时器
        clearTimeout(timeout)
    }
    const _callFit = () => {
        if (hooks.onFit?.length === 0) {
            (hooks.onFit as () => void)()
        } else if (hooks.onFit?.length === 1) {
            let arg
            if (ctx) arg = ctx
            else arg = startEventData;

            (hooks.onFit as (arg: MenuEventData | C) => void)(arg)
        } else if (hooks.onFit?.length === 2) {
            (hooks.onFit as (eventData: MenuEventData, ctx?: C) => void)(startEventData, ctx)
        }
    }
    const _callLeave = () => {
        if (hooks.onLeave?.length === 0) {
            (hooks.onLeave as () => void)()
        } else if (hooks.onLeave?.length === 1) {
            (hooks.onLeave as (ctx?: C) => void)(ctx)
        }
    }
    const _callFail = () => {
        if (hooks.onFail?.length === 0) {
            (hooks.onFail as () => void)()
        } else if (hooks.onFail?.length === 1) {
            (hooks.onFail as (ctx?: C) => void)(ctx)
        }
    }
    return {
        handle,
        handleEnd,
    }
}

let viewportUnitsCache: { vw: ShallowRef<number>, vh: ShallowRef<number> } | undefined
export function useViewportUnits(): { vw: ShallowRef<number>, vh: ShallowRef<number> } {
    if (viewportUnitsCache)
        return viewportUnitsCache

    const vw = shallowRef(window.innerWidth / 100)
    const vh = shallowRef(window.innerHeight / 100)

    const updateUnits = () => {
        vw.value = window.innerWidth / 100
        vh.value = window.innerHeight / 100
    }

    onMounted(() => {
        window.addEventListener('resize', updateUnits)
    })

    onUnmounted(() => {
        window.removeEventListener('resize', updateUnits)
    })

    viewportUnitsCache = { vw, vh }

    return { vw, vh }
}

/**
 * 使用 localStorage
 * @param key 保存的键值
 * @param defaultValue 默认值
 * @returns
 */
export function useLocalStorage<T>(key: string, defaultValue: T): Ref<T> {
    const parser = (data: string) => {
        return JSON.parse(data).value as T
    }
    const serializer = (data: T) => {
        return JSON.stringify({ value: data })
    }
    const storageData = localStorage.getItem(key)
    const data = ref<T>(storageData ? parser(storageData) : defaultValue)
    watch(
        data,
        (newValue) => {
            localStorage.setItem(key, serializer(newValue))
        },
        { deep: true },
    )
    return data as Ref<T>
}
//#endregion

//#region == v命令封装 ======================================
/**
 * 创建一个右键菜单指令
 * 用于闭包公用停留事件控制器
 * @returns
 */
function createVMenu(): Directive<HTMLElement, (event: MenuEventData) => void> {
    // 右键菜单事件数据类型
    type Binding = DirectiveBinding<(event: MenuEventData) => void> & { modifiers: { prevent?: boolean, stop?: boolean } }

    let activeMenu = false
    const activePenPointers = new Set<number>()

    const isPenTouchEvent = (event: TouchEvent) => {
        if (activePenPointers.size > 0) return true
        const touch = event.changedTouches[0] || event.touches[0]
        const touchType = (touch as Touch & { touchType?: string })?.touchType
        return touchType === 'stylus'
    }

    const recordPointerType = (event: PointerEvent, isStart: boolean) => {
        if (event.pointerType !== 'pen') return
        if (isStart) {
            activePenPointers.add(event.pointerId)
            activeMenu = false
        } else {
            activePenPointers.delete(event.pointerId)
        }
    }

    // 右键菜单事件数据类型
    const {
        handle: menuTouchHandle,
        handleEnd: menuTouchEnd,
    } = useStayEvent(
        (event: TouchEvent) => {
            if (event.touches.length > 0) {
                const touch = event.touches[0]
                return { x: touch.clientX, y: touch.clientY }
            }
            return undefined
        },
        {
            onFit: (data: MenuEventData, binding: Binding) => {
                // 触发右键菜单事件
                binding.value(data)
                activeMenu = true
            }
        },
        400,
    )

    // 创建指令
    return {
        mounted(el: HTMLElement, binding: Binding,) {
            // 创建变量
            const prevent = binding.modifiers.prevent || false
            const stop = binding.modifiers.stop || false
            const controller = new AbortController()
            const options = { signal: controller.signal }

            // 添加监听
            el.addEventListener('contextmenu', (event) => {
                if (prevent) event.preventDefault()
                if (stop) event.stopPropagation()
                const data: MenuEventData = {
                    x: event.clientX,
                    y: event.clientY,
                    target: event.target as HTMLElement,
                }
                binding.value(data)
            }, options)
            el.addEventListener('touchstart', (event) => {
                if (isPenTouchEvent(event)) return
                menuTouchHandle(event, binding)
            }, options)
            el.addEventListener('touchmove', (event) => {
                if (isPenTouchEvent(event)) return
                if (prevent && activeMenu) event.preventDefault()
                if (stop && activeMenu) event.stopPropagation()
                menuTouchHandle(event, binding)
            }, options)
            el.addEventListener('touchend', (event) => {
                if (isPenTouchEvent(event)) {
                    activeMenu = false
                    return
                }
                if (prevent && activeMenu) event.preventDefault()
                if (stop && activeMenu) event.stopPropagation()
                menuTouchEnd(event)
                activeMenu = false
            }, options)
            el.addEventListener('touchcancel', (event) => {
                menuTouchEnd(event)
                activeMenu = false
            }, options)
            el.addEventListener('pointerdown', (event) => {
                recordPointerType(event, true)
            }, options)
            el.addEventListener('pointerup', (event) => {
                recordPointerType(event, false)
            }, options)
            el.addEventListener('pointercancel', (event) => {
                recordPointerType(event, false)
            }, options)

                // 绑定控制器
                ; (el as any)._vMenuController = controller
        },
        unmounted(el: HTMLElement) {
            const controller = (el as any)._vMenuController
            if (!controller) return

            controller.abort()
            delete (el as any)._vMenuController
        },
    }
}
/**
 * 创建一个右键菜单指令
 * @example v-menu="(data: MenuEventData) =>  打开菜单函数(data, 其他参数)"
 */
export const vMenu: Directive<HTMLElement, (event: MenuEventData) => void, 'prevent' | 'stop'> = createVMenu()
/**
 * 挂在时如果设备支持,自动聚焦输入框
 */
export const vAutoFocus: Directive<HTMLInputElement | HTMLTextAreaElement, undefined> = {
    mounted(el: HTMLInputElement | HTMLTextAreaElement) {
        // 判断是否支持聚焦
        if (!shouldAutoFocus()) return

        // 检查元素是否可见
        const isVisible = () => {
            const style = window.getComputedStyle(el)
            return style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0'
        }

        if (!isVisible()) return

        el.focus()
    }
}

export interface SearchBinding<T extends object> {
    originList: Iterable<T>
    isSearch: boolean
    query: T[]
    forceUpdate?: number // 强制刷新
    match: (item: T, query: string) => boolean
}

/**
 * 生成一个 Search 指令
 */
export function createVSearch<T extends object>(): Directive<HTMLInputElement, SearchBinding<T>> {
    return {
        mounted(el, binding: DirectiveBinding<SearchBinding<T>>) {
            const controller = new AbortController()
            const queryTxt = ref('')

            el.addEventListener('input', () => {
                queryTxt.value = el.value.trim()
            }, { signal: controller.signal })

            const stopWatchEffect = watchEffect(() => {
                void binding.value.forceUpdate
                if (!queryTxt.value) {
                    binding.value.isSearch = false
                    binding.value.query = []
                } else {
                    binding.value.isSearch = true
                    binding.value.query = shallowReactive(Array.from(binding.value.originList)
                        .filter(item => binding.value.match(item, queryTxt.value)))
                }
            })
            const stopWatch = watch(() => binding.value.isSearch, (isSearch) => {
                if (!isSearch) {
                    binding.value.query = []
                }
            })
                ; (el as any)._vSearchController = controller
                ; (el as any)._vStopWatch = { stopWatch, stopWatchEffect }
        },
        unmounted(el) {
            const controller = (el as any)._vSearchController
            const stopWatch = (el as any)._vStopWatch
            if (controller) {
                controller.abort()
                delete (el as any)._vSearchController
            }
            if (stopWatch) {
                (stopWatch.stopWatch as WatchHandle).stop()
                    ; (stopWatch.stopWatchEffect as WatchHandle).stop()
                delete (el as any)._vStopWatch
            }
        }
    }
}
/**
 * 输入时在制定列表里搜索匹配的项
 * @example v-search="{
 *     originList: 制定的列表,
 *     isSearch: 当前是否在搜索,
 *     query: 搜索结果列表，
 * }"
 * @see createVSearch
 */
export const vSearch = createVSearch<any>()

/**
 * 是否隐藏元素
 * 如果值为 true，则隐藏元素（通过设置 opacity 为 0）
 * 如果值为 false，则显示元素（通过清除 opacity）
 * @example v-hide="true"
 */
export const vHide: Directive<HTMLElement, boolean> = {
    mounted(el: HTMLElement, binding: DirectiveBinding<boolean>) {
        if (binding.value)
            el.style.opacity = '0'

        else
            el.style.opacity = ''
    },
    updated(el: HTMLElement, binding: DirectiveBinding<boolean>) {
        if (binding.value)
            el.style.opacity = '0'

        else
            el.style.opacity = ''
    }
}

/**
 * 监听 Esc 键按下事件
 * 当按下 Esc 键时，执行绑定的函数
 * @example v-esc="退出函数"
 */
export const vEsc: Directive<HTMLElement, () => void> = {
    mounted(el: HTMLElement, binding: DirectiveBinding<() => void>) {
        const controller = new AbortController()
        const options = { signal: controller.signal }

        // 监听键盘事件
        const keydownHandler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation()
                binding.value()
            }
        }
        document.addEventListener('keydown', keydownHandler, options)
            ; (el as any)._vEscController = controller
    },
    unmounted(el: HTMLElement) {
        const controller = (el as any)._vEscController

        if (!controller) return

        controller.abort()
        delete (el as any)._vEscController
    }
}

/**
 * v-move的选项
 */
export interface VMoveOptions<T extends HTMLElement> {
    enabled?: () => boolean
    startEdge?: 'left' | 'right'
    beforeHook?: (el: T) => void
    moveHook?: (el: T, move: number) => void
    endHook?: (el: T) => void
    leftLimit?: {
        value: number,
        type: 'px' | '%'
    }
    rightLimit?: {
        value: number,
        type: 'px' | '%'
    }
    speedCondition?: {
        minMove: {
            value: number,
            type: 'px' | '%'
        }
        minSpeed: number
    },
    moveCondition?: {
        minMove: {
            value: number,
            type: 'px' | '%'
        }
    }
}

function createVMove<T extends HTMLElement>(): Directive<T, VMoveOptions<T>> {
    return {
        mounted(el: T, binding: DirectiveBinding<VMoveOptions<T>>) {
            const options = binding.value

            const moveFlag = {
                _move: 0,
                get move() {
                    return this._move
                },
                set move(value: number) {
                    if (value < -getLimit('left')) value = -getLimit('left')
                    if (value > getLimit('right')) value = getLimit('right')
                    this._move = value
                },
                onScroll: 'none' as 'none' | 'touch' | 'wheel',
                lastTime: null as null | number,
                speedList: [] as number[],
            }
            const activePenPointers = new Set<number>()
            const swipe = new DirectionalSwipe()
            let touchId: number | undefined
            let touchMove = 0

            const isPenTouchEvent = (event: TouchEvent) => {
                if (activePenPointers.size > 0) return true
                const touch = event.changedTouches[0] || event.touches[0]
                const touchType = (touch as Touch & { touchType?: string })?.touchType
                return touchType === 'stylus'
            }

            const recordPointerType = (event: PointerEvent, isStart: boolean) => {
                if (event.pointerType !== 'pen') return
                if (isStart) {
                    activePenPointers.add(event.pointerId)
                    cancelTouch()
                } else {
                    activePenPointers.delete(event.pointerId)
                }
            }

            const getPxValue = (option: { type: 'px' | '%', value: number }) => {
                if (option.type === 'px') return option.value
                return el.getBoundingClientRect().width * option.value / 100
            }
            const getLimit = (type: 'left' | 'right') => {
                const option = options?.[`${type}Limit`]
                if (!option) return 0
                return getPxValue(option)
            }

            // 滚轮滑动
            const chatWheelEvent = (event: WheelEvent) => {
                if (options.enabled?.() === false || !canStartSwipe(event.target, el)) return
                const process = (event: WheelEvent) => {
                    // 正在触屏,不处理
                    if (moveFlag.onScroll === 'touch') return false
                    const x = event.deltaX
                    const y = event.deltaY
                    const absX = Math.abs(x)
                    const absY = Math.abs(y)
                    if (absX === 0) return false
                    // 斜度过大
                    if (absY !== 0 && absX / absY < 2) return false
                    dispenseMove('wheel', -x / 3)
                    return true
                }
                if (!process(event)) return
                event.stopPropagation()
                event.preventDefault()
                // 创建遮罩
                // 由于在窗口移动中,窗口判定箱也在移动,当指针不再窗口外,事件就断了
                // 所以要创建一个不会动的全局遮罩来处理
                wheelMask(process, () => {
                    dispenseMove('wheel', 0, true)
                })
            }

            // 触屏开始
            const chatMoveStartEvent = (event: TouchEvent) => {
                if (moveFlag.onScroll === 'wheel') return
                cancelTouch()
                if (event.touches.length !== 1 || isPenTouchEvent(event) || options.enabled?.() === false || !canStartSwipe(event.target, el)) return
                const touch = event.touches[0]
                const bounds = el.getBoundingClientRect()
                if (options.startEdge === 'left' && touch.clientX - bounds.left > 28) return
                if (options.startEdge === 'right' && bounds.right - touch.clientX > 28) return
                touchId = touch.identifier
                touchMove = 0
                swipe.start(touch.clientX, touch.clientY)
            }

            // 触屏滑动
            const chatMoveEvent = (event: TouchEvent) => {
                if (moveFlag.onScroll === 'wheel') return
                if (event.touches.length !== 1 || isPenTouchEvent(event)) { cancelTouch(); return }
                const touch = Array.from(event.touches).find(value => value.identifier === touchId)
                if (!touch) return
                const distance = swipe.move(touch.clientX, touch.clientY)
                if (distance === undefined || !event.cancelable) return
                if ((distance > 0 && !getLimit('right')) || (distance < 0 && !getLimit('left'))) return
                event.stopPropagation()
                event.preventDefault()
                const delta = distance - touchMove
                touchMove = distance
                dispenseMove('touch', delta)
            }

            // 触屏滑动结束
            const chatMoveEndEvent = (event: TouchEvent) => {
                if (moveFlag.onScroll === 'wheel') return
                if (!Array.from(event.changedTouches).some(value => value.identifier === touchId)) return
                if (moveFlag.onScroll === 'touch') {
                    event.stopPropagation()
                    dispenseMove('touch', 0, true)
                }
                cancelTouch()
            }

            const cancelTouch = () => {
                swipe.cancel()
                touchId = undefined
                touchMove = 0
                if (moveFlag.onScroll === 'touch') endMove(false)
            }
            /**
             * 分发触屏/滚轮情况
             */
            const dispenseMove = (type: 'touch' | 'wheel', value: number, end: boolean = false) => {
                if (!end && moveFlag.onScroll === 'none') { startMove(type, value); return }
                if (moveFlag.onScroll === 'none') return
                if (end) endMove()
                else keepMove(value)
            }

            /**
             * 开始窗口移动
             */
            const startMove = (type: 'touch' | 'wheel', value: number) => {
                // 记录 flag
                moveFlag.onScroll = type
                moveFlag.move = value
                moveFlag.lastTime = Date.now()

                // 执行前置钩子
                options?.beforeHook?.(el)
                // 执行移动钩子
                options?.moveHook?.(el, moveFlag.move)
            }
            /**
             * 保持窗口移动
             */
            const keepMove = (value: number) => {
                // 增加移动值
                moveFlag.move += value
                // 计算速度
                const nowDate = Date.now()
                if (!moveFlag.lastTime) return
                const deltaTime = nowDate - moveFlag.lastTime
                moveFlag.lastTime = nowDate
                if (deltaTime > 0) moveFlag.speedList.push(value / deltaTime)

                // 执行移动钩子
                options?.moveHook?.(el, moveFlag.move)
            }
            /**
             * 结束窗口移动
             */
            const endMove = (commit = true) => {
                // 保留自己要的数据
                const move = moveFlag.move
                const speedList = moveFlag.speedList

                // 移动距离判定
                if (
                    commit && options?.moveCondition &&
                    Math.abs(move) >= getPxValue(options.moveCondition.minMove)
                ) {
                    if (move > 0)
                        el.dispatchEvent(new CustomEvent('v-move-right', { detail: move }))
                    else
                        el.dispatchEvent(new CustomEvent('v-move-left', { detail: move }))
                } else
                    // 速度判定
                    if (
                        commit && options?.speedCondition &&
                        Math.abs(move) >= getPxValue(options.speedCondition.minMove)
                    ) {
                        const endSpeedList = speedList.toReversed().slice(0, 10)
                        let endSpeed = 0
                        for (const speed of endSpeedList) {
                            endSpeed += speed
                        }
                        endSpeed /= endSpeedList.length
                        if (Math.abs(endSpeed) > options.speedCondition.minSpeed) {
                            if (endSpeed > 0)
                                el.dispatchEvent(new CustomEvent('v-move-right', { detail: move }))
                            else
                                el.dispatchEvent(new CustomEvent('v-move-left', { detail: move }))
                        }
                    }

                // 执行结束钩子
                binding.value?.endHook?.(el)

                // 重置数据
                moveFlag.onScroll = 'none'
                moveFlag.lastTime = 0
                moveFlag.speedList = []
                moveFlag.move = 0
            }

            // 添加监听
            const controller = new AbortController()
            const listenerOptions = { signal: controller.signal }
            el.addEventListener('wheel', chatWheelEvent, { ...listenerOptions, passive: false })
            el.addEventListener('pointerdown', (event) => {
                recordPointerType(event, true)
            }, listenerOptions)
            el.addEventListener('pointerup', (event) => {
                recordPointerType(event, false)
            }, listenerOptions)
            el.addEventListener('pointercancel', (event) => {
                recordPointerType(event, false)
            }, listenerOptions)
            el.addEventListener('touchstart', chatMoveStartEvent, listenerOptions)
            el.addEventListener('touchmove', chatMoveEvent, { ...listenerOptions, passive: false })
            el.addEventListener('touchend', chatMoveEndEvent, listenerOptions)
            el.addEventListener('touchcancel', cancelTouch, listenerOptions)
            window.addEventListener('blur', cancelTouch, listenerOptions)
                ; (el as any)._vMoveController = controller

        },
        unmounted(el: T) {
            const controller = (el as any)._vMoveController
            if (!controller) return

            controller.abort()
            delete (el as any)._vMoveController
        }
    }
}

function createVLongHover(): Directive<HTMLElement, undefined> {
    const {
        handle: userHoverHandle,
        handleEnd: userHoverEnd,
    } = useStayEvent((event: MouseEvent) => {
        return { x: event.clientX, y: event.clientY, }
    }, {
        onFit: (eventData, ctx: HTMLElement) => {
            ctx.dispatchEvent(new CustomEvent('v-long-hover', { detail: eventData }))
        },
        onLeave: (ctx: HTMLElement) => {
            ctx.dispatchEvent(new CustomEvent('v-long-hover-end'))
        }
    }, 495
    )
    return {
        mounted(el: HTMLElement) {
            const controller = new AbortController()
            const options = { signal: controller.signal }

            el.addEventListener('mouseenter', (event) => {
                userHoverHandle(event, el)
            }, options)
            el.addEventListener('mousemove', (event) => {
                userHoverHandle(event, el)
            }, options)
            el.addEventListener('mouseleave', (event) => {
                userHoverEnd(event)
            }, options)
                ; (el as any)._vLongHoverController = controller
        },
        unmounted(el: HTMLElement) {
            const controller = (el as any)._vLongHoverController
            if (!controller) return

            controller.abort()
            delete (el as any)._vLongHoverController
        }
    }
}

/**
 * 监听元素左滑动/右滑动事件
 * 当元素被左滑动时，触发 'v-move-left' 事件
 * 当元素被右滑动时，触发 'v-move-right' 事件
 * @example <dom v-move="{
 *     beforeHook: 开始移动前的钩子函数,
 *     moveHook: 移动中的钩子函数,
 *     endHook: 结束移动后的钩子函数,
 *     leftLimit: 左侧移动限制,
 *     rightLimit: 右侧移动限制,
 *     speedCondition: 根据速度判定是否触发移动事件的条件,
 *     moveCondition: 根据移动距离判定是否触发移动事件的条件,
 * }"
 * onV-move-left="(move) => 左滑动事件(move)"
 * onV-move-right="(move) => 右滑动事件(move)"
 * />
 */
export const vMove = createVMove<any>()

/**
 * 监听元素长时间悬停事件
 * 当元素被鼠标悬停超过一定时间后，触发 'v-long-hover' 事件
 * 当鼠标移出元素时，触发 'v-long-hover-end' 事件
 * @example <dom v-long-hover
 * onV-long-hover="(eventData) => 长悬停事件(eventData)"
 * onV-long-hover-end="() => 长悬停结束事件()"
 * />
 */
export const vLongHover = createVLongHover()

type VTooltipBinding<T extends Component> =
    | T
    | VueCompData<T>
    | (() => T | VueCompData<T>)
    | ((eventData: { x: number, y: number }) => T | VueCompData<T>)

function resolveBinding<T extends Component>(binding: VTooltipBinding<T>, eventData: { x: number, y: number }): VueCompData<T> {
    if (typeof binding === 'function') {
        // eslint-disable-next-line multiline-ternary
        const result = binding.length === 0
            // eslint-disable-next-line multiline-ternary
            ? (binding as () => T | VueCompData<T>)()
            : (binding as (eventData: { x: number, y: number }) => T | VueCompData<T>)(eventData)
        if ('comp' in result) return result
        return { comp: result } as VueCompData<T>
    } else if ('comp' in binding) {
        return binding
    } else {
        return { comp: binding, props: {} } as VueCompData<T>
    }
}

/**
 * 监听元素长时间悬停事件以显示提示工具
 * 当元素被鼠标悬停超过一定时间后，显示提示工具
 * 当鼠标移出元素时，关闭提示工具
 * @modifiers debug - 调试模式，启用后悬停结束时不会关闭提示工具
 * @example <dom v-tooltip="{
 *     comp: 提示组件,
 *     props: 传递给提示组件的属性,
 *     model: 传递给提示组件的 v-model 数据,
 *     emit: 传递给提示组件的事件,
 * }" />
 */
export const vTooltip = {
    mounted<T extends Component>(el: HTMLElement, binding: Pick<DirectiveBinding<VTooltipBinding<T>>, 'value'> & { modifiers?: { debug?: boolean } }) {
        const controller = new AbortController()
        const options = { signal: controller.signal }
            ; (vLongHover as any).mounted(el)
            ; (el as any)._vTooltipController = controller

        let tooltip: TooltipController | undefined
        controller.signal.addEventListener('abort', () => tooltip?.close(), { once: true })

        el.addEventListener('v-long-hover', (ev: Event) => {
            const event = ev as CustomEvent<{ x: number, y: number }>
            const detail = event.detail
            const compData = resolveBinding(binding.value, detail)
            tooltip = addTooltip(compData, { x: detail.x, y: detail.y })
        }, options)

        el.addEventListener('v-long-hover-end', () => {
            if (binding.modifiers?.debug) return
            tooltip?.close()
            tooltip = undefined
        }, options)
    },

    unmounted(el: HTMLElement) {
        (vLongHover as any).unmounted(el)
        const controller = (el as any)._vTooltipController
        if (!controller) return

        controller.abort()
        delete (el as any)._vTooltipController
    }
}

//#endregion
