<!--
 * @FileDescription: 消息模板
 * @Author: Stapxs
 * @Date:
 *      2022/08/03
 *      2022/12/12
 * @Version:
 *      1.0 - 初始版本
 *      1.5 - 重构为 ts 版本，代码格式优化
-->

<template>
    <div :id="(idPrefix ?? 'chat-') + data.message_id"
        ref="msgMain"
        v-menu.prevent="event => $emit('showMenu', event, data)"
        :class="[
            'message', 'senera-message', type ?? '',
            { 'revoke': data.revoke },
            { 'me': isMe && type != 'body' },
            { 'selected': selected },
            { 'right': settingsStore.sysConfig.opt_ind_message === true && type != 'body' },
            { 'body-only': type == 'body' }
        ]"
        :data-raw="getMsgRawTxt(data)"
        :data-sender="data.sender.user_id"
        :data-time="data.time"
        @mouseleave="hiddenUserInfo">
        <QQMessageFrame :inline="type === 'body'" :self="isMe && type !== 'merge'"
            :group="chatStore.chatInfo.show.type === 'group'" :name="senderName"
            :avatar="userAvatar(data.sender.user_id)"
            :tag="senderTag" :tag-color="senderTagColor"
            :bot="Boolean(senderInfo && isRobot(senderInfo.user_id))" :media-only="mediaOnly"
            :user="() => getUserById(data.sender.user_id)" @poke="sendPoke">
            <div v-move="moveOptions"
                class="senera-message-content"
                @v-move-left.prevent="$emit('leftMove', data)"
                @v-move-right.prevent="$emit('rightMove', data)">
                <!-- 消息体 -->
                <template v-if="data.message.length === 0">
                    <span class="msg-text" style="opacity: 0.5">{{ $t('空消息') }}</span>
                </template>
                <!-- 超级表情 -->
                <template v-else-if="isSuperFaceMsg()">
                    <div class="msg-img face lottie-face alone">
                        <LazyLottie
                            :animation-link="Emoji.get(Number(data.message[0].id))!.superValue!"
                            :title="Emoji.get(Number(data.message[0].id))!.description" />
                    </div>
                </template>
                <template v-else-if="!hasCard()">
                    <div v-for="(item, index) in data.message"
                        :key="data.message_id + '-m-' + index"
                        :class="View.isMsgInline(item.type) ? 'msg-inline' : ''">
                        <div v-if="item.type === undefined" />
                        <span v-else-if="isDebugMsg" class="msg-text">{{ item }}</span>
                        <button v-else-if="imageFailures[Number(index)]" type="button" class="senera-image-error"
                            @click="retryImage(Number(index))">
                            <font-awesome-icon :icon="['far', 'image']" />
                            <span>{{ $t('加载图片失败') }}</span>
                            <small>{{ $t('重试') }}</small>
                        </button>
                        <template v-else-if="item.type == 'text'">
                            <div v-if="hasMarkdown()" class="msg-md-title" />
                            <ChannelMarkdown v-else-if="!isMe && !isDebugMsg" :source="item.text" />
                            <span v-else v-show="item.text !== ''"
                                class="msg-text" @click="textClick" v-html="textIndex[index]" />
                        </template>
                        <ChannelMarkdown v-else-if="item.type == 'markdown'" :source="item.content" />
                        <img v-else-if="item.type == 'image' && item.file == 'marketface'"
                            :class=" imgStyle(data.message.length, Number(index), true) + ' msg-mface'"
                            :src="item.url"
                            :alt="item.summary"
                            @load="imageLoaded"
                            @error="imageFailed(Number(index))">
                        <img v-else-if="item.type == 'mface'"
                            :class=" imgStyle(data.message.length, Number(index), true) + ' msg-mface'"
                            :src="item.url"
                            :alt="item.summary"
                            @load="imageLoaded"
                            @error="imageFailed(Number(index))">
                        <template v-else-if="item.type == 'image'">
                            <div v-show="shouldShowImagePlaceholder(item, Number(index))"
                                :title="$t('点击加载图片')"
                                :class="imgStyle(data.message.length, Number(index), isFace(item)) + ' msg-img-placeholder'"
                                @click="loadImage(item, Number(index))">
                                <font-awesome-icon
                                    :icon="['fas', imageLoading(getImageKey(Number(index), item.url)) ? 'spinner' : 'image']"
                                    :spin="imageLoading(getImageKey(Number(index), item.url))" />
                                <span>
                                    {{ imageLoading(getImageKey(Number(index), item.url)) ? $t('加载中') : $t('点击加载图片') }}
                                </span>
                            </div>
                            <img v-show="!shouldShowImagePlaceholder(item, Number(index))"
                                loading="lazy" decoding="async"
                                :width="item.width" :height="item.height"
                                :title="(!item.summary || item.summary == '') ? $t('预览图片') : item.summary"
                                :alt="$t('图片')"
                                :class=" imgStyle(data.message.length, Number(index), isFace(item))"
                                :src="getImgSrc(item.url)"
                                data-type="image"
                                @load="imageLoaded"
                                @error="imageFailed(Number(index))"
                                @click="imgClick(item.url)">
                        </template>
                        <template v-else-if="item.type == 'face'">
                            <EmojiFace :emoji="Emoji.get(Number(item.id))" class="msg-face" />
                        </template>
                        <span v-else-if="item.type == 'bface'"
                            style="font-style: italic; opacity: 0.7">
                            [ {{ $t('图片') }}：{{ item.text }} ]
                        </span>
                        <div v-else-if="item.type == 'at'"
                            :class="getAtClass(item.qq)">
                            <a v-user-tooltip="() => getAtMember(item.qq)"
                                :data-id="item.qq"
                                :data-group="data.group_id">
                                {{ getAtName(item) }}
                            </a>
                        </div>
                        <FileAttachment v-else-if="item.type == 'file'"
                            :name="item.name ?? item.file_name ?? $t('未知文件')"
                            :size="item.size ?? item.file_size" :compact="type === 'body'"
                            :pending="Boolean(data.fake_msg)" :sent="isMe && !data.fake_msg"
                            @open="downloadFile(item, data.message_id)" />
                        <div v-else-if="item.type == 'video'"
                            class="msg-video">
                            <video playsinline controls preload="metadata" :src="item.url">
                                现在还有不支持 video tag 的浏览器吗？
                            </video>
                        </div>
                        <template v-else-if="item.type == 'record'">
                            <VoiceMsg
                                :item="item"
                                :message-id="String(data.message_id)"
                                :is-me="isMe" />
                        </template>
                        <template v-else-if="item.type == 'forward'">
                            <div class="msg-raw-forward"
                                @click="openMerge()">
                                <span>{{ $t('合并转发消息') }}</span>
                                <div class="forward-msg">
                                    <template v-if="item.content && item.content.length > 0">
                                        <div v-for="(i, indexItem) in item.content.slice(0, 3)"
                                            :key="'raw-forward-' + indexItem">
                                            {{ i.sender.nickname }}:
                                            <span v-for="(msg, msgIndex) in i.message"
                                                :key="'raw-forward-item-' + msgIndex">
                                                <span v-if="msg.type == 'text'">
                                                    {{ msg.text }}
                                                </span>
                                                <span v-else-if="msg.type == 'image'">
                                                    [{{ $t('图片') }}]
                                                </span>
                                                <span v-else-if="msg.type == 'face' || msg.type == 'bface'">
                                                    [{{ $t('表情') }}]
                                                </span>
                                                <span v-else-if="msg.type == 'file'">
                                                    [{{ $t('文件') }}]{{ msg.data.file }}
                                                </span>
                                                <span v-else-if="msg.type == 'video'">
                                                    [{{ $t('视频') }}]
                                                </span>
                                                <span v-else-if="msg.type == 'record'">
                                                    [{{ $t('语音') }}]
                                                </span>
                                                <span v-else-if="msg.type == 'forward'">
                                                    [{{ $t('聊天记录') }}]
                                                </span>
                                                <span v-else-if="msg.type == 'reply'">
                                                    <!--原版QQ此处不做处理-->
                                                </span>
                                                <span v-else>
                                                    [{{ $t('不支持的消息') }}]
                                                </span>
                                            </span>
                                        </div>
                                    </template>
                                    <div v-else>
                                        {{ $t('加载失败') }}
                                    </div>
                                </div>
                                <div>
                                    <span v-if="item.content !== undefined">
                                        {{ $t('查看 {count} 条转发消息', { count: item.content.length }) }}
                                    </span>
                                    <span v-else>
                                        {{ $t('聊天记录') }}
                                    </span>
                                </div>
                            </div>
                        </template>
                        <template v-else-if="item.type == 'reply'">
                            <QuotePreview v-if="type != 'body'" :message-id="item.id"
                                :source-id="data.message_id" :is-me="isMe && type != 'merge'"
                                :remote="type != 'merge'"
                                @scroll-to-msg="$emit('scrollToMsg', $event)" />
                        </template>
                        <div v-else-if="item.type == 'poke'" v-once :class="showPock()">
                            <font-awesome-icon class="poke-hand" style="margin-right: 5px;" :icon="['fas', 'fa-hand-point-up']" />
                            {{ $t('戳了戳你') }}
                        </div>
                        <span v-else class="msg-unknown">{{ '( ' + $t('不支持的消息') + ': ' + item.type + ' )' }}</span>
                    </div>
                </template>
                <template v-else>
                    <JsonSegComp v-if="data.message.at(0)!.type === 'json'"
                        :data="data.message.at(0)!.data" />
                    <XmlSegComp v-else :id="data.message_id" :item="data.message.at(0)!.data" />
                </template>
                <!-- 链接预览框 -->
                <div v-if="!isDebugMsg && pageViewInfo && Object.keys(pageViewInfo).length > 0"
                    :class="'msg-link-view ' + linkViewStyle">
                    <template v-if="pageViewInfo.type == undefined">
                        <div :class="'bar' + (isMe ? ' me' : '')" />
                        <div>
                            <img v-if="pageViewInfo.img !== undefined"
                                :id="data.message_id + '-linkview-img'"
                                alt="预览图片"
                                title="查看图片"
                                :src="pageViewInfo.img"
                                @load="linkViewPicFin"
                                @error="linkViewPicErr"
                                @click="preImgClick(pageViewInfo.img)">
                            <div class="body">
                                <p v-show="pageViewInfo.site">
                                    {{ pageViewInfo.site }}
                                </p>
                                <span :href="pageViewInfo.url">{{
                                    pageViewInfo.title
                                }}</span>
                                <span>{{ pageViewInfo.desc }}</span>
                            </div>
                        </div>
                    </template>
                    <template v-else>
                        <!-- 特殊 URL 的预览 -->
                        <div v-if="pageViewInfo.type == 'bilibili'"
                            class="link-view-bilibili"
                            @click="openLink(pageViewInfo.url)">
                            <div class="user">
                                <img :src="pageViewInfo.data.owner.face">
                                <span>{{ pageViewInfo.data.owner.name }}</span>
                                <a>{{ dateTimeFormat(trueLang, {
                                    year: 'numeric',
                                    month: 'numeric',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: 'numeric'
                                }).format(getViewTime(pageViewInfo.data.public)) }}</a>
                            </div>
                            <img :src="pageViewInfo.data.pic">
                            <span>{{ pageViewInfo.data.title }}</span>
                            <a>{{ pageViewInfo.data.desc }}</a>
                            <div class="data">
                                <font-awesome-icon :icon="['fas', 'play']" />
                                {{ pageViewInfo.data.stat.view }}
                                <font-awesome-icon :icon="['fas', 'coins']" />
                                {{ pageViewInfo.data.stat.coin }}
                                <font-awesome-icon :icon="['fas', 'star']" />
                                {{ pageViewInfo.data.stat.favorite }}
                                <font-awesome-icon :icon="['fas', 'thumbs-up']" />
                                {{ pageViewInfo.data.stat.like }}
                            </div>
                        </div>
                        <div v-else-if="pageViewInfo.type == 'music163'" style="width: 100%;">
                            <div class="link-view-music163">
                                <div>
                                    <a>{{ pageViewInfo.data.info.name }}
                                        <a v-if="pageViewInfo.data.info.free != null">{{ $t('（试听）') }}</a>
                                    </a>
                                    <span>{{ pageViewInfo.data.info.author.join('/') }}</span>
                                </div>
                                <img :src="pageViewInfo.data.cover">
                                <font-awesome-icon
                                    :icon="['fas', 'play']"
                                    :class="{ light: pageViewInfo.data.cover_light }"
                                    @click="sendPlay({
                                        title: pageViewInfo.data.info.name,
                                        author: pageViewInfo.data.info.author,
                                        url: pageViewInfo.data.play_link,
                                        type: 'music163',
                                        cover: pageViewInfo.data.cover,
                                        free: pageViewInfo.data.info.free,
                                        time: pageViewInfo.data.info.time,
                                        data: pageViewInfo.data.id,
                                    })" />
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        </QQMessageFrame>
        <div v-if="data.fake_msg == true"
            :class="'sending right' + (isMe ? ' me' : '')">
            <font-awesome-icon :icon="['fas', 'spinner']" />
        </div>
        <div v-if="data.emoji_like?.length"
            :class="'emoji-like' + (isMe ? ' me' : '')">
            <div class="emoji-like-body">
                <TransitionGroup name="emoji-like">
                    <template v-for="info, id in data.emojis" :key="'respond-' + data.message_id + '-' + id">
                        <button type="button" :disabled="!authStore.jsonMap.send_respond?.name" :class="{
                            'me-send': info.includes(authStore.loginInfo.uin),
                        }" @click="react(Number(id))">
                            <EmojiFace :emoji="Emoji.get(Number(id))!" />
                            <span>{{ info.length }}</span>
                        </button>
                    </template>
                </TransitionGroup>
            </div>
        </div>
        <code style="display: none">{{ data.raw_message }}</code>
    </div>
