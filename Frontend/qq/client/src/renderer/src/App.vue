<template>
    <div v-if="tags.musicLyric != ''" class="lyric-bar">
        {{ tags.musicLyric }}
    </div>
    <div v-if="!startupReady || startupError || recoveringConnection || authenticationError" id="load-view" class="load-view">
        <div v-if="authenticationError" class="startup-error" role="alert">
            <p>{{ authenticationError }}</p>
            <p>未发送的消息和附件已保留</p>
            <a class="ss-button" :href="seneraConsoleUrl()">返回主控台登录</a>
        </div>
        <div v-else-if="startupError" class="startup-error" role="alert">
            <p>无法启动聊天界面</p>
            <p>{{ startupError }}</p>
            <button type="button" class="ss-button" @click="reloadClient">重新加载</button>
        </div>
        <div v-else role="status" class="senera-connection-progress">
            <font-awesome-icon :icon="['fas', 'circle-notch']" spin />
            <span>{{ recoveringConnection ? '正在恢复工作区连接…' : '正在加载…' }}</span>
        </div>
    </div>
    <div id="base-app" class="senera-client" :class="{ 'senera-chat-open': tags.showChat && chatStore.chatInfo.show.id != 0, 'senera-disconnected': !loginInfo.status }">
        <SeneraConnectionView v-if="startupReady && !loginInfo.status && !recoveringConnection" @connect="connect" />
        <div class="main-body onloading">
            <ul id="side-bar" class="onloading" :style="{ 'padding-bottom': get('fs_adaptation') > 0 ? `${get('fs_adaptation')}px` : '' }">
                <li v-if="loginInfo.status" class="senera-account" :title="authStore.loginInfo.nickname"
                    @click="changeTab('设置', 'Options', false)">
                    <img :src="userAvatar(authStore.loginInfo.uin)" :alt="authStore.loginInfo.nickname">
                </li>
                <li id="bar-msg" :class="tags.page == 'Messages' ? 'active' : ''" :title="$t('消息')"
                    @click="changeTab('信息', 'Messages', true)">
                    <font-awesome-icon :icon="['far', 'comment-dots']" />
                    <span>{{ $t('消息') }}</span>
                </li>
                <li id="bar-friends" :class="tags.page == 'Friends' ? 'active' : ''" :title="$t('列表')"
                    @click="changeTab('列表', 'Friends', true)">
                    <font-awesome-icon :icon="['far', 'address-book']" />
                    <span>{{ $t('联系人') }}</span>
                </li>
                <li v-if="useQzoneStore().qzoneFeedList.length > 0"
                    id="bar-qzone"
                    :class="tags.page == 'Qzone' ? 'active' : ''"
                    @click="changeTab('空间', 'Qzone', false)">
                    <font-awesome-icon :icon="['fas', 'star']" />
                    <span>{{ $t('空间') }}</span>
                </li>
                <div class="side-bar-space" />
                <li v-if="tags.currentMusic"
                    :class="['music-entry', {
                        'active': tags.showMusicPlayer,
                    }]"
                    @click="toggleMusicPlayer(undefined)">
                    <img class="music-entry-cover"
                        :src="tags.currentMusic.cover"
                        :alt="tags.currentMusic.title">
                    <font-awesome-icon v-if="tags.musicPlaying" :icon="['fas', 'play']"
                        :class="['music-entry-status', { light: tags.currentMusic.coverLight }]" />
                    <font-awesome-icon v-else :icon="['fas', 'pause']"
                        :class="['music-entry-status', { light: tags.currentMusic.coverLight }]" />
                </li>
                <li v-if="showFileManagerEntry" :class="{ 'active': tags.showFileManager }"
                    @click="toggleFileManager(undefined)">
                    <font-awesome-icon :icon="['fas', 'arrow-down']" />
                    <span>{{ $t('传输') }}</span>
                </li>
                <li :class="tags.page == 'Options' ? 'active' : ''" @click="changeTab('设置', 'Options', false)">
                    <font-awesome-icon :icon="['fas', 'gear']" />
                    <span>{{ $t('设置') }}</span>
                </li>
                <li v-if="tags.currentMusic"
                    :class="['music-entry-small', {
                        'active': tags.showMusicPlayer,
                    }]"
                    @click="toggleMusicPlayer(undefined)">
                    <img class="music-entry-cover"
                        :src="tags.currentMusic.cover"
                        :alt="tags.currentMusic.title">
                    <font-awesome-icon v-if="tags.musicPlaying" :icon="['fas', 'play']"
                        :class="['music-entry-status', { light: tags.currentMusic.coverLight }]" />
                    <font-awesome-icon v-else :icon="['fas', 'pause']"
                        :class="['music-entry-status', { light: tags.currentMusic.coverLight }]" />
                </li>
            </ul>
            <div :style="{ 'height': get('fs_adaptation') > 0 ? `calc(100% - ${75 + Number(get('fs_adaptation'))}px)` : '' }">
                <div v-if="tags.page == 'Messages'" id="messageTab">
                    <Messages :chat="chatStore.chatInfo" @user-click="changeChat" @load-history="loadHistory"
                        @open-settings="changeTab('设置', 'Options', false)" />
                </div>
                <div v-if="tags.page == 'Friends'" id="friendTab">
                    <Friends :list="contactStore.userList" @load-history="loadHistory" @user-click="changeChat"
                        @open-settings="changeTab('设置', 'Options', false)" />
                </div>
                <div v-if="tags.page == 'Qzone'" id="qzoneTab">
                    <Qzone />
                </div>
                <div class="opt-main-tab" style="opacity: 0">
                    <Options :show="tags.page == 'Options'" :class="tags.page == 'Options' ? 'active' : ''" />
                </div>
            </div>
        </div>
        <component :is="uiStore.pageView.chatView" v-if="
            loginInfo.status &&
                chatStore.chatInfo &&
                chatStore.chatInfo.show.id != 0"
            v-show="tags.showChat"
            ref="chat" :mumber-info="chatStore.chatInfo.info.now_member_info == undefined ?
                {} : chatStore.chatInfo.info.now_member_info"
            :merge-list="chatStore.mergeMessageList"
            :list="chatStore.messageList" :chat="chatStore.chatInfo"
            @user-click="changeChat" />
        <TransitionGroup class="app-msg" name="appmsg" tag="div">
            <div v-for="msg in appMsgs" :key="'appmsg-' + msg.id">
                <div><font-awesome-icon :icon="['fas', msg.svg]" /></div>
                <a>{{ msg.text }}</a>
                <div v-if="!msg.autoClose" @click="popInfo.remove(msg.id)">
                    <font-awesome-icon :icon="['fas', 'xmark']" />
                </div>
            </div>
        </TransitionGroup>
        <Transition name="music-player-float">
            <div v-show="tags.showMusicPlayer" class="global-music-player ss-card">
                <MusicPlayer
                    @open-panel="toggleMusicPlayer"
                    @update-lyric="updateMusicLyric"
                    @update-status="updateMusicStatus" />
            </div>
        </Transition>
        <Transition name="music-player-float">
            <div v-show="tags.showFileManager" class="global-music-player ss-card">
                <FileManager @open-panel="toggleFileManager" />
            </div>
        </Transition>
        <Transition name="modal">
            <div v-if="uiStore.popBoxList.length > 0" id="pop-box" class="pop-box">
                <div :class="'pop-box-body ss-card' +
                         (uiStore.popBoxList[0].full ? ' full' : '') +
                         (get('option_view_no_window') == true ? '' : ' window')"
                    :style="{ 'margin-bottom': get('fs_adaptation') > 0 ? `${40 + Number(get('fs_adaptation'))}px` : '' }">
                    <header v-show="uiStore.popBoxList[0].title != undefined">
                        <div v-if="uiStore.popBoxList[0].svg != undefined">
                            <font-awesome-icon :icon="['fas', uiStore.popBoxList[0].svg]" />
                        </div>
                        <a>{{ uiStore.popBoxList[0].title }}</a>
                        <font-awesome-icon v-if="uiStore.popBoxList[0].allowClose != false"
                            :icon="['fas', 'xmark']" @click="removePopBox" />
                    </header>
                    <div v-if="uiStore.popBoxList[0].html" v-html="uiStore.popBoxList[0].html" />
                    <component :is="uiStore.popBoxList[0].template" v-else :data="uiStore.popBoxList[0].data"
                        v-bind="uiStore.popBoxList[0].templateValue" />
                    <div v-show="uiStore.popBoxList[0].button" class="button">
                        <button v-for="(button, index) in uiStore.popBoxList[0].button"
                            :key="'pop-box-btn' + index" :class="'ss-button' + (button.master == true ? ' master' : '')"
                            @click="button.fun">
                            {{ button.text }}
                        </button>
                    </div>
                    <div class="pop-box-more">
                        <div v-for="index in uiStore.popBoxList.length" :key="'pop-more-' + index" :data-id="index"
                            :class="index > uiStore.popBoxList.length - 1 ? 'hid' : '' "
                            :style="{ 'margin': `-${2 * (index - 1)}px ${(20 * index - 1 - 2 * (index - 1))}px 0 ${(20 * index - 1 - 2 * (index - 1))}px` }" />
                    </div>
                </div>
                <div @click="popQuickClose(uiStore.popBoxList[0].allowQuickClose != false && uiStore.popBoxList[0].allowClose != false)" />
            </div>
        </Transition>
        <!-- 全局搜索栏 -->
        <GlobalSessionSearchBar />
        <NtViewer ref="ntViewer" />
        <!-- 提示工具 -->
        <Tooltips />
        <div id="mobile-css" />
    </div>
    <div id="main-bg" class="main-bg onloading"
        :style="{
            'background-image': toBackgroundImageStyle(settingsStore.sysConfig.chat_more_blur ? settingsStore.sysConfig.chat_background : ''),
            'background-position': settingsStore.sysConfig.chat_background_align ?? 'center',
            'background-size': settingsStore.sysConfig.chat_background_fit ?? 'cover',
            'opacity': 1 - Number(settingsStore.sysConfig.chat_background_blur) / 100 }" />
