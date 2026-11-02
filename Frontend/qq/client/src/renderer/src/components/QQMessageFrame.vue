<!-- FakeQQ-UI owns message geometry; Senera owns message content and actions. AGPL-3.0-only. -->
<template>
    <div v-if="inline" class="senera-inline-message"><slot /></div>
    <QText v-else ref="frame" class="senera-message-frame" :class="{ 'media-only': mediaOnly, 'direct-message': !group }"
        :self="self" :name="name" :avatar="avatar" :tag="tag" :tag-color="tagColor" :is-bot="bot" :style="mediaOnly ? undefined : tokens"
        @dblclick="onDoubleClick">
        <slot />
    </QText>
</template>

<script setup lang="ts">
import { QText } from 'fake-qq-ui'
import { useClientAppearance } from '@renderer/runtime/appearance'
import { onMounted, onUnmounted, ref } from 'vue'
import { bindUserTooltip, type VUserTooltipBinding } from '@renderer/function/tooltip'

const props = defineProps<{
    inline: boolean
    self: boolean
    group: boolean
    name: string
    avatar: string
    tag?: string
    tagColor?: 'orange' | 'blue' | 'purple' | 'grey'
    bot: boolean
    mediaOnly: boolean
    user: VUserTooltipBinding
}>()
const emit = defineEmits<{ poke: [] }>()
const frame = ref<InstanceType<typeof QText>>()
const { tokens } = useClientAppearance()
let removeTooltip: (() => void) | undefined

// Keep the package's DOM integration in this adapter, independent of message data.
onMounted(() => {
    const root = frame.value?.$el
    if (!(root instanceof HTMLElement)) return
    const avatar = root.querySelector<HTMLElement>('.qq-message__avatar-span')
    if (avatar) {
        avatar.setAttribute('role', 'img')
        avatar.setAttribute('aria-label', props.name)
        removeTooltip = bindUserTooltip(avatar, props.user)
    }
})
onUnmounted(() => removeTooltip?.())
function onDoubleClick(event: MouseEvent) {
    if (event.target instanceof Element && event.target.closest('.qq-message__avatar-span')) emit('poke')
}
</script>