</template>

<script setup lang="ts">
import { userAvatar } from '@renderer/runtime/seneraIdentity'
import Option from '@renderer/function/option'
import { toggleMessageReaction } from '@renderer/function/messageAnnotations'
import { dateTimeFormat } from '@renderer/runtime/time'
import ChannelMarkdown from './ChannelMarkdown.vue'
import FileAttachment from './FileAttachment.vue'
import { addDownloadTask } from './FileManager.vue'

import { MsgBodyFuns as ViewFuns } from '@renderer/function/model/msg-body'
import { computed, onMounted, nextTick, provide, inject, useTemplateRef, ref } from 'vue'
import { Connector } from '@renderer/function/connect'
import { useSettingsStore } from '@renderer/state/settings'
import { Logger, LogType, PopInfo, PopType } from '@renderer/function/base'
import { getMsgRawTxt, pokeAnime } from '@renderer/function/utils/msgUtil'
import {
    isRobot,
    openLink,
	vMenu,
	vMove,
	VMoveOptions,
} from '@renderer/function/utils/appUtil'
import { vUserTooltip } from '@renderer/function/tooltip'
import {
    getForegroundToneGridFromImageUrl,
    getTrueLang,
    getViewTime } from '@renderer/function/utils/systemUtil'
import { linkView } from '@renderer/function/utils/linkViewUtil'
import { MenuEventData, MergeStackData } from '@renderer/function/elements/information'
import { i18n } from '@renderer/main'
import { useUIStore } from '@renderer/state/ui'
import { useAuthStore } from '@renderer/state/auth'
import { useContactStore } from '@renderer/state/contact'
import { useChatStore } from '@renderer/state/chat'