</template>

<script setup lang="ts">
import { useSeneraHost } from '@renderer/runtime/seneraHost'
import { useSeneraNavigation } from '@renderer/runtime/seneraNavigation'
import { userAvatar } from '@renderer/runtime/seneraIdentity'
import { useClientAppearanceAssets } from '@renderer/runtime/appearance'
useSeneraHost()
useClientAppearanceAssets()
import Option from '@renderer/function/option'
import * as App from './function/utils/appUtil'
import anime from 'animejs'

import { computed, watch, onMounted, onUnmounted, shallowReactive, shallowRef, provide } from 'vue'
import { Connector, login as loginInfo } from '@renderer/function/connect'
import { Logger, popList, PopInfo } from '@renderer/function/base'
import { BaseChatInfoElem } from '@renderer/function/elements/information'
import { useConnectionStore } from '@renderer/state/connection'
import { useUIStore } from '@renderer/state/ui'
import { useSettingsStore } from '@renderer/state/settings'
import { useChatStore } from '@renderer/state/chat'
import { useContactStore } from '@renderer/state/contact'
import { useAuthStore } from '@renderer/state/auth'
import { Notify } from './function/notify'
import { updateBaseOnMsgList } from './function/utils/msgUtil'
import { isActiveTransferStatus } from './function/utils/fileTransferUtil'
import { getDeviceType, getForegroundToneFromImageUrl } from './function/utils/systemUtil'
import { i18n } from '@renderer/main'
import {
    hydrateBackgroundImage,
    migrateInlineBackgroundImage,
    toBackgroundImageStyle,
} from '@renderer/function/utils/backgroundUtil'

