<!-- The dressing preview uses the same FakeQQ QText component and appearance tokens as real chat. AGPL-3.0-only. -->
<template>
    <div class="qq-dressing">
        <nav class="qq-dress-tabs" aria-label="装扮分类">
            <button
                v-for="tab in tabs"
                :key="tab.id"
                type="button"
                :class="{ active: category === tab.id }"
                :aria-pressed="category === tab.id"
                @click="selectCategory(tab.id)"
            >
                {{ tab.name }}
            </button>
        </nav>
        <div v-if="category !== 'profile'" class="qq-dress-preview" :style="previewBackground">
            <header>
                <span>{{ previewAgent?.name }}</span
                ><small>效果预览</small>
            </header>
            <div class="senera-message qq-preview-message">
                <QText
                    class="senera-message-frame"
                    :name="previewAgent?.name ?? ''"
                    :avatar="userAvatar(previewAgent?.qqUserId)"
                    is-bot
                    >今天也有好心情。</QText
                >
            </div>
            <div class="senera-message qq-preview-message">
                <QText
                    class="senera-message-frame"
                    :style="previewTokens"
                    self
                    :name="seneraProfile?.name ?? ''"
                    :avatar="userAvatar(directory?.operatorId)"
                    >换个装扮，换个心情。</QText
                >
            </div>
        </div>
        <div v-else class="qq-dress-profile-preview" :style="previewBackground">
            <div>
                <img :src="userAvatar(directory?.operatorId)" alt="" /><strong>{{ seneraProfile?.name }}</strong
                ><span>个人资料</span>
            </div>
        </div>
        <div class="qq-dress-toolbar">
            <div>
                <strong>{{ selectedName }}</strong
                ><small>{{ applied ? '使用中' : '预览中' }}</small>
            </div>
            <button type="button" class="qq-dress-apply" :disabled="applied || busy" @click="apply">
                {{ applied ? '已应用' : '应用装扮' }}
            </button>
        </div>
        <section class="qq-dress-collection">
            <h3>{{ category === 'bubble' ? '精选气泡' : '简约背景' }}<small>本地装扮 · 免费使用</small></h3>
            <div class="qq-dress-grid">
                <button
                    v-for="item in catalogue"
                    :key="item.id"
                    type="button"
                    class="qq-dress-tile"
                    :class="{ selected: !customPreview && selected === item.id }"
                    :aria-pressed="!customPreview && selected === item.id"
                    @click="select(item.id)"
                >
                    <div class="qq-dress-swatch" :style="swatch(item.id)">
                        <span v-if="category === 'bubble'">你好呀</span
                        ><font-awesome-icon v-else :icon="['far', 'image']" />
                    </div>
                    <span>{{ item.name }}</span
                    ><font-awesome-icon v-if="!customPreview && selected === item.id" :icon="['fas', 'circle-check']" />
                </button>
            </div>
        </section>
        <section v-if="category !== 'bubble'" class="qq-dress-upload">
            <div>
                <h3>使用自己的图片</h3>
                <p>图片保存在当前浏览器的本地图片库中。</p>
            </div>
            <input
                ref="fileInput"
                type="file"
                accept="image/*"
                class="sr-only"
                :aria-label="`选择${category === 'chat' ? '聊天' : '个人'}背景图片`"
                @change="upload"
            /><button type="button" :disabled="busy" @click="fileInput?.click()">
                <font-awesome-icon :icon="['fas', 'arrow-up-from-bracket']" />{{
                    busy ? '正在读取…' : '上传图片'
                }}</button
            ><button v-if="customImage" type="button" :disabled="busy" @click="removeCustom">移除图片</button>
        </section>
        <p v-if="error" role="alert" class="qq-dress-error">{{ error }}</p>
        <p v-if="status" role="status" class="qq-dress-status">{{ status }}</p>
    </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { QText } from 'fake-qq-ui'
import Option from '@renderer/function/option'
import { useSettingsStore } from '@renderer/state/settings'
import { bubbleStyles, backgroundStyles } from '@renderer/runtime/appearanceCatalog'
import { bubbleTokens, useClientAppearance } from '@renderer/runtime/appearance'
import { seneraProfile, userAvatar } from '@renderer/runtime/seneraIdentity'
import { seneraDirectory as directory } from '@renderer/runtime/seneraDirectory'
import { saveBrowserBackgroundImage, toBackgroundImageStyle } from '@renderer/function/utils/backgroundUtil'

