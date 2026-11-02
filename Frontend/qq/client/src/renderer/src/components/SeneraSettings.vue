<!-- Hosted settings expose supported client features through one responsive shell. AGPL-3.0-only. -->
<template>
    <section v-show="show" class="qq-settings" :class="{ 'has-detail': detail }" aria-label="设置">
        <aside class="qq-settings-nav">
            <header><h1>设置</h1></header>
            <label class="qq-settings-search"
                ><font-awesome-icon :icon="['fas', 'magnifying-glass']" /><input
                    v-model="query"
                    type="search"
                    placeholder="搜索设置"
                    aria-label="搜索设置"
            /></label>
            <button type="button" class="qq-settings-profile" :style="background('profile')" @click="open('account')">
                <img :src="userAvatar(directory?.operatorId)" alt="" /><span
                    ><strong>{{ profile?.name ?? auth.loginInfo.nickname }}</strong
                    ><small>个人资料</small></span
                ><font-awesome-icon :icon="['fas', 'angle-right']" />
            </button>
            <nav aria-label="设置分类">
                <button
                    v-for="page in matchingPages"
                    :key="page.id"
                    type="button"
                    :class="{ selected: current === page.id }"
                    :aria-current="current === page.id ? 'page' : undefined"
                    @click="open(page.id)"
                >
                    <font-awesome-icon :icon="['fas', page.icon]" /><span>{{ page.name }}</span
                    ><font-awesome-icon class="qq-settings-chevron" :icon="['fas', 'angle-right']" />
                </button>
                <p v-if="!matchingPages.length" class="qq-settings-empty">没有找到相关设置</p>
            </nav>
        </aside>
        <main class="qq-settings-main">
            <header>
                <button
                    type="button"
                    class="senera-icon-button qq-settings-back"
                    aria-label="返回设置"
                    @click="detail = false"
                >
                    <font-awesome-icon :icon="['fas', 'angle-left']" />
                </button>
                <h2>{{ currentPage.name }}</h2>
            </header>
            <div class="qq-settings-content">
                <template v-if="current === 'general'">
                    <section class="qq-setting-section">
                        <h3>外观设置</h3>
                        <div class="qq-setting-card qq-mode-grid">
                            <button
                                v-for="mode in modes"
                                :key="mode.id"
                                type="button"
                                class="qq-mode-choice"
                                :class="{ selected: themeMode === mode.id }"
                                :aria-pressed="themeMode === mode.id"
                                @click="setTheme(mode.id)"
                            >
                                <div class="qq-mode-mini" :class="mode.id">
                                    <i /><span><i /><i /><i /></span>
                                </div>
                                <span>{{ mode.name }}</span>
                            </button>
                        </div>
                    </section>
                </template>
                <section v-for="section in visibleSections" :key="section.id" class="qq-setting-section">
                    <h3>{{ section.title }}</h3>
                    <div class="qq-setting-card">
                        <QQSettingControl v-for="setting in section.settings" :key="setting.key" :setting="setting" />
                    </div>
                </section>
                <section v-if="current === 'notifications'" class="qq-setting-section">
                    <h3>系统通知权限</h3>
                    <div class="qq-setting-card">
                        <QQSettingRow
                            label="允许系统通知"
                            :description="notificationDescriptions[notificationPermission]"
                        >
                            <button
                                v-if="notificationPermission === 'default'"
                                type="button"
                                class="qq-setting-action"
                                @click="enableNotifications"
                            >
                                允许通知
                            </button>
                            <span v-else class="qq-setting-value">{{
                                notificationLabels[notificationPermission]
                            }}</span>
                        </QQSettingRow>
                    </div>
                    <p v-if="notificationError" role="alert" class="qq-settings-note">{{ notificationError }}</p>
                </section>
                <SeneraDressing v-if="current === 'dress'" />
                <template v-else-if="current === 'account'">
                    <section class="qq-account-cover" :style="background('profile')">
                        <div>
                            <img :src="userAvatar(directory?.operatorId)" alt="" /><strong>{{
                                profile?.name ?? auth.loginInfo.nickname
                            }}</strong
                            ><span>{{ directory?.operatorId }}</span>
                        </div>
                    </section>
                    <section class="qq-setting-section">
                        <h3>个人资料</h3>
                        <div class="qq-setting-card">
                            <QQSettingRow label="名称" description="头像和名称与当前工作区主控台保持一致。"
                                ><span>{{ profile?.name }}</span></QQSettingRow
                            ><QQSettingRow label="编辑资料"
                                ><a :href="seneraConsoleUrl()" target="_blank" rel="noopener"
                                    >前往主控台<font-awesome-icon :icon="['fas', 'arrow-up-right-from-square']" /></a
                            ></QQSettingRow>
                        </div>
                    </section>
                    <section class="qq-setting-section">
                        <h3>工作区 Agent</h3>
                        <div class="qq-setting-card">
                            <div v-for="agent in directory?.agents" :key="agent.id" class="qq-settings-agent">
                                <img :src="userAvatar(agent.qqUserId)" alt="" /><span
                                    >{{ agent.name }}<small v-if="!agent.enabled">已停用</small></span
                                ><font-awesome-icon :icon="['fas', 'robot']" />
                            </div>
                        </div>
                    </section>
                </template>
                <template v-else-if="current === 'connection'"
                    ><section class="qq-setting-section">
                        <h3>当前工作区</h3>
                        <div class="qq-setting-card">
                            <QQSettingRow label="主控台连接"
                                ><span class="qq-connection-state" :class="{ connected }"
                                    ><i />{{ connected ? '已连接' : '未连接' }}</span
                                ></QQSettingRow
                            ><QQSettingRow label="自动连接" description="打开当前工作区时自动进入聊天。"
                                ><QQSwitch
                                    label="自动连接"
                                    :model-value="Boolean(settings.sysConfig.auto_connect)"
                                    @update:model-value="save('auto_connect', $event)" /></QQSettingRow
                            ><QQSettingRow label="渠道与 Agent 配置"
                                ><a :href="seneraConsoleUrl('channels')" target="_blank" rel="noopener"
                                    >打开主控台<font-awesome-icon :icon="['fas', 'arrow-up-right-from-square']" /></a
                            ></QQSettingRow>
                        </div>
                        <p v-if="hostError" role="status" class="qq-settings-note">{{ hostError }}</p>
                    </section></template
                >
                <template v-else-if="current === 'about'"
                    ><section class="qq-setting-section">
                        <h3>Senera QQ</h3>
                        <div class="qq-setting-card">
                            <QQSettingRow label="客户端版本"
                                ><span>{{ packageInfo.version }}</span></QQSettingRow
                            ><QQSettingRow label="开源许可与源码"
                                ><a v-if="sourceUrl" :href="sourceUrl" download
                                    >AGPL-3.0<font-awesome-icon :icon="['fas', 'download']" /></a
                            ></QQSettingRow>
                        </div>
                    </section></template
                >
            </div>
        </main>
    </section>
