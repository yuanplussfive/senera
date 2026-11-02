<!--
 * @FileDescription: 表情面板模板
 * @Author: Stapxs
 * @Date: missing
 * @Version: 1.0
-->

<template>
    <div class="ss-card face-pan">
        <div class="face-tabs" role="tablist" :aria-label="$t('表情')">
            <button type="button" role="tab" :aria-selected="selectedTab === 'emoji'"
                :aria-controls="`${pickerId}-emoji`" :id="`${pickerId}-emoji-tab`"
                :aria-label="$t('表情')" @click="selectedTab = 'emoji'">
                <font-awesome-icon :icon="['fas', 'face-laugh-squint']" />
            </button>
            <button type="button" role="tab" :aria-selected="selectedTab === 'stickers'"
                :aria-controls="`${pickerId}-stickers`" :id="`${pickerId}-stickers-tab`"
                :aria-label="$t('收藏的表情')" @click="selectedTab = 'stickers'">
                <font-awesome-icon :icon="['fas', 'heart']" />
            </button>
        </div>
        <div class="face-content">
            <div v-show="selectedTab === 'emoji'" :id="`${pickerId}-emoji`" class="face-page"
                role="tabpanel" :aria-labelledby="`${pickerId}-emoji-tab`">
                <div class="system-face-bar">
                    <template v-if="recentEmojisList.length > 0">
                        <div class="title">
                            <span>{{ $t('最近使用') }}</span>
                        </div>
                        <div class="face">
                            <template
                                v-for="num in recentEmojisList"
                                :key="num">
                                <div>
                                    <EmojiFace
                                        :emoji="Emoji.get(num)"
                                        @click="addBaseFace(num)" />
                                </div>
                            </template>
                        </div>
                    </template>
                    <div class="title">
                        <span>{{ $t('超级表情') }}</span>
                    </div>
                    <div class="face">
                        <template v-for="num in Emoji.superList" :key="num">
                            <div>
                                <EmojiFace
                                    :emoji="Emoji.get(num)"
                                    @click="addBaseFace(num)" />
                            </div>
                        </template>
                    </div>
                    <div class="title">
                        <span>{{ $t('小黄脸表情') }}</span>
                    </div>
                    <div class="face">
                        <template v-for="num in Emoji.normalList" :key="num">
                            <div>
                                <EmojiFace
                                    :emoji="Emoji.get(num)"
                                    @click="addBaseFace(num)" />
                            </div>
                        </template>
                    </div>
                    <div class="title">
                        <span>{{ $t('emoji 表情') }}</span>
                    </div>
                    <div class="face">
                        <div
                            v-for="num in Emoji.emojiList"
                            :key="num">
                            <EmojiFace
                                :emoji="Emoji.get(num)"
                                @click="addBaseFace(num)" />
                        </div>
                    </div>
                </div>
            </div>
            <div v-show="selectedTab === 'stickers'" :id="`${pickerId}-stickers`" class="face-page"
                role="tabpanel" :aria-labelledby="`${pickerId}-stickers-tab`">
                <div class="system-face-bar custom-face-bar" @scroll="stickersScroll">
                    <template v-if="recentCustomFacesList.length > 0">
                        <div class="title">
                            <span>{{ $t('最近使用') }}</span>
                        </div>
                        <div class="face">
                            <span
                                v-for="(url, num) in recentCustomFacesList"
                                :key="num"
                                v-tooltip="customFaceTooltip(url)">
                                <img
                                    loading="lazy"
                                    :src="url"
                                    :alt="'[' + $t('动画表情') + ']'"
                                    @click="addImgFace(url)">
                            </span>
                        </div>
                    </template>
                    <div class="title">
                        <span>{{ $t('收藏的表情') }}</span>
                        <font-awesome-icon
                            :icon="['fas', 'fa-rotate-right']"
                            @click="reloadRoamingStamp" />
                    </div>
                    <div class="face">
                        <div v-if="stickerStore.stickerCache && stickerStore.stickerCache.length <= 0"
                            class="ss-card">
                            <font-awesome-icon :icon="['fas', 'face-dizzy']" />
                            <span>{{ $t('一无所有') }}</span>
                        </div>
                        <template v-else-if="stickerStore.stickerCache && stickerStore.stickerCache.length > 0">
                            <span v-for="(url, index) in stickerStore.stickerCache" :key="'stickers-' + index">
                                <img
                                    v-show="url != 'end'"
                                    v-tooltip="customFaceTooltip(url)"
                                    loading="lazy"
                                    :src="url"
                                    :alt="'[' + $t('动画表情') + ']'"
                                    @click="addImgFace(url)">
                            </span>
                        </template>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    MsgItemElem,
} from '@renderer/function/elements/information'
import { computed, ComputedRef, Ref, ShallowRef, shallowRef, useId } from 'vue'
import { Connector } from '@renderer/function/connect'
import Emoji from '@renderer/function/model/emoji'
import EmojiFace from './EmojiFace.vue'
import { VueCompData } from '@renderer/function/elements/vueComp'
import CustomFaceTooltip from './tooltip/CustomFaceTooltip.vue'
import { useLocalStorage, vTooltip } from '@renderer/function/utils/appUtil'
import { useStickerStore } from '@renderer/state/sticker'
import { useSettingsStore } from '@renderer/state/settings'
import { useAuthStore } from '@renderer/state/auth'

const { recordList: recentEmojisId, showList: recentEmojisList } =
    getRecentEmojiRecord<number>('recent-emojis-id')
const { recordList: recentCustomFacesId, showList: recentCustomFacesList } =
    getRecentEmojiRecord<string>('recent-custom-faces-id')
