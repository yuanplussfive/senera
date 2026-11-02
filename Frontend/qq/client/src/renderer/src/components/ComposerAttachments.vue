<template>
    <div v-if="entries.length" class="composer-attachments" aria-label="待发送附件" data-swipe-ignore>
        <div v-for="entry in entries" :key="entry.id" class="composer-attachment"
            :class="{ image: isImage(entry), failed: entry.status === 'error' }">
            <div v-if="isImage(entry)" class="attachment-thumbnail">
                <button type="button" class="attachment-preview" :aria-label="'预览：' + entry.fileName" @click="$emit('preview', entry.id)">
                    <img :src="entry.previewUrl" :alt="entry.fileName" @error="$emit('previewUnavailable', entry.id)">
                </button>
                <button type="button" class="attachment-remove" :aria-label="'移除附件：' + entry.fileName" @click="$emit('remove', entry.id)">
                    <font-awesome-icon :icon="['fas', 'xmark']" />
                </button>
                <button type="button" class="attachment-edit" :aria-label="'编辑图片：' + entry.fileName" @click="$emit('edit', entry.id)">
                    <font-awesome-icon :icon="['fas', 'pencil']" />
                </button>
                <span v-if="entry.status === 'uploading'" class="attachment-image-progress">{{ formatUploadProgress(entry.progress) }}</span>
            </div>
            <div v-else class="attachment-file">
                <span class="attachment-file-icon" :title="resolveFilePreview({ name: entry.fileName, mime: entry.mime }).label">
                    <font-awesome-icon :icon="['fas', 'file-lines']" />
                </span>
                <span class="attachment-file-copy">
                    <span class="attachment-file-name" :title="entry.fileName">{{ entry.fileName }}</span>
                    <span class="attachment-file-meta">{{ formatFileSize(entry.size) }}<span v-if="entry.status === 'uploading'"> · {{ formatUploadProgress(entry.progress) }}</span></span>
                    <span v-if="entry.previewUnavailable" class="attachment-file-meta">预览不可用，文件仍可发送</span>
                </span>
                <button type="button" class="attachment-remove" :aria-label="'移除附件：' + entry.fileName" @click="$emit('remove', entry.id)">
                    <font-awesome-icon :icon="['fas', 'xmark']" />
                </button>
            </div>
            <progress v-if="entry.status === 'uploading'" :value="readProgressRatio(entry.progress)" max="1" :aria-label="'上传：' + entry.fileName" />
            <div v-if="entry.status === 'error'" class="attachment-error" role="alert">
                <span>{{ entry.error }}</span>
                <button type="button" @click="$emit('retry', entry.id)">重试</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { PendingAttachment } from '../../../../../../src/api/composerAttachmentDraft'
import { formatUploadProgress, readProgressRatio } from '../../../../../../src/api/uploadProgress'
import { formatFileSize } from '../../../../../../src/lib/fileSize'
import { isImageFilePreview, resolveFilePreview } from '../../../../../../src/lib/filePreview'

defineProps<{ entries: PendingAttachment[] }>()
defineEmits<{ remove: [id: string]; retry: [id: string]; edit: [id: string]; preview: [id: string]; previewUnavailable: [id: string] }>()
const isImage = (entry: PendingAttachment) => Boolean(entry.previewUrl && !entry.previewUnavailable && isImageFilePreview({ name: entry.fileName, mime: entry.mime }))
</script>

<style scoped>
.composer-attachments { display: flex; flex-wrap: wrap; align-items: start; gap: 8px; max-height: 180px; overflow: auto; padding: 8px 14px 4px; overscroll-behavior: contain; }
.composer-attachment { position: relative; min-width: 0; max-width: 100%; }
.attachment-thumbnail { position: relative; width: 64px; height: 64px; overflow: hidden; border: 1px solid var(--client-divider); border-radius: 8px; background: var(--client-hover); }
.composer-attachments button { display: inline-grid; place-items: center; padding: 0; border: 0; cursor: pointer; color: inherit; background: transparent; }
.attachment-preview { width: 100%; height: 100%; }
.attachment-preview img { width: 100%; height: 100%; object-fit: contain; }
.composer-attachments .attachment-remove, .composer-attachments .attachment-edit { flex: 0 0 28px; width: 28px; height: 28px; border-radius: 6px; }
.attachment-thumbnail .attachment-remove, .attachment-thumbnail .attachment-edit { position: absolute; right: 0; color: white; background: rgb(0 0 0 / 65%); }
.attachment-thumbnail .attachment-remove { top: 0; }
.attachment-thumbnail .attachment-edit { bottom: 0; }
.attachment-remove:hover, .attachment-edit:hover { background: var(--client-hover); }
.composer-attachments svg { width: 12px; height: 12px; margin: 0; }
.attachment-file { display: flex; align-items: center; gap: 8px; box-sizing: border-box; min-height: 48px; max-width: 280px; padding: 4px 6px 4px 8px; border: 1px solid var(--client-divider); border-radius: 8px; background: var(--color-card-1); }
.attachment-file-icon { display: grid; place-items: center; flex: 0 0 28px; height: 28px; border-radius: 6px; background: var(--client-hover); color: var(--color-font-2); }
.attachment-file-icon svg { width: 16px; height: 16px; }
.attachment-file-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.attachment-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--color-font); }
.attachment-file-meta { font-size: 10px; line-height: 14px; color: var(--color-font-2); }
.attachment-image-progress { position: absolute; inset: auto 0 0; padding: 2px 4px; color: white; font-size: 10px; background: rgb(0 0 0 / 65%); pointer-events: none; }
.composer-attachment progress { display: block; width: 100%; height: 3px; margin: 2px 0 0; border: 0; accent-color: var(--client-accent); }
.failed .attachment-file, .failed .attachment-thumbnail { border-color: var(--color-red); }
.attachment-error { display: flex; align-items: start; gap: 8px; max-width: 280px; margin-top: 4px; color: var(--color-red); font-size: 11px; line-height: 16px; }
.attachment-error span { overflow-wrap: anywhere; min-width: 0; }
.attachment-error button { flex-shrink: 0; min-height: 28px; text-decoration: underline; }
@media (prefers-reduced-motion: reduce) { .composer-attachments * { transition: none; } }
</style>
