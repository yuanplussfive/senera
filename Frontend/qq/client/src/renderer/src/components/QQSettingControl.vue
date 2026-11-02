<!-- One control implementation for client preferences. AGPL-3.0-only. -->
<template>
    <QQSettingRow :label="setting.label" :description="setting.description">
        <QQSwitch
            v-if="setting.type === 'switch'"
            :label="setting.label"
            :model-value="setting.inverse ? !settings.sysConfig[setting.key] : Boolean(settings.sysConfig[setting.key])"
            @update:model-value="save(setting.type === 'switch' && setting.inverse ? !$event : $event)"
        />
        <select v-else :aria-label="setting.label" :value="settings.sysConfig[setting.key]" @change="select">
            <option v-for="option in setting.options" :key="option.value" :value="option.value">
                {{ option.label }}
            </option>
        </select>
    </QQSettingRow>
</template>
<script setup lang="ts">
import Option from '@renderer/function/option'
import { useSettingsStore } from '@renderer/state/settings'
import type { ClientSetting } from '@renderer/runtime/clientSettings'
import QQSettingRow from './QQSettingRow.vue'
import QQSwitch from './QQSwitch.vue'
const props = defineProps<{ setting: ClientSetting }>()
const settings = useSettingsStore()
function save(value: string | boolean) {
    settings.sysConfig[props.setting.key] = value
    Option.runAS(props.setting.key, value)
}
function select(event: Event) {
    save((event.target as HTMLSelectElement).value)
}
</script>
<style scoped>
select {
    flex-shrink: 0;
    width: min(45%, 210px);
    min-width: 110px;
    height: 34px;
    padding: 0 26px 0 10px;
    border: 1px solid var(--client-divider);
    border-radius: 6px;
    background: var(--color-card);
    color: var(--qq-text_primary);
    font: inherit;
    font-size: 13px;
}
select:focus-visible {
    outline: 1px solid var(--client-accent);
    outline-offset: 2px;
}
@media (max-width: 560px) {
    select {
        width: 100%;
        min-width: 0;
        max-width: 100%;
    }
}
</style>
