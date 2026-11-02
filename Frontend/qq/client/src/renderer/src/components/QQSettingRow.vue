<!-- Shared setting row; a single control geometry for the hosted client. AGPL-3.0-only. -->
<template>
    <div class="qq-setting-row">
        <div>
            <span>{{ label }}</span
            ><small v-if="description">{{ description }}</small>
        </div>
        <slot />
    </div>
</template>
<script setup lang="ts">
defineProps<{ label: string; description?: string }>()
</script>
<style scoped>
.qq-setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    min-height: 56px;
    padding: 12px 0;
    box-sizing: border-box;
}
.qq-setting-row + .qq-setting-row {
    border-top: 1px solid var(--client-divider);
}
.qq-setting-row > div {
    display: grid;
    gap: 5px;
    min-width: 0;
    font-size: 14px;
    line-height: 22px;
}
small {
    color: var(--qq-text_secondary);
    font-size: 12px;
    line-height: 18px;
}
@media (max-width: 560px) {
    .qq-setting-row:has(select) {
        align-items: stretch;
        flex-direction: column;
        gap: 8px;
    }
}
</style>