import Options from '@renderer/pages/Options.vue'
import Friends from '@renderer/pages/Friends.vue'
import Messages from '@renderer/pages/Messages.vue'
import Qzone from '@renderer/pages/Qzone.vue'
import MusicPlayer, { getCurrentMusic } from './components/MusicPlayer.vue'
import FileManager, { panelVisible, closePanel, getDownloadTasks } from './components/FileManager.vue'
import GlobalSessionSearchBar from './components/GlobalSessionSearchBar.vue'
import NtViewer from './components/ViewerCom.vue'
import Tooltips from './components/tooltip/Tooltips.vue'
import SeneraConnectionView from './components/SeneraConnectionView.vue'
import { qqAuthentication } from '../../../../authentication'
import { seneraConsoleUrl } from './runtime/seneraContext'
import { useQzoneStore } from './state/qzone'

// 注册组件实例
const ntViewer = shallowRef<InstanceType<typeof NtViewer> | null>(null)
provide('viewer', { viewer: ntViewer })

defineOptions({ name: 'App' })

const $t = i18n.global.t

// 静态值
const get = Option.get
const popInfo = new PopInfo()
const appMsgs = popList
const loadHistory = App.loadHistory
const isNarrowLayout = shallowRef(window.innerWidth <= 500)

// 响应式状态
const connectionStore = useConnectionStore()
const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const contactStore = useContactStore()
const chatStore = useChatStore()
let musicSyncTimer = -1
const startupError = shallowRef<string>()
const startupReady = shallowRef(false)
const authentication = shallowRef(qqAuthentication.store.getState())
const stopAuthentication = qqAuthentication.store.subscribe(state => { authentication.value = state })
const authenticationError = computed(() => authentication.value.status === 'anonymous'
    ? '登录已失效，请重新登录主控台'
    : authentication.value.status === 'failed' ? authentication.value.error.message : undefined)
