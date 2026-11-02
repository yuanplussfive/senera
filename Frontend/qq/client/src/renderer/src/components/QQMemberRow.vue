<!-- Shared QQ member geometry uses FakeQQ's palette and typography. AGPL-3.0-only. -->
<template>
    <button type="button" class="qq-member-row" :class="{ selected }" :aria-pressed="selected" :disabled="disabled">
        <img :src="avatar" alt="" loading="lazy" decoding="async" />
        <span class="qq-member-label"
            ><span>{{ name }}</span
            ><small v-if="description">{{ description }}</small></span
        >
        <span v-if="role" class="qq-member-role">{{ role }}</span>
        <font-awesome-icon v-if="bot" class="qq-member-bot" :icon="['fas', 'robot']" title="Agent" />
        <font-awesome-icon
            v-if="checkable"
            class="qq-member-check"
            :class="{ checked: selected }"
            :icon="['fas', selected ? 'circle-check' : 'circle']"
        />
    </button>
</template>
<script setup lang="ts">
defineProps<{
    name: string
    avatar: string
    description?: string
    role?: string
    bot?: boolean
    selected?: boolean
    disabled?: boolean
    checkable?: boolean
}>()
</script>
<style scoped>
.qq-member-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 64px;
    box-sizing: border-box;
    margin: 0;
    padding: 10px 12px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--qq-text_primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.qq-member-row:hover,
.qq-member-row.selected {
    background: var(--qq-overlay_hover);
}
.qq-member-row:focus-visible {
    outline: 2px solid var(--client-accent);
    outline-offset: -2px;
}
.qq-member-row:disabled {
    opacity: 0.5;
    cursor: default;
}
.qq-member-row > img {
    flex: 0 0 40px;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
}
.qq-member-label {
    display: grid;
    gap: 3px;
    flex: 1;
    min-width: 0;
    font-size: var(--qq-font_size_main_2);
    line-height: var(--qq-line_height_main_2);
}
.qq-member-label > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.qq-member-label > small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--qq-font_size_2);
    line-height: var(--qq-line_height_1);
    color: var(--qq-text_secondary);
}
.qq-member-role {
    flex: 0 0 auto;
    padding: 1px 5px;
    border-radius: 3px;
    color: var(--qq-tag_orange_text);
    background: var(--qq-tag_orange_bg);
    font-size: 11px;
    line-height: 16px;
}
.qq-member-bot {
    flex: 0 0 auto;
    width: 15px;
    color: var(--client-accent);
}
.qq-member-check {
    width: 17px;
    color: var(--client-divider);
}
.qq-member-check.checked {
    color: var(--client-accent);
}
@media (max-width: 700px) {
    .qq-member-row > img {
        flex-basis: 44px;
        width: 44px;
        height: 44px;
    }
}
</style>