const uiStore = useUIStore()
const authStore = useAuthStore()
const contactStore = useContactStore()
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
import Emoji from '@renderer/function/model/emoji'
import EmojiFace from './EmojiFace.vue'
import LazyLottie from './LazyLottie.vue'
import { Img } from '@renderer/function/model/img'
import JsonSegComp from './msg-component/JsonSegComp.vue'
import XmlSegComp from './msg-component/XmlSegComp.vue'
import VoiceMsg from './VoiceMsg.vue'
import QuotePreview from './QuotePreview.vue'
import QQMessageFrame from './QQMessageFrame.vue'
import { addMusic, MusicInfo } from './MusicPlayer.vue'

type Msg = any
type IUser = any

defineOptions({ name: 'MsgBody' })

const $t = i18n.global.t

async function react(id: number) {
    try { await toggleMessageReaction(data, id) }
    catch (reason) { new PopInfo().add(PopType.ERR, reason instanceof Error ? reason.message : String(reason)) }
}

const {
    data,
    selected,
    type,
    globalMe,
    imageListHeader,
    idPrefix,
} = defineProps<{
    data: any
    selected?: boolean
    type?: 'merge' | 'body'
    globalMe?: string
    imageListHeader?: Img | undefined
    idPrefix?: string
}>()

provide('message-content', data)