const recoveringConnection = computed(() => !loginInfo.status &&
    (connectionStore.phase === 'connecting' || connectionStore.phase === 'reconnecting'))
const reloadClient = () => window.location.reload()
const tags = shallowReactive({
    page: 'Home',
    showChat: false,
    showMusicPlayer: false,
    showFileManager: false,
    currentMusic: null as null | { title: string, cover: string, coverLight: boolean },
    musicPlaying: false,
    musicLyric: '',
})
const hasTransferTasks = computed(() => getDownloadTasks().length > 0)
const hasActiveTransferTasks = computed(() => {
    return getDownloadTasks().some((task) => {
        return isActiveTransferStatus(task.status)
    })
})
const showFileManagerEntry = computed(() => {
    if (isNarrowLayout.value) {
        return hasActiveTransferTasks.value
    }
    return hasTransferTasks.value
})

//#region == 方法函数 ====================================================================

function updateLayoutState() {
    isNarrowLayout.value = window.innerWidth <= 500
}

function toggleMusicPlayer(open: boolean | undefined) {
    if(open != undefined ) {
        tags.showMusicPlayer = open
    } else {
        tags.showMusicPlayer = !tags.showMusicPlayer
    }
    refreshCurrentMusic()
}
function toggleFileManager(open: boolean | undefined) {
    if(open != undefined) {
        tags.showFileManager = open
    } else {
        tags.showFileManager = !tags.showFileManager
    }
    // 同步状态到 FileManager 模块
    if (tags.showFileManager) {
        panelVisible.value = true
    } else {
        closePanel()
    }
}
function updateMusicLyric(lyric: string) {
    tags.musicLyric = lyric
}
function updateMusicStatus(isPlaying: boolean) {
    tags.musicPlaying = isPlaying
}

async function refreshCurrentMusic() {
    const nowMusic = getCurrentMusic()
    if (!nowMusic) {
        tags.currentMusic = null
        return
    }
    let coverLight = tags.currentMusic?.coverLight ?? true
    const cover = nowMusic.cover
    if(nowMusic.cover != tags.currentMusic?.cover) {
        coverLight = await getForegroundToneFromImageUrl(cover, 0.4) == 'light'
    }
    tags.currentMusic = {
        title: nowMusic.title,
        cover,
        coverLight
    }
}

function connect() {
    Connector.create(loginInfo.address)
}

/**
 * 切换主标签卡判定
 * @param name 页面名称
 * @param view 虚拟路径名称
 * @param show 是否显示聊天面板
 */
function changeTab(_: string, view: string, show: boolean) {
    tags.showChat = show
    tags.page = view
    // 附加操作
    const optTab = document.getElementsByClassName('opt-main-tab')[0] as HTMLDivElement
    switch (view) {
        case 'Options': {
            if (optTab) {
                optTab.style.opacity = '1'
            }
            break
        }
        case 'Home': {
            if (optTab) {
                optTab.style.opacity = '0'
            }
            break
        }
    }
}
/**
 * 切换聊天对象状态
 * @param data 切换信息
 */
useSeneraNavigation(
    () => ({ page: tags.page, chat: chatStore.chatInfo.show.id ? { id: chatStore.chatInfo.show.id, type: chatStore.chatInfo.show.type } : undefined }),
    (page, chat) => {
        changeTab('', page, page === 'Messages' || page === 'Friends')
        if (chat) { changeChat(chat); void loadHistory(chat) }
    },
)

