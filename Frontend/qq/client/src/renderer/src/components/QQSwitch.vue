<!-- Use the existing shared switch structure rather than button-style toggles. AGPL-3.0-only. -->
<template>
    <label class="ss-switch"
        ><input type="checkbox" role="switch" :aria-label="label" :checked="modelValue" @change="change" />
        <div><div /></div
    ></label>
</template>
<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
function change(event: Event) {
    emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>
<style scoped>
.ss-switch {
    --color-main: var(--client-accent);
    --switch-height: 20px;
    --switch-dot-margin: 3px;
    --switch-dot-border: 0px;
    position: relative;
    display: inline-flex;
    flex: 0 0 36px;
    min-width: 36px;
    width: 36px;
    height: 20px;
    cursor: pointer;
}
.ss-switch > input {
    position: absolute;
    display: block;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
}
.ss-switch > div {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    height: 20px;
    padding: 3px;
    background: var(--client-divider);
    transition: background 160ms ease;
}
.ss-switch > div > div {
    flex: 0 0 14px;
    width: 14px;
    height: 14px;
    margin: 0;
    border: 0;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px #0002;
    float: none;
    transition: transform 160ms ease;
}
.ss-switch > input:checked ~ div {
    background: var(--client-accent);
}
.ss-switch > input:checked ~ div > div {
    margin: 0;
    border: 0;
    transform: translateX(16px);
}
.ss-switch > input:focus-visible ~ div {
    outline: 2px solid var(--client-accent);
    outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
    .ss-switch > div,
    .ss-switch > div > div {
        transition: none;
    }
}
</style>