const { viewer: viewerRef } = inject<{ viewer: any }>('viewer', { viewer: null })

const emit = defineEmits<{
    scrollToMsg: [...args: any[]]
    imageLoaded: [...args: any[]]
    sendPoke: [...args: any[]]
    leftMove: [msg: Msg]
    rightMove: [msg: Msg]
    showMenu: [event: MenuEventData, msg: Msg]
}>()

const msgMain = useTemplateRef<HTMLDivElement>('msgMain')

const moveOptions: VMoveOptions<HTMLDivElement> = {
    enabled: () => !uiStore.openSideBar,
    moveHook: (_, move: number) => {
        const target = msgMain.value!
        target.style.transform = 'translateX(' + move + 'px)'
    },
    endHook: (_) => {
        const target = msgMain.value!

        target.style.transform = ''
        target.style.transition = 'all 0.3'
    },
    leftLimit: {
        value: 72,
        type: 'px'
    },
    rightLimit: {
        value: 72,
        type: 'px'
    },
    moveCondition: {
        minMove: {
            value: 64,
            type: 'px'
        }
    }
}

//#endregion

//#region == 响应式状态 ================================================================

const View = ViewFuns
const isMe = computed(() => globalMe ? globalMe === 'Y' : Number(authStore.loginInfo.uin) === Number(data.sender.user_id))
const isDebugMsg = Option.get('debug_msg')
const linkViewStyle = ref('')
const pageViewInfo = ref(undefined as { [key: string]: any } | undefined)
const gotLink = ref(false)
const senderInfo = computed(() => chatStore.chatInfo.info.group_members.find(item => item.user_id == data.sender.user_id))
const senderName = computed(() => data.sender.card || data.sender.nickname ||
    (isMe.value ? authStore.loginInfo.nickname : chatStore.chatInfo.show.name))