function changeChat(data: BaseChatInfoElem) {
    uiStore.openSideBar = false
    // 设置聊天信息
    chatStore.chatInfo = {
        show: data,
        info: {
            group_info: {},
            user_info: {},
            me_info: {},
            group_members: [],
            group_files: {},
            group_sub_files: {},
            jin_info: {
                list: [] as { [key: string]: any }[],
                pages: 0,
            },
        },
    }
    chatStore.mergeMessageList = undefined // 清空合并转发缓存
    uiStore.nowGetHistory = false // 切换会话后，旧会话的分页请求不能阻止新会话加载
    uiStore.canLoadHistory = true // 重置终止加载标志
    uiStore.loadHistoryFail = false // 重置加载失败标志
    uiStore.historyBeforeTime = undefined
    if (data.type == 'group') {
        // 获取自己在群内的资料
        Connector.send(
            'get_group_member_info',
            {
                group_id: data.id,
                user_id: authStore.loginInfo.uin,
            },
            'getUserInfoInGroup',
        )
        // 获取群成员列表
        // PS：部分功能不返回用户名需要进来查找所以提前获取
        Connector.send(
            'get_group_member_list',
            { group_id: data.id, no_cache: true },
            'getGroupMemberList',
        )
    }

    // 清理通知
    new Notify().closeAll(String(data.id))
}

/**
 * 移除当前的全局弹窗
 */
function removePopBox() {
    uiStore.popBoxList[0]?.onClose?.()
    uiStore.popBoxList.shift()
}

/**
 * 快速关闭弹窗（点击空白处关闭）
 * @param allow 是否允许快速关闭
 */
function popQuickClose(allow: boolean | undefined) {
    if (allow != false) {
        uiStore.popBoxList[0]?.onClose?.()
        uiStore.popBoxList.shift()
    } else {
        const animeBody = document.getElementById('pop-box')
        const timeLine = anime.timeline({ targets: animeBody })
        // 使用 animejs 实现一个沿中心左右摇晃的动画，摇晃三次
        timeLine.add({
            rotate: [
                { value: -1, duration: 75, easing: 'easeInOutSine' },
                { value: 1, duration: 150, easing: 'easeInOutSine' },
                { value: 0, duration: 75, easing: 'easeInOutSine' },
            ],
            duration: 200,
            easing: 'easeInOutSine',
            loop: 3,
        })
    }
}

function handlePopState() {
    if (loginInfo.status && !uiStore.openSideBar) {
        connectionStore.backTimes += 1
        history.pushState('senera-qq', '', location.href)
        return
    }
    uiStore.popBoxList.push({
        title: $t('提醒'),
        html: '<span>离开 Senera QQ？</span>',
        button: [
            { text: $t('取消'), fun: () => {
                uiStore.popBoxList.shift()
                history.pushState('senera-qq', '', location.href)
            } },
            { text: $t('离开'), master: true, fun: () => {
                uiStore.popBoxList.shift()
                history.back()
            } },
        ],
    })
}

const clearNotifications = () => new Notify().clear()

onMounted(() => {
    const logger = new Logger()
    window.addEventListener('resize', updateLayoutState)
    window.addEventListener('beforeunload', clearNotifications)
    updateLayoutState()
    refreshCurrentMusic()
    musicSyncTimer = window.setInterval(refreshCurrentMusic, 1000)

    watch(() => panelVisible.value, val => { tags.showFileManager = val })
    watch(showFileManagerEntry, val => {
        if (!val && tags.showFileManager) toggleFileManager(false)
    }, { immediate: true })

    const initialize = async () => {
        const loadedConfig = await Option.load()
        const migratedBackground = await migrateInlineBackgroundImage(loadedConfig.chat_background)
        if (migratedBackground) {
            loadedConfig.chat_background = migratedBackground
            Option.runAS('chat_background', migratedBackground)
        }
        settingsStore.sysConfig = loadedConfig
        if (!migratedBackground) hydrateBackgroundImage(loadedConfig.chat_background)
        for (const name of ['opt_dark', 'opt_auto_dark', 'theme_color']) Option.run(name, Option.get(name))

        for (const edge of ['top', 'right', 'bottom', 'left']) {
            const value = edge === 'bottom' && Number(Option.get('fs_adaptation')) > 0
                ? `${Number(Option.get('fs_adaptation'))}px`
                : `env(safe-area-inset-${edge}, 0px)`
            document.body.style.setProperty(`--safe-area-${edge}`, value)
        }

        document.title = 'Senera QQ'
        loginInfo.address = loadedConfig.address
        if (loadedConfig.auto_connect) connect()
        startupReady.value = true
        document.querySelectorAll('#base-app > .main-body, #side-bar, #main-bg')
            .forEach(element => element.classList.remove('onloading'))

        if (['Android', 'iOS'].includes(getDeviceType())) {
            window.addEventListener('popstate', handlePopState)
            if (history.state !== 'senera-qq') history.pushState('senera-qq', '', location.href)
        }
        watch(() => contactStore.baseOnMsgList, updateBaseOnMsgList, { deep: true })
    }
    void initialize().catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error))
        startupError.value = failure.message
        logger.error(failure, 'Senera QQ startup failed')
    })
})

