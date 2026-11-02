<template>
    <div class="senera-conversation-header">
        <button type="button" class="senera-mobile-account" :aria-label="$t('设置')" @click="$emit('open-settings')">
            <img :src="userAvatar(auth.loginInfo.uin)" :alt="auth.loginInfo.nickname">
            <span>
                <strong>{{ auth.loginInfo.nickname }}</strong>
                <small role="status" :title="connection.reason"><i :class="{ connected: connection.phase === 'connected' }" />{{ connection.phase === 'connected' ? $t('已连接') : connection.phase === 'reconnecting' ? '正在重新连接' : $t('未连接') }}</small>
            </span>
        </button>
        <label class="senera-search">
            <font-awesome-icon :icon="['fas', 'magnifying-glass']" />
            <input :value="query" type="search" :placeholder="$t('搜索')" :aria-label="$t('搜索')"
                @input="updateQuery">
        </label>
        <SeneraGroupManager />
        <SeneraConsoleLink />
        <details ref="menu" class="senera-list-menu" @keydown.esc="closeMenu">
            <summary class="senera-icon-button" :title="$t('更多菜单')" :aria-label="$t('更多菜单')">
                <font-awesome-icon :icon="['fas', 'ellipsis']" />
            </summary>
            <div class="senera-list-menu-content" @click="closeMenu"><slot /></div>
        </details>
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useAuthStore } from '@renderer/state/auth'
import { useConnectionStore } from '@renderer/state/connection'
import SeneraGroupManager from './SeneraGroupManager.vue'
import SeneraConsoleLink from './SeneraConsoleLink.vue'
import { userAvatar } from '@renderer/runtime/seneraIdentity'

defineProps<{ query: string }>()
const emit = defineEmits<{
    'update:query': [value: string]
    'search': [event: Event]
    'open-settings': []
}>()
const auth = useAuthStore()
const connection = useConnectionStore()
const menu = ref<HTMLDetailsElement>()
function updateQuery(event: Event) {
    if (!(event.target instanceof HTMLInputElement)) return
    emit('update:query', event.target.value)
    emit('search', event)
}
function closeMenu() {
    if (menu.value) menu.value.open = false
}
function closeOutside(event: PointerEvent) {
    if (event.target instanceof Node && !menu.value?.contains(event.target)) closeMenu()
}
onMounted(() => document.addEventListener('pointerdown', closeOutside))
onUnmounted(() => document.removeEventListener('pointerdown', closeOutside))
</script>
