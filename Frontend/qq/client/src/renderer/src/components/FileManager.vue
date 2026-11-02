<template>
    <div class="file-manager">
        <div class="task-list">
            <div v-if="downloadTasks.length === 0" class="empty-tip">
                {{ $t('暂无下载任务') }}
            </div>
            <div v-for="task in downloadTasks" :key="'dl-' + task.id" class="task-item">
                <div class="task-icon">
                    <font-awesome-icon :icon="['fas', getFileIcon(task.fileName)]" />
                </div>
                <div class="task-info">
                    <div class="task-name">
                        <span>{{ getStatusText(task.status) }}</span>
                        {{ task.fileName }}
                    </div>
                    <div class="task-progress">
                        <div class="progress-bar">
                            <div :style="{ width: task.progress + '%' }" />
                        </div>
                        <span>{{ formatSize(task.downloaded) }} / {{ formatSize(task.fileSize) }}</span>
                    </div>
                </div>
                <div class="task-actions">
                    <font-awesome-icon v-if="task.status === 'downloading'"
                        :icon="['fas', 'times']" @click="cancelDownload(task.id)" />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue'
    import { cancelDownload, getDownloadTasks, type TaskStatus } from '@renderer/runtime/fileTransfers'

    const downloadTasks = computed(getDownloadTasks)

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    const getFileIcon = (fileName: string) => {
        const ext = fileName.split('.').pop()?.toLowerCase() || ''
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) return 'image'
        if (['mp4', 'avi', 'mkv', 'mov', 'wmv'].includes(ext)) return 'video'
        if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return 'music'
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'file-zipper'
        if (['pdf'].includes(ext)) return 'file-pdf'
        if (['doc', 'docx'].includes(ext)) return 'file-word'
        if (['xls', 'xlsx'].includes(ext)) return 'file-excel'
        return 'file'
    }

    const getStatusText = (status: TaskStatus) => {
        const statusMap: Record<TaskStatus, string> = {
            downloading: '下载中',
            completed: '已完成',
            delegated: '已交给系统处理',
            failed: '失败',
            cancelled: '已取消'
        }
        return statusMap[status]
    }



</script>

<style scoped>
    .file-manager {
        flex-direction: column;
        max-height: 50vh;
        padding: 5px 0 0 0;
        display: flex;
    }
    .task-list {
        overflow: auto;
        max-height: 40vh;
        padding-right: 5px;
        flex: 1;
    }
    .empty-tip {
        text-align: center;
        color: var(--color-font-2);
        font-size: 0.85rem;
        padding: 30px 0;
    }
    .task-item {
        display: flex;
        align-items: center;
        padding: 10px;
        margin-bottom: 8px;
        border-radius: 7px;
        background: var(--color-card-2);
    }
    .task-item:last-child {
        margin-bottom: 0;
    }
    .task-icon {
        width: 35px;
        height: 35px;
        align-items: center;
        justify-content: center;
        border-radius: 7px;
        background: var(--color-main);
        color: white;
        margin-right: 12px;
        display: flex;
        flex-shrink: 0;
    }
    .task-icon svg {
        color: var(--color-font-r);
        font-size: 0.9rem;
    }
    .task-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .task-name {
        font-size: 0.85rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .task-name > span {
        background: var(--color-main);
        color: var(--color-font-r);
        padding: 0.05rem 5px;
        border-radius: 1rem;
        font-size: 0.7rem;
    }
    .task-progress {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .progress-bar {
        flex: 1;
        height: 4px;
        border-radius: 2px;
        background: var(--color-card-1);
        overflow: hidden;
    }
    .progress-bar > div {
        height: 100%;
        background: var(--color-main);
        border-radius: 2px;
        transition: width 0.3s;
    }
    .task-progress span {
        font-size: 0.7rem;
        color: var(--color-font-2);
        white-space: nowrap;
    }
    .task-actions {
        display: flex;
        gap: 10px;
        margin-left: 10px;
    }
    .task-actions svg {
        cursor: pointer;
        font-size: 0.9rem;
        opacity: 0.6;
        transition: opacity 0.2s;
    }
    .task-actions svg:hover {
        opacity: 1;
    }
</style>