const stickerStore = useStickerStore()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const pickerId = useId()
const selectedTab = shallowRef<'emoji' | 'stickers'>('emoji')

const stickerPage = shallowRef(1)

const emit = defineEmits<{
    addSpecialMsg: [data: MsgItemElem],
    sendMsg: [echo?: string]
}>()

// 加载漫游表情
if (
    stickerStore.stickerCache && stickerStore.stickerCache.length == 0 &&
    authStore.jsonMap.roaming_stamp
) {
    reloadRoamingStamp()
}
function addSpecialMsg(segment: MsgItemElem) {
    emit('addSpecialMsg', segment)
}
function addBaseFace(id: number) {
    recordRecentEmoji(recentEmojisId, id)
    if (id < 5000)
        addSpecialMsg({ type: 'face', id: id })
    else
        addSpecialMsg({ type: 'text', text: Emoji.get(id)!.value })
}

//#region == 漫游表情相关函数 ===========
function reloadRoamingStamp() {
    stickerStore.stickerCache = undefined
    if (authStore.jsonMap.roaming_stamp.pagerType == 'full') {
        // 全量分页，返回所有内容
        Connector.send(
            authStore.jsonMap.roaming_stamp.name,
            { count: 48 },
            'getRoamingStamp_48',
        )
    } else {
        // 默认不分页，返回所有内容
        Connector.send(
            authStore.jsonMap.roaming_stamp.name,
            {},
            'getRoamingStamp',
        )
    }
}
function stickersScroll(e: Event) {
    const target = e.target as HTMLDivElement
    // 如果滚到了底部
    if (
        target.scrollHeight - target.scrollTop <
        target.clientHeight + 0.5
    ) {
        if (stickerStore.stickerCache) {
            if (authStore.jsonMap.roaming_stamp.pagerType == 'full' &&
                stickerStore.stickerCache[stickerStore.stickerCache.length - 1] != 'end') {
                const count = 48 + 48 * stickerPage.value
                // 全量分页，返回所有内容（napcat 行为）
                Connector.send(
                    authStore.jsonMap.roaming_stamp.name,
                    { count: count },
                    'getRoamingStamp_' + count,
                )
                stickerPage.value++
            }
        }
    }
}
function addImgFace(url: string) {
    recordRecentEmoji(recentCustomFacesId, url)
    addSpecialMsg(
        { type: 'image', file: url, subType: 1 },
    )
    // 直接发送表情
    if(settingsStore.sysConfig.send_face == true) {
        emit('sendMsg')
    }
}
//#endregion



//#region == 最近表情相关函数 ===========
function getRecentEmojiRecord<T>(storeId: string): {
    recordList: Ref<T[]>
    showList: ComputedRef<T[]>
} {
    const recordList = useLocalStorage<T[]>(storeId, [])
    const showList = computed(() => {
        if (settingsStore.sysConfig.record_recent_emoji === 'none') {
            return []
        } else if (settingsStore.sysConfig.record_recent_emoji === 'order') {
            return recordList.value.slice(0, 30)
        } else {
            const timesMap = new Map<T, number>()
            for (const id of recordList.value) {
                timesMap.set(id, (timesMap.get(id) || 0) + 1)
            }
            return Array.from(timesMap.entries())
                .sort((a, b) => b[1] - a[1])
                .map((entry) => entry[0])
                .slice(0, 30)
        }
    })

    return {
        recordList,
        showList,
    }
}

function recordRecentEmoji<T>(recordList: ShallowRef<T[]>, id: T) {
    if (settingsStore.sysConfig.record_recent_emoji === 'none') return
    let limit: number
    switch (settingsStore.sysConfig.record_recent_emoji) {
        case 'order':
            limit = 30
            break
        case '100times':
            limit = 100
            break
        case '500times':
            limit = 500
            break
        default:
            throw new Error('Invalid recent emoji record setting')
    }
    const list = recordList.value
    if (settingsStore.sysConfig.record_recent_emoji === 'order') {
        const index = list.indexOf(id)
        if (index !== -1) {
            list.splice(index, 1)
        }
    }
    list.unshift(id)
    if (list.length > limit) {
        list.pop()
    }
    recordList.value = list
}
//#endregion

function customFaceTooltip(url: string): VueCompData<typeof CustomFaceTooltip> {
    return {
        comp: CustomFaceTooltip,
        props: { url }
    }
}
</script>

<style scoped>
.ss-card.face-pan {
    box-sizing: border-box;
    padding: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.face-tabs {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-card-2);
}
.face-tabs button {
    display: grid;
    place-items: center;
    width: 36px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    color: var(--color-font-2);
    background: transparent;
    cursor: pointer;
}
.face-tabs button:hover,
.face-tabs button[aria-selected='true'] {
    color: var(--color-main);
    background: var(--color-card-2);
}
.face-tabs button:focus-visible {
    outline: 1px solid var(--color-main);
    outline-offset: 2px;
}
.face-tabs svg { width: 18px; height: 18px; }
.face-content,
.face-page { display: flex; flex: 1; min-height: 0; }
.face-pan .system-face-bar {
    height: auto;
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 10px 0;
    scrollbar-gutter: stable;
}
.face-pan .face {
    grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
    padding: 4px 8px 10px;
}
.face-pan .face > div {
    width: 36px;
    height: 36px;
    margin: 3px auto;
    border-radius: 6px;
    background: transparent;
}
.face-pan .face > div:hover { background: var(--color-card-2); }
.face-pan .face > div > :deep(.emoji-face) {
    width: 28px;
    height: 28px;
    margin: 0;
}
.face-pan .custom-face-bar .face {
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
}
.face-pan .custom-face-bar .face > span {
    width: 60px;
    height: 60px;
    margin: 2px auto;
}
</style>