type Category = 'bubble' | 'chat' | 'profile'
const tabs: { id: Category; name: string }[] = [
    { id: 'bubble', name: '聊天气泡' },
    { id: 'chat', name: '聊天背景' },
    { id: 'profile', name: '个人背景' },
]
const settings = useSettingsStore()
const { background, tokens } = useClientAppearance()
const category = ref<Category>('bubble')
const selected = ref<string>(settings.sysConfig.bubble_style)
const customPreview = ref(false)
const busy = ref(false)
const error = ref('')
const status = ref('')
const fileInput = ref<HTMLInputElement>()
const previewAgent = computed(() =>
    directory.value?.agents.find((agent) => agent.id === directory.value?.defaultAgentId),
)
const optionKey = computed(() => (category.value === 'bubble' ? 'bubble_style' : `${category.value}_wallpaper`))
const customImage = computed(
    () => category.value !== 'bubble' && Boolean(settings.sysConfig[`${category.value}_background`]),
)
const catalogue = computed(() => (category.value === 'bubble' ? bubbleStyles : backgroundStyles))
const selectedName = computed(() =>
    customPreview.value ? '自定义背景' : catalogue.value.find((item) => item.id === selected.value)?.name,
)
const applied = computed(() =>
    customPreview.value
        ? customImage.value
        : settings.sysConfig[optionKey.value] === selected.value && !customImage.value,
)
const previewTokens = computed(() =>
    category.value === 'bubble' ? bubbleTokens(selected.value, settings.darkMode) : tokens.value,
)
const previewBackground = computed(() => {
    if (category.value === 'bubble') return background('chat')
    if (customPreview.value && customImage.value)
        return {
            backgroundImage: toBackgroundImageStyle(settings.sysConfig[`${category.value}_background`]),
            backgroundSize: 'cover',
            backgroundPosition: 'center',
        }
    const item = backgroundStyles.find((item) => item.id === selected.value)
    return item ? { background: settings.darkMode ? item.darkFill : item.fill } : {}
})
function save(key: string, value: unknown) {
    settings.sysConfig[key] = value
    Option.runAS(key, value)
}
function selectCategory(value: Category) {
    category.value = value
    selected.value = settings.sysConfig[optionKey.value]
    customPreview.value = customImage.value
    error.value = ''
    status.value = ''
}
function select(id: string) {
    customPreview.value = false
    selected.value = id
    status.value = ''
}
function swatch(id: string) {
    const item = catalogue.value.find((item) => item.id === id)
    return item
        ? {
              background: settings.darkMode ? item.darkFill : item.fill,
              color:
                  category.value === 'bubble'
                      ? settings.darkMode
                          ? (item as (typeof bubbleStyles)[number]).darkText
                          : (item as (typeof bubbleStyles)[number]).text
                      : 'var(--qq-text_secondary)',
          }
        : {}
}
function apply() {
    save(optionKey.value, selected.value)
    if (category.value !== 'bubble') save(`${category.value}_background`, '')
    status.value = '装扮已应用'
}
async function upload(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const scope = category.value
    if (scope === 'bubble') return
    busy.value = true
    error.value = ''
    status.value = ''
    try {
        const bitmap = await createImageBitmap(file)
        bitmap.close()
        const path = await saveBrowserBackgroundImage(file, `${scope}_background`)
        save(`${scope}_background`, path)
        if (category.value === scope) customPreview.value = true
        status.value = '背景图片已应用'
    } catch (reason) {
        error.value = reason instanceof Error ? reason.message : String(reason)
    } finally {
        busy.value = false
    }
}
function removeCustom() {
    customPreview.value = false
    save(`${category.value}_background`, '')
    status.value = '已恢复所选背景'
}
</script>
<style scoped>
.qq-dressing {
    display: grid;
    gap: 22px;
    min-width: 0;
}
.qq-dress-tabs {
    display: flex;
    gap: 26px;
    border-bottom: 1px solid var(--client-divider);
}
.qq-dress-tabs > button {
    position: relative;
    padding: 0 0 14px;
    border: 0;
    background: transparent;
    color: var(--qq-text_secondary);
    font: inherit;
    font-size: 15px;
    cursor: pointer;
    white-space: nowrap;
}
.qq-dress-tabs > .active {
    color: var(--qq-text_primary);
    font-weight: 600;
}
.qq-dress-tabs > .active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 3px;
    border-radius: 2px;
    background: var(--client-accent);
}
.qq-dress-preview {
    min-height: 218px;
    padding: 0 16px 18px;
    overflow: hidden;
    border: 1px solid var(--client-divider);
    border-radius: 10px;
}
.qq-dress-preview > header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 6px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--client-divider);
    font-size: 14px;
}
.qq-dress-preview > header small {
    color: var(--qq-text_secondary);
    font-size: 11px;
}
.qq-preview-message {
    margin: 12px 0;
    padding: 0;
}
.qq-dress-profile-preview {
    display: flex;
    align-items: flex-end;
    height: 238px;
    background-size: cover;
    background-position: center;
    border-radius: 10px;
    border: 1px solid var(--client-divider);
    overflow: hidden;
}
.qq-dress-profile-preview > div {
    display: grid;
    grid-template-columns: 58px auto;
    gap: 6px 14px;
    align-items: center;
    width: 100%;
    padding: 20px;
    background: var(--color-card);
}
.qq-dress-profile-preview img {
    grid-row: span 2;
    width: 58px;
    height: 58px;
    border-radius: 50%;
    object-fit: cover;
}
.qq-dress-profile-preview strong {
    align-self: end;
    font-size: 17px;
    font-weight: 500;
}
.qq-dress-profile-preview span {
    align-self: start;
    color: var(--qq-text_secondary);
    font-size: 12px;
}
.qq-dress-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-top: -8px;
}
.qq-dress-toolbar > div {
    display: grid;
    gap: 4px;
}
.qq-dress-toolbar strong {
    font-size: 15px;
    font-weight: 500;
}
.qq-dress-toolbar small {
    font-size: 12px;
    color: var(--qq-text_secondary);
}
button.qq-dress-apply {
    min-width: 96px;
    background: var(--client-accent);
    color: #fff;
    border-color: transparent;
}
.qq-dress-apply:disabled {
    opacity: 0.5;
    cursor: default;
}
.qq-dress-collection {
    padding: 20px;
    background: var(--color-card);
    border-radius: 10px;
}
h3 {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin: 0 0 20px;
    font-size: 16px;
    font-weight: 600;
}
h3 small {
    color: var(--qq-text_secondary);
    font-size: 12px;
    font-weight: 400;
}
.qq-dress-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 16px;
}
.qq-dress-tile {
    position: relative;
    display: grid;
    height: auto;
    gap: 10px;
    min-width: 0;
    padding: 0 0 8px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: center;
    cursor: pointer;
}
.qq-dress-tile.selected {
    border-color: var(--client-accent);
}
.qq-dress-swatch {
    display: grid;
    place-items: center;
    height: 76px;
    border-radius: 6px;
    border: 1px solid var(--client-divider);
}
.qq-dress-swatch > span {
    padding: 7px 12px;
    font-size: 13px;
}
.qq-dress-swatch > svg {
    width: 20px;
    opacity: 0.6;
}
.qq-dress-tile > span {
    padding: 0 4px;
    font-size: 13px;
}
.qq-dress-tile > svg {
    position: absolute;
    width: 15px;
    height: 15px;
    right: 6px;
    bottom: 7px;
    color: var(--client-accent);
}
.qq-dress-upload {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding: 20px;
    background: var(--color-card);
    border-radius: 10px;
}
.qq-dress-upload > div {
    flex: 1;
    min-width: 180px;
}
.qq-dress-upload h3 {
    margin-bottom: 7px;
}
.qq-dress-upload p {
    margin: 0;
    color: var(--qq-text_secondary);
    font-size: 12px;
    line-height: 20px;
}
.qq-dress-upload button,
.qq-dress-apply {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: 34px;
    padding: 0 12px;
    border: 1px solid var(--client-divider);
    border-radius: 6px;
    background: transparent;
    color: var(--qq-text_primary);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
}
.qq-dress-error,
.qq-dress-status {
    margin: 0;
    font-size: 13px;
}
.qq-dress-error {
    color: var(--color-red);
}
.qq-dress-status {
    color: var(--qq-text_secondary);
}
@media (max-width: 700px) {
    .qq-dress-tabs {
        gap: 24px;
    }
    .qq-dress-collection {
        padding: 16px;
    }
    .qq-dress-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px 8px;
    }
    .qq-dress-swatch {
        height: 70px;
    }
    .qq-dress-tile > span {
        font-size: 12px;
    }
    .qq-dress-tile > svg {
        width: 12px;
        right: 3px;
    }
    .qq-dress-preview {
        padding-right: 8px;
        padding-left: 8px;
    }
}
</style>