const senderTag = computed(() => {
    if (chatStore.chatInfo.show.type !== 'group') return undefined
    if (senderInfo.value?.title) return senderInfo.value.title.replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    if (senderInfo.value?.role === 'owner') return $t('群主')
    if (senderInfo.value?.role === 'admin') return $t('管理员')
    return undefined
})
const senderTagColor = computed(() => senderInfo.value?.title ? 'purple' :
    senderInfo.value?.role === 'owner' ? 'orange' : 'blue')
const mediaOnly = computed(() => data.message.length > 0 && data.message.every((item: { type: string }) =>
    ['image', 'mface', 'face', 'file', 'video', 'forward'].includes(item.type)))
const trueLang = getTrueLang()
const textIndex = ref({} as { [key: string]: number })
const manualImageLoads = ref({} as Record<string, boolean>)
const pendingImageLoads = ref({} as Record<string, boolean>)
const imageFailures = ref<Record<number, boolean>>({})

//#endregion

//#region == 工具函数 ================================================================

function getAtMember(id: number): IUser | number {
    const re = getUserById(id) ?? id
    return re
}
function getUserById(id: number): IUser | undefined {
    if (chatStore.chatInfo.show.type === 'group') {
        if (!chatStore.chatInfo.info.group_members) return id
        const user = chatStore.chatInfo.info.group_members.find((item: IUser) => item.user_id == id)
        if (user) return user
        else return id
    }else {
        const user = contactStore.userList.find((item: IUser) => item.user_id === id)
        if (user) return user
        else return id
    }
}

//#endregion

//#region == 方法函数 ================================================================

function getImgSrc(url: string): string {
    return url
}

function getImageKey(index: number, url: string) {
    return `${data.message_id}-${index}-${url}`
}

function imageLoading(key: string) {
    return pendingImageLoads.value[key] === true
}

function shouldShowImagePlaceholder(item: { type: string, url: string }, index: number) {
    if (item.type !== 'image') return false
    if (settingsStore.sysConfig.opt_no_auto_load_image !== true) return false

    return manualImageLoads.value[getImageKey(index, item.url)] !== true
}

function getAtClass(who: number | string) {
    let back = 'msg-at'
    if (isMe.value && type != 'merge') {
        back += ' me'
    }
    if (authStore.loginInfo.uin == who || who == 'all') {
        back += ' atme'
    }
    return back
}

function getAtName(item: { [key: string]: any }) {
    if (item.qq == 'all') {
        return '@' + $t('全体成员')
    }
    if (item.text != undefined) {
        return item.text
    } else {
        for (let i = 0; i < chatStore.chatInfo.info.group_members.length; i++) {
            const user = chatStore.chatInfo.info.group_members[i]
            if (user.user_id == Number(item.qq)) {
                return ('@' + (user.card != '' && user.card != null? user.card: user.nickname))
            }
        }
        return '@' + item.qq
    }
}

function imgStyle(length: number, at: number, isFace: boolean) {
    let style = 'msg-img'
    if (type == 'body') {
        return style
    }
    if (isFace) {
        style += ' face'
    }
    if (length === 1) {
        return (style += ' alone')
    }
    if (at === 0) {
        return (style += ' top')
    }
    if (at === length - 1) {
        return (style += ' button')
    }
    return style
}

