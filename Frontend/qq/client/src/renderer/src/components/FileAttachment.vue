<template>
    <component :is="compact ? 'span' : 'button'" :type="compact ? undefined : 'button'"
        class="senera-file-attachment" :class="{ compact }" :title="name"
        @click="$emit('open')">
        <span class="senera-file-copy">
            <span class="senera-file-name">{{ name }}</span>
            <span v-if="!compact" class="senera-file-meta">
                <span v-if="size !== undefined">{{ getSizeFromBytes(size) }}</span>
                <span v-if="pending">{{ $t('发送中') }}</span>
                <span v-else-if="sent">{{ $t('已发送') }}</span>
                <font-awesome-icon v-else :icon="['fas', 'arrow-down']" />
            </span>
        </span>
        <span class="senera-file-glyph" :class="category" aria-hidden="true">
            <font-awesome-icon :icon="['fas', icon]" />
            <small>{{ extension }}</small>
        </span>
    </component>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { getSizeFromBytes } from '@renderer/function/utils/systemUtil'

const props = defineProps<{ name: string; size?: number; compact?: boolean; pending?: boolean; sent?: boolean }>()
defineEmits<{ open: [] }>()
const extension = computed(() => {
    const dot = props.name.lastIndexOf('.')
    return dot > 0 ? props.name.slice(dot + 1).toUpperCase() : ''
})
// A presentation catalog, independent of upload/download protocols.
const fileCategories = [
    { name: 'audio', icon: 'file-audio', extensions: ['MP3', 'WAV', 'FLAC', 'OGG', 'M4A', 'AAC', 'OPUS'] },
    { name: 'video', icon: 'file-video', extensions: ['MP4', 'WEBM', 'MOV', 'MKV', 'AVI'] },
    { name: 'image', icon: 'file-image', extensions: ['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'AVIF', 'SVG', 'HEIC', 'BMP'] },
    { name: 'document', icon: 'file-word', extensions: ['DOC', 'DOCX', 'ODT', 'RTF'] },
    { name: 'sheet', icon: 'file-excel', extensions: ['XLS', 'XLSX', 'CSV', 'ODS'] },
    { name: 'presentation', icon: 'file-powerpoint', extensions: ['PPT', 'PPTX', 'ODP'] },
    { name: 'pdf', icon: 'file-pdf', extensions: ['PDF'] },
    { name: 'archive', icon: 'file-zipper', extensions: ['ZIP', '7Z', 'RAR', 'TAR', 'GZ'] },
]
const presentation = computed(() => fileCategories.find(entry => entry.extensions.includes(extension.value)))
const category = computed(() => presentation.value?.name)
const icon = computed(() => presentation.value?.icon ?? 'file-lines')
</script>