</template>
<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import Option from '@renderer/function/option'
import { useSettingsStore } from '@renderer/state/settings'
import { useAuthStore } from '@renderer/state/auth'
import { seneraProfile as profile, userAvatar } from '@renderer/runtime/seneraIdentity'
import { seneraDirectory as directory } from '@renderer/runtime/seneraDirectory'
import { seneraHostConnected as connected, seneraHostError as hostError } from '@renderer/runtime/seneraHost'
import { useClientAppearance } from '@renderer/runtime/appearance'
import packageInfo from '@senera-product'
import QQSettingRow from './QQSettingRow.vue'
import QQSwitch from './QQSwitch.vue'
import SeneraDressing from './SeneraDressing.vue'
import QQSettingControl from './QQSettingControl.vue'
import { clientSettings, filterClientSettings } from '@renderer/runtime/clientSettings'
import { seneraConsoleUrl } from '@renderer/runtime/seneraContext'
import { readNotificationPermission, requestNotificationPermission } from '@renderer/runtime/notifications'
const sourceUrl = document.querySelector<HTMLLinkElement>('link[rel="license"]')?.href
const props = defineProps<{ show: boolean }>()
const settings = useSettingsStore()
const auth = useAuthStore()
const { background } = useClientAppearance()
const notificationPermission = ref(readNotificationPermission())
const notificationError = ref('')
const notificationDescriptions = {
    default: '由浏览器或操作系统确认，允许后才会显示桌面通知。',
    granted: '已获得权限，提醒方式由上方的通知设置决定。',
    denied: '通知已被拦截，可在当前网站或系统的通知设置中重新允许。',
    unsupported: '当前浏览器或连接环境不支持系统通知，应用内提醒仍然可用。',
}
const notificationLabels = { default: '待授权', granted: '已允许', denied: '已拦截', unsupported: '不可用' }
function refreshNotificationPermission() {
    notificationPermission.value = readNotificationPermission()
}
async function enableNotifications() {
    notificationError.value = ''
    try {
        notificationPermission.value = await requestNotificationPermission()
    } catch (reason) {
        notificationError.value = reason instanceof Error ? reason.message : String(reason)
    }
}
onMounted(() => window.addEventListener('focus', refreshNotificationPermission))
onBeforeUnmount(() => window.removeEventListener('focus', refreshNotificationPermission))
const pages = [
    { id: 'general', name: '通用', icon: 'sliders' },
    { id: 'notifications', name: '消息通知', icon: 'bell' },
    { id: 'dress', name: '个性装扮', icon: 'shirt' },
    { id: 'account', name: '个人资料', icon: 'user' },
    { id: 'connection', name: '连接设置', icon: 'link' },
    { id: 'about', name: '关于与帮助', icon: 'circle-info' },
] as const
type Page = (typeof pages)[number]['id']
const modes = [
    { id: 'light', name: '白天' },
    { id: 'dark', name: '夜间' },
    { id: 'system', name: '跟随系统' },
] as const
const current = ref<Page>('general')
const detail = ref(false)
const query = ref('')
const currentPage = computed(() => pages.find((page) => page.id === current.value)!)
const matchingPages = computed(() =>
    pages.filter((page) =>
        `${page.name} ${page.id in clientSettings ? clientSettings[page.id as keyof typeof clientSettings].flatMap((section) => section.settings.map((item) => `${item.label} ${item.description ?? ''}`)).join(' ') : page.id === 'dress' ? '主题 气泡 聊天背景 个人背景' : ''}`.includes(
            query.value.trim(),
        ),
    ),
)
const themeMode = computed(() =>
    settings.sysConfig.opt_auto_dark ? 'system' : settings.sysConfig.opt_dark ? 'dark' : 'light',
)
const visibleSections = computed(() =>
    current.value === 'general' || current.value === 'notifications'
        ? filterClientSettings(current.value, currentPage.value.name.includes(query.value.trim()) ? '' : query.value)
        : [],
)
function open(page: Page) {
    current.value = page
    detail.value = true
}
function save(key: string, value: unknown) {
    settings.sysConfig[key] = value
    Option.runAS(key, value)
}
function setTheme(mode: string) {
    save('opt_auto_dark', mode === 'system')
    if (mode !== 'system') save('opt_dark', mode === 'dark')
}
watch(
    () => props.show,
    (value) => {
        if (!value) {
            detail.value = false
            query.value = ''
        }
    },
)
</script>
<style scoped>
.qq-settings {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--color-bg);
    color: var(--qq-text_primary);
}
.qq-settings-nav {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
    padding: 24px 12px;
    border-right: 1px solid var(--client-divider);
    background: var(--color-card);
}
.qq-settings-nav h1 {
    margin: 0 12px 20px;
    font-size: 20px;
    font-weight: 600;
}
.qq-settings-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    min-height: 34px;
    margin: 0 2px 18px;
    border-radius: 7px;
    background: var(--client-hover);
    color: var(--qq-text_secondary);
}
.qq-settings-search input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--qq-text_primary);
    font: inherit;
    font-size: 13px;
}
.qq-settings-profile {
    display: none;
}
.qq-settings-nav nav {
    display: grid;
    gap: 5px;
}
.qq-settings-nav nav > button {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 44px;
    padding: 10px 14px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--qq-text_primary);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
}
.qq-settings-nav nav > button > svg:first-child {
    flex: 0 0 17px;
    width: 17px;
    height: 17px;
}
.qq-settings-nav nav > button:hover,
.qq-settings-nav nav > .selected {
    background: var(--client-hover);
}
.qq-settings-nav nav > button.selected:has(svg[data-icon='shirt']) {
    background: color-mix(in srgb, var(--client-accent) 13%, transparent);
}
.qq-settings-chevron,
.qq-settings-back {
    display: none;
}
.qq-settings-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
}
.qq-settings-main > header {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 12px;
    min-height: 80px;
    padding: 0 32px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--client-divider);
}
.qq-settings-main h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
}
.qq-settings-content {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 28px 32px 40px;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--client-divider) transparent;
}
.qq-settings-content > * {
    max-width: 920px;
    margin-inline: auto;
}
.qq-setting-section {
    margin-bottom: 28px;
}
.qq-setting-section > h3 {
    margin: 0 0 12px;
    font-size: 16px;
    font-weight: 600;
}
.qq-setting-card {
    padding: 0 20px;
    border-radius: 10px;
    background: var(--color-card);
}
.qq-setting-card a {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--client-accent);
    font-size: 13px;
    text-decoration: none;
}
.qq-setting-card a > svg {
    width: 11px;
}
.qq-setting-value {
    flex-shrink: 0;
    color: var(--qq-text_secondary);
    font-size: 13px;
}
.qq-setting-action {
    flex-shrink: 0;
    padding: 7px 12px;
    border: 0;
    border-radius: 6px;
    background: var(--client-hover);
    color: var(--client-accent);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
}
.qq-setting-card :deep(.ss-switch) {
    flex-shrink: 0;
    margin: 0;
}
.qq-mode-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    padding: 16px;
}
.qq-mode-choice {
    display: grid;
    height: auto;
    gap: 10px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
}
.qq-mode-mini {
    display: flex;
    gap: 7px;
    box-sizing: border-box;
    width: 118px;
    height: 78px;
    padding: 12px;
    border: 2px solid transparent;
    outline: 1px solid var(--client-divider);
    border-radius: 6px;
    background: #f3f4f5;
}
.qq-mode-choice.selected .qq-mode-mini {
    border-color: var(--client-accent);
    outline-color: transparent;
}
.qq-mode-mini > i {
    width: 18px;
    border-radius: 3px;
    background: #dfe2e6;
}
.qq-mode-mini > span {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 4px;
}
.qq-mode-mini > span i {
    width: 75%;
    height: 7px;
    border-radius: 4px;
    background: #fff;
}
.qq-mode-mini > span i:nth-child(2) {
    align-self: end;
    background: #a8dbfa;
}
.qq-mode-mini.dark {
    background: #22252c;
}
.qq-mode-mini.dark > i {
    background: #343940;
}
.qq-mode-mini.dark > span i {
    background: #454a53;
}
.qq-mode-mini.dark > span i:nth-child(2) {
    background: #196e9e;
}
.qq-mode-mini.system {
    background: linear-gradient(90deg, #f3f4f5 50%, #22252c 50%);
}
.qq-account-cover {
    display: flex;
    align-items: flex-end;
    height: 210px;
    margin-bottom: 28px;
    border-radius: 10px;
    background-size: cover;
    background-position: center;
    overflow: hidden;
}
.qq-account-cover > div {
    display: grid;
    grid-template-columns: 58px auto;
    align-items: center;
    gap: 6px 14px;
    padding: 20px;
    width: 100%;
    background: var(--color-card);
}
.qq-account-cover img {
    grid-row: span 2;
    width: 58px;
    height: 58px;
    border-radius: 50%;
    object-fit: cover;
}
.qq-account-cover strong {
    align-self: end;
    font-size: 18px;
    font-weight: 500;
}
.qq-account-cover span {
    align-self: start;
    color: var(--qq-text_secondary);
    font-size: 12px;
}
.qq-settings-agent {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 68px;
    font-size: 14px;
}
.qq-settings-agent + .qq-settings-agent {
    border-top: 1px solid var(--client-divider);
}
.qq-settings-agent img {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    object-fit: cover;
}
.qq-settings-agent > span {
    display: grid;
    gap: 4px;
    flex: 1;
}
.qq-settings-agent small {
    font-size: 11px;
    color: var(--qq-text_secondary);
}
.qq-settings-agent > svg {
    color: var(--client-accent);
    width: 14px;
}
.qq-connection-state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
}
.qq-connection-state i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--qq-text_secondary);
}
.qq-connection-state.connected i {
    background: var(--color-green);
}
.qq-settings-note,
.qq-settings-empty {
    font-size: 12px;
    line-height: 20px;
    color: var(--qq-text_secondary);
}
@media (max-width: 900px) and (min-width: 701px) {
    .qq-settings {
        grid-template-columns: 180px minmax(0, 1fr);
    }
    .qq-settings-content {
        padding: 24px 20px;
    }
    .qq-mode-mini {
        width: 98px;
    }
}
@media (max-width: 700px) {
    .qq-settings {
        display: block;
        position: absolute;
        inset: 0;
        z-index: 5;
    }
    .qq-settings-nav {
        box-sizing: border-box;
        height: 100%;
        padding: 0 16px calc(24px + env(safe-area-inset-bottom));
        border: 0;
        background: var(--color-bg);
    }
    .qq-settings-nav > header {
        display: grid;
        place-items: center;
        min-height: 64px;
        padding-top: env(safe-area-inset-top);
    }
    .qq-settings-nav h1 {
        margin: 0;
        font-size: 18px;
    }
    .qq-settings-search {
        min-height: 40px;
        margin: 4px 0 22px;
        padding: 0 14px;
        background: var(--color-card);
    }
    .qq-settings-search input {
        font-size: 16px;
    }
    .qq-settings-profile {
        display: flex;
        height: auto;
        align-items: center;
        flex-shrink: 0;
        gap: 14px;
        margin-bottom: 26px;
        padding: 20px;
        border: 0;
        border-radius: 12px;
        color: var(--qq-text_primary);
        text-align: left;
        font: inherit;
        cursor: pointer;
        background-size: cover !important;
        background-position: center !important;
    }
    .qq-settings-profile > img {
        width: 48px;
        height: 48px;
        object-fit: cover;
        border-radius: 50%;
    }
    .qq-settings-profile > span {
        display: grid;
        gap: 6px;
        flex: 1;
    }
    .qq-settings-profile strong {
        font-size: 17px;
        font-weight: 500;
    }
    .qq-settings-profile small {
        font-size: 12px;
        color: var(--qq-text_secondary);
    }
    .qq-settings-profile > svg {
        width: 13px;
    }
    .qq-settings-nav nav {
        gap: 0;
        padding: 0 16px;
        border-radius: 12px;
        background: var(--color-card);
    }
    .qq-settings-nav nav > button {
        min-height: 62px;
        padding: 16px 2px;
        border-radius: 0;
        gap: 16px;
        font-size: 16px;
    }
    .qq-settings-nav nav > button + button {
        border-top: 1px solid var(--client-divider);
    }
    .qq-settings-nav nav > button > svg:first-child {
        flex-basis: 20px;
        width: 20px;
        height: 20px;
    }
    .qq-settings-nav nav > .selected,
    .qq-settings-nav nav > button.selected:has(svg[data-icon='shirt']) {
        background: transparent;
    }
    .qq-settings-chevron {
        display: block;
        margin-left: auto;
        width: 10px;
        color: var(--qq-text_secondary);
    }
    .qq-settings-main {
        display: none;
        height: 100%;
    }
    .qq-settings-main > header {
        min-height: 60px;
        padding: calc(8px + env(safe-area-inset-top)) 14px 8px;
    }
    .qq-settings-main h2 {
        font-size: 17px;
        font-weight: 500;
    }
    .qq-settings-back {
        display: inline-flex;
    }
    .qq-settings-content {
        padding: 22px 16px calc(28px + env(safe-area-inset-bottom));
    }
    .qq-settings.has-detail .qq-settings-main {
        display: flex;
    }
    .qq-settings.has-detail .qq-settings-nav {
        display: none;
    }
    .qq-mode-grid {
        gap: 16px;
        justify-content: space-between;
        padding: 16px 12px;
    }
    .qq-mode-mini {
        width: 88px;
        height: 64px;
        padding: 9px;
    }
    .qq-setting-card {
        padding: 0 16px;
    }
    .qq-setting-section {
        margin-bottom: 24px;
    }
}
</style>