function imgClick(url: string) {
    if (viewerRef?.value && imageListHeader) {
        viewerRef.value.openBySrc(imageListHeader, url)
    }
}

async function loadImage(item: { url: string }, index: number) {
    const key = getImageKey(index, item.url)
    if (manualImageLoads.value[key] || pendingImageLoads.value[key]) return

    pendingImageLoads.value[key] = true
    try {
        manualImageLoads.value[key] = true
    } finally {
        pendingImageLoads.value[key] = false
    }
}

function preImgClick(img: string) {
    if (viewerRef?.value) {
        viewerRef.value.open(new Img(img))
    }
}

async function imageLoaded(event: Event) {
    const img = event.target as HTMLImageElement

    const vh = document.documentElement.clientHeight || document.body.clientHeight
    const imgHeight = img.naturalHeight || img.height
    let imgWidth = img.naturalWidth || img.width

    const aspectRatio = imgHeight / imgWidth

    if (aspectRatio > 2.5) {
        img.classList.add('long-img')
        try {
            const picLight = ( await getForegroundToneGridFromImageUrl(img.src, 0.4))[1][1] === 'light'
            if(picLight) {
                img.classList.add('light')
            }
        } catch {
            // do nothing
        }
    } else {
        if (imgHeight > vh * 0.35)
            imgWidth = (imgWidth * (vh * 0.35)) / imgHeight
    }

    img.style.setProperty('--width', `${imgWidth}px`)
    emit('imageLoaded', img.offsetHeight)
}

function imageFailed(index: number) {
    imageFailures.value[index] = true
    emit('imageLoaded', 0)
}

function retryImage(index: number) {
    delete imageFailures.value[index]
}

