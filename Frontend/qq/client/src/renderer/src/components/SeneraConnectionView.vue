<template>
    <section class="senera-connection-view" aria-label="Senera QQ">
        <SeneraConsoleLink />
        <form class="senera-connection-card" @submit.prevent="$emit('connect')">
            <span class="senera-connection-brand">Senera QQ</span>
            <div class="senera-connection-avatar">
                <img v-if="account?.uin" :src="userAvatar(account.uin)" :alt="account.nickname">
                <font-awesome-icon v-else :icon="['far', 'user']" />
            </div>
            <h1>{{ account?.nickname || $t('连接工作区') }}</h1>
            <p class="senera-connection-caption">{{ $t('与当前工作区同步消息') }}</p>
            <label class="senera-auto-connect">
                <input type="checkbox" :checked="settings.sysConfig.auto_connect" @change="updateAutoConnect">
                <span>{{ $t('自动连接') }}</span>
            </label>
            <button type="submit" class="senera-connect-button" :disabled="login.creating || !login.address">
                <font-awesome-icon v-if="login.creating" :icon="['fas', 'circle-notch']" spin />
                <span role="status">{{ login.creating ? $t('正在连接') : $t('连接') }}</span>
            </button>
        </form>
    </section>
</template>
<script setup lang="ts">
import { userAvatar, seneraProfile } from '@renderer/runtime/seneraIdentity'
import { seneraDirectory } from '@renderer/runtime/seneraDirectory'
import SeneraConsoleLink from './SeneraConsoleLink.vue'
import { computed } from 'vue'
import { login } from '@renderer/function/connect'
import Option from '@renderer/function/option'
import { useAuthStore } from '@renderer/state/auth'
import { useSettingsStore } from '@renderer/state/settings'

defineEmits<{ connect: [] }>()
const auth = useAuthStore()
const settings = useSettingsStore()
const account = computed(() => auth.loginInfo.uin ? auth.loginInfo : {
    uin: seneraDirectory.value?.operatorId,
    nickname: seneraProfile.value?.name,
})
function updateAutoConnect(event: Event) {
    if (!(event.target instanceof HTMLInputElement)) return
    settings.sysConfig.auto_connect = event.target.checked
    Option.runAS('auto_connect', event.target.checked)
}
</script>