onUnmounted(() => {
    stopAuthentication()
    window.removeEventListener('resize', updateLayoutState)
    window.removeEventListener('popstate', handlePopState)
    window.removeEventListener('beforeunload', clearNotifications)
    clearInterval(musicSyncTimer)
    Connector.close()
})

</script>

<style scoped>
.senera-connection-progress { display: flex; flex-direction: column; align-items: center; gap: 14px; color: var(--color-font); font-size: 14px; }
.load-view .senera-connection-progress svg { width: 24px; height: 24px; color: currentColor; }
.startup-error {
    max-width: 32rem;
    padding: 24px;
    color: var(--color-font);
    text-align: center;
    overflow-wrap: anywhere;
}
.startup-error p {
    margin: 0 0 16px;
}

/* 应用通知动画 */
.appmsg-move,
.appmsg-enter-active,
.appmsg-leave-active {
    transition: all 0.2s;
}

.appmsg-leave-active {
    position: absolute;
}

.appmsg-enter-from,
.appmsg-leave-to {
    transform: translateX(-20px);
    opacity: 0;
}

/* 标题栏变更动画 */
.appbar-enter-active,
.appbar-leave-active {
    transition: all 0.2s;
}

.appbar-enter-from,
.appbar-leave-to {
    transform: translateY(-60px);
}

/* 弹窗动画 */
.modal-enter-active {
    transition: opacity 0.2s ease-out;
}

.modal-leave-active {
    transition: opacity 0.2s ease-in;
}

.modal-leave-to {
    opacity: 0;
}

.modal-enter-active .pop-box-body {
    animation: panelSlideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-leave-active .pop-box-body {
    animation: panelSlideDown 0.2s cubic-bezier(0.4, 0, 0.6, 1);
}

.music-entry-small {
    display: none;
}
.music-entry-cover {
    width: 25px;
    height: 25px;
    border-radius: 6px;
    object-fit: cover;
    margin: 10px;
}
.music-entry-status {
    transform: translateY(calc(-100% - 3px));
    margin-bottom: calc(-100% + 10px);
    background-color: transparent !important;
    color: #545454 !important;
}
.music-entry-status.light {
    color: #e5e5e5 !important;
}
.music-entry-always-hide {
    display: none !important;
}
.music-entry-small-always-show {
    display: flex !important;
    margin-bottom: 10px !important;
}
.music-entry-small-always-show img {
    width: 35px;
    height: 35px;
}
.music-entry-small-always-show svg {
    transform: translateY(calc(-100% - 10px));
}

.global-music-player {
    position: fixed;
    left: 90px;
    bottom: 20px;
    z-index: 33;
    width: 350px;
    max-height: min(72vh, 560px);
    box-shadow: 0 0 10px var(--color-shader);
    overflow: auto;
}

.music-player-float-enter-active,
.music-player-float-leave-active {
    transition: opacity 0.2s ease, transform 0.2s ease;
}

.music-player-float-enter-from,
.music-player-float-leave-to {
    opacity: 0;
    transform: translateY(12px);
}

@media (max-width: 700px) {
    .global-music-player {
        left: 100px;
        bottom: 60px;
        width: calc(100vw - 200px);
        max-height: min(66vh, 460px);
    }
}

@media (max-width: 500px) {
    .global-music-player {
        left: 20px !important;
        bottom: 60px;
        width: calc(100vw - 70px);
        max-height: min(66vh, 460px);
    }
    .music-entry-small {
        margin-bottom: 10px !important;
        display: flex;
    }
    .music-entry-small img {
        width: 35px;
        height: 35px;
    }
    .music-entry-small svg {
        transform: translateY(calc(-100% - 10px));
    }
    .music-entry {
        display: none;
    }
}

@keyframes panelSlideUp {
    from {
        transform: translate(-50%, -20%) scale(0.95);
        opacity: 0;
    }

    to {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
    }
}

@keyframes panelSlideDown {
    from {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
    }

    to {
        transform: translate(-50%, -5%) scale(0.98);
        opacity: 0;
    }
}
</style>