async function parseText(index: number) {

    if (!isMe.value && !isDebugMsg) return

    let text = data.message[index].text

    const logger = new Logger()
    text = ViewFuns.parseText(text)
    const filtedText = text.replace(/(.)(\1{10,})/g, '$1<span style="opacity:0.7;margin-right:10px;">...</span>')
    if(filtedText != text) {
        const style = 'display:block;margin-top:10px;opacity:0.7;cursor:pointer;'
        text = filtedText + '<a style="' + style +'" data-raw="' + text + '" onclick="this.parentNode.innerText = this.dataset.raw;return false;">' + $t('显示原始消息') + '</a>'
    }

    if(type == 'body') {
        textIndex.value[index] = text
        return
    }

    const reg = /(http|https):\/\/[\w\-_]+(\.[\w\-_]+)+([\w\-.,@?^=%&:/~+#]*[\w\-@?^=%&/~+#])?/gi
    text = text.replaceAll(reg, '<a href="" data-link="$&" onclick="return false">$&</a>')
    const linkList = text.match(reg)
    if (linkList !== null && !gotLink.value && !isDebugMsg) {
        void (async() => {
            gotLink.value = true
            const fistLink = linkList[0]
            let protocol = ''
            let domain = ''
            try {
                protocol = new URL(fistLink).protocol + '//'
                domain = new URL(fistLink).hostname
            } catch (ignore) {
                // ignore
            }

            let linkData = null as any
            const finaLink = fistLink
            const showLinkList = {
                bilibili: ['bilibili.com', 'b23.tv', 'bili2233.cn', 'acg.tv'],
                music163: ['music.163.com', '163cn.tv'],
            }
            for (const key of Object.keys(showLinkList) as (keyof typeof showLinkList)[]) {
                if (showLinkList[key].some((item: string) => finaLink.includes(item))) {
                    linkData = await linkView[key](finaLink)
                }
            }
            if(!linkData) {
                if (import.meta.env.VITE_APP_LINK_VIEW) {
                    const response = await fetch(`${import.meta.env.VITE_APP_LINK_VIEW}/${encodeURIComponent(fistLink)}`)
                    if(response.ok) {
                        if (!response.headers.get('content-type')?.includes('application/json')) {
                            throw new Error('链接预览服务返回的内容不是 JSON')
                        }
                        const res = await response.json()
                        if (res.status === undefined && Object.keys(res).length > 0) {
                            linkData = res
                        }
                    }
                }
            }

            logger.add(LogType.DEBUG, 'Link View: ', linkData)
            if(linkData) {
                loadLinkPreview(protocol + domain, linkData)
            }
        })().catch(error => logger.error(error, '无法加载链接预览'))
    }
    textIndex.value[index] = text
}

function loadLinkPreview(domain: string, res: any) {
    const logger = new Logger()
    logger.debug('获取链接预览成功: ' + res['og:title'])
    if(res != undefined) {
        if (res.type == undefined) {
            if(Object.keys(res).length > 0) {
                let imgUrl = res['og:image']
                if (imgUrl && !imgUrl.startsWith('http') && !imgUrl.startsWith('www')) {
                    imgUrl = new URL(imgUrl.startsWith('/') ? imgUrl : '/' + imgUrl, domain).toString()
                }
                const pageData = {
                    site: res['og:site_name'] === undefined ? '' : res['og:site_name'],
                    title: res['og:title'] === undefined ? '' : res['og:title'],
                    desc: res['og:description'] === undefined ? '' : res['og:description'],
                    img: imgUrl,
                    link: res['og:url'],
                }
                pageViewInfo.value = pageData
            }
        } else {
            pageViewInfo.value = res
        }
    }
}

function linkViewPicFin() {
    const img = document.getElementById(
        data.message_id + '-linkview-img',
    ) as HTMLImageElement
    if (img !== null) {
        const w = img.naturalWidth
        const h = img.naturalHeight
        if (w > h) {
            linkViewStyle.value = 'large'
        }
    }
}
function linkViewPicErr() {
    if(pageViewInfo.value)
        pageViewInfo.value.img = undefined
}

function hiddenUserInfo() {
    if (chatStore.chatInfo.info.now_member_info !== undefined) {
        chatStore.chatInfo.info.now_member_info = undefined
    }
}

function downloadFile(fileData: any, message_id: string) {
    if (typeof fileData.url === 'string') {
        addDownloadTask({
            url: fileData.url,
            fileName: fileData.name ?? fileData.file_name,
            fileSize: fileData.size ?? fileData.file_size ?? 0,
            filePath: '',
            onError: error => new PopInfo().add(PopType.ERR, $t('文件下载失败') + '：' + error),
        })
        return
    }
    let name = authStore.jsonMap.file_download?.private_name
    if(chatStore.chatInfo.show.type == 'group') {
        name = authStore.jsonMap.file_download?.name
    }
    Connector.send(name, {
        file_id: fileData.file_id,
        group_id: chatStore.chatInfo.show.type == 'group' ? chatStore.chatInfo.show.id : undefined,
    },
        'downloadFile_' + message_id + '_' + btoa(encodeURIComponent(fileData.name ?? fileData.file_name)),
    )
}

function textClick(event: Event) {
    const target = event.target as HTMLElement
    if (target.dataset.link) {
        const link = target.dataset.link
        openLink(link)
    }
}

function hasCard() {
    let hasCard = false
    data.message.forEach((item: any) => {
        if (item.type === 'json' || item.type === 'xml') {
            hasCard = true
        }
    })
    return hasCard
}

function hasMarkdown() {
    let hasMarkdown = false
    data.message.forEach((item: any) => {
        if (item.type === 'markdown') {
            hasMarkdown = true
        }
    })
    return hasMarkdown
}

function sendPoke() {
    emit('sendPoke', data.sender.user_id)
}

async function showPock() {
    if (data.message_id ==
        chatStore.messageList[chatStore.messageList.length - 1].message_id &&
        (new Date().getTime() - getViewTime(data.time)) / 1000 < 5) {
        const item = document.getElementById('app')
        nextTick(() => {
            pokeAnime(item)
        })
    }
}

function isSuperFaceMsg() {
    if (settingsStore.sysConfig.use_super_face === false) return false
    if (data.message.length !== 1) return false
    const seg = data.message.at(0)
    if (seg.type !== 'face') return
    return Emoji.allSuperList.has(Number(seg.id))
}

function sendPlay(info: MusicInfo) {
    addMusic(info, 'current', true)
}

function openMerge(){
    const seg = data.message[0]
    if (!seg.content) {
        new PopInfo().add(PopType.ERR, $t('合并转发解析失败'))
        return
    }

    const mergeData: MergeStackData = {
        messageList: [],
        imageList: [],
        placeCache: 0,
        forwardMsg: data
    }

    mergeData.messageList = seg.content
    const imgList = [] as {
        index: number
        message_id: string
        img_url: string
    }[]
    let index = 0
    mergeData.messageList.forEach((item) => {
        item.message.forEach((msg: { type: string; url: string }) => {
            if (msg.type == 'image') {
                imgList.push({
                    index: index,
                    message_id: item.message_id,
                    img_url: msg.url,
                })
                index++
            }
        })
    })
    mergeData.imageList = imgList

    chatStore.mergeMsgStack.push(mergeData)
}

function isFace(item: any) {
    if (item.asface) return true
    else if (item.subType == 7) return true
    else if (item.subType == 1) return true
    else if (item.sub_type == 7) return true
    else if (item.sub_type == 1) return true
    return false
}

//#endregion

//#region == 生命周期 ================================================================

onMounted(() => {
    for (let i = 0; i < data.message.length; i++) {
        const item = data.message[i]
        if(item.type == 'text') {
            parseText(i)
        }
    }
})

//#endregion
</script>
<style>
    .emoji-like {
        flex-direction: row;
        display: flex;
        width: 100%;
    }
    .emoji-like-body {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        max-width: 30%;
        margin-left: 50px;
        margin-top: 10px;
    }
    .emoji-like-body > button {
        display: inline-flex;
        align-items: center;
        border: 1px solid transparent;
        font: inherit;
        cursor: pointer;
        background: var(--color-card-1);
        border-radius: 7px;
        margin-right: 5px;
        padding: 5px 15px;
        margin-bottom: 5px;
    }
    .emoji-like-body img {
        width: 15px;
        height: 15px;
    }
    .emoji-like-body span {
        color: var(--color-font-2);
        margin-left: 10px;
        font-size: 0.8rem;
    }
    .emoji-like-body .emoji {
        width: 20px;
        height: 20px;
        font-size: 1rem;
        margin: 0;
    }
    .emoji-like-body > button.me-send{
        background-color: var(--qq-tag_blue_bg);
        border-color: var(--client-accent);
    }
    .emoji-like-body > button.me-send:hover {
        background: var(--client-selected);
    }
    .emoji-like-body > button.me-send span {
        color: var(--client-accent);
    }

    @media (min-width: 992px) {
        .emoji-like.me {
            flex-direction: row-reverse;
        }
        .emoji-like.me > div.emoji-like-body {
            flex-direction: row-reverse;
            margin-right: -5px;
        }
    }

    .link-view-bilibili {
        flex-direction: column;
        cursor: pointer;
        width: 100%;
    }
    .link-view-bilibili > div.user {
        display: flex;
        align-items: center;
        margin-bottom: 10px;
    }
    .link-view-bilibili > div.user > img {
        width: 20px;
        border-radius: 100%;
        border: 2px solid transparent;
        outline: 2px solid var(--color-card);
    }
    .link-view-bilibili > div.user > span {
        flex: 1;
        margin-left: 10px;
        margin-right: 40px;
    }
    .link-view-bilibili > div.user > a {
        color: var(--color-font-2);
        font-size: 0.8rem;
    }
    .link-view-bilibili > img {
        margin-bottom: 10px;
        max-width: 100% !important;
        max-height: 30vh !important;
        width: fit-content;
        object-fit: contain;
    }
    .link-view-bilibili > a {
        color: var(--color-font-2) !important;
        font-size: 0.8rem;
        max-height: 4rem;
        overflow-y: scroll;
    }
    .link-view-bilibili > a::-webkit-scrollbar {
        background: transparent;
    }
    .link-view-bilibili > div.data {
        display: flex;
        flex-direction: row;
        align-items: center;
        font-size: 0.8rem;
        margin-top: 10px;
        justify-content: space-around;
        opacity: 0.7;
    }

    .link-view-music163 {
        width: calc(100% + 60px);
        margin-right: -60px;
        display: flex;
    }
    .link-view-music163 div {
        display: flex;
        flex-direction: column;
        flex: 1;
    }
    .link-view-music163 img {
        width: 60px;
        height: 60px;
        border-radius: 7px;
        margin-left: 20px;
    }
    .link-view-music163 a {
        text-wrap: nowrap;
        font-weight: bold;
        margin: 0;
    }
    .link-view-music163 span {
        text-wrap: nowrap;
        font-size: 0.8rem;
        opacity: 0.7;
    }
    .link-view-music163 svg {
        --size: 20px;
        color: #545454;
        width: var(--size);
        height: var(--size);
        padding: calc(calc(60px - var(--size)) / 2);
        transform: translateX(-100%);
    }
    .link-view-music163 svg.light {
        color: #e5e5e5;
    }
</style>
