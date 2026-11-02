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

<script lang="ts">
    import { ref } from 'vue'
    import { downloadFile } from '@renderer/function/utils/appUtil'

    export type TaskStatus = 'downloading' | 'completed' | 'delegated' | 'failed' | 'cancelled'

    export interface TransferTask {
        id: string
        fileName: string
        fileSize: number
        filePath: string
        url: string
        status: TaskStatus
        progress: number
        downloaded: number
        createdAt: number
        updatedAt: number
        error?: string
    }

    // 模块级别状态
    const downloadTasksState = ref<TransferTask[]>([])
    const panelVisibleState = ref(false)

    // 存储下载任务的取消回调
    const downloadCancelCallbacks = new Map<string, () => void>()

    let taskCounter = 0
    const generateTaskId = () => {
        taskCounter++
        return `task_${Date.now()}_${taskCounter}`
    }

    /**
     * 打开文件传输管理器面板
     */
    export const openPanel = () => {
        panelVisibleState.value = true
    }

    /**
     * 关闭文件传输管理器面板
     */
    export const closePanel = () => {
        panelVisibleState.value = false
    }

    /**
     * 获取面板显示状态
     */
    export const panelVisible = panelVisibleState

    export const addDownloadTask = (info: {
        fileName: string,
        fileSize: number,
        filePath: string,
        url: string,
        onProgress?: (progress: number) => void,
        onComplete?: () => void,
        onError?: (error: string) => void
    }) => {
        const task: TransferTask = {
            id: generateTaskId(),
            fileName: info.fileName,
            fileSize: info.fileSize,
            filePath: info.filePath,
            url: info.url,
            status: 'downloading',
            progress: 0,
            downloaded: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
        }
        downloadTasksState.value.push(task)
        openPanel()

        const finish = (
            status: 'completed' | 'delegated' | 'failed' | 'cancelled',
            error?: string,
        ) => {
            const index = downloadTasksState.value.findIndex(t => t.id === task.id)
            if (index === -1) return
            const oldStatus = downloadTasksState.value[index].status
            if (['completed', 'delegated', 'failed', 'cancelled'].includes(oldStatus)) return

            const currentTask = { ...downloadTasksState.value[index] }
            currentTask.status = status
            currentTask.error = error
            currentTask.updatedAt = Date.now()
            if (status === 'completed') {
                currentTask.progress = 100
                if (currentTask.fileSize > 0) {
                    currentTask.downloaded = currentTask.fileSize
                }
            }
            downloadTasksState.value[index] = currentTask
            downloadTasksState.value = [...downloadTasksState.value]
            downloadCancelCallbacks.delete(task.id)

            if (status === 'completed' || status === 'delegated') {
                info.onComplete?.()
            } else if (status === 'failed' && error) {
                info.onError?.(error)
            }
        }

        // 处理进度回调
        const onprocess = (event: ProgressEvent & { [key: string]: any }) => {
            const index = downloadTasksState.value.findIndex(t => t.id === task.id)
            // 忽略已取消、已完成或不存在的任务
            if (index === -1 ||
                downloadTasksState.value[index].status === 'cancelled' ||
                downloadTasksState.value[index].status === 'completed' ||
                downloadTasksState.value[index].status === 'delegated' ||
                downloadTasksState.value[index].status === 'failed') {
                return undefined
            }

            const loaded = event.loaded || 0
            const total = event.total || info.fileSize

            // 创建新对象以触发响应式更新
            const currentTask = { ...downloadTasksState.value[index] }
            currentTask.downloaded = loaded
            currentTask.fileSize = total
            currentTask.progress = total > 0 ? Math.round((loaded / total) * 100) : 0
            currentTask.updatedAt = Date.now()

            // 调用外部回调
            if (info.onProgress) {
                info.onProgress(currentTask.progress)
            }

            // 替换数组中的对象以触发响应式更新
            downloadTasksState.value[index] = currentTask
            downloadTasksState.value = [...downloadTasksState.value]


            return undefined
        }

        // 处理取消回调
        const oncancel = (_: ProgressEvent & { [key: string]: any }) => {
            finish('cancelled', '下载已取消')
            return undefined
        }

        // 开始下载
        try {
            const handle = downloadFile(
                info.url,
                info.fileName,
                onprocess,
                oncancel,
                (mode) => finish(mode),
                (error) => finish('failed', error.message),
            )
            const currentTask = downloadTasksState.value.find(t => t.id === task.id)
            if (currentTask?.status === 'downloading') {
                downloadCancelCallbacks.set(task.id, () => {
                    handle.cancel()
                    oncancel({} as ProgressEvent)
                })
            }
        } catch (e) {
            finish('failed', String(e))
        }

        return task.id
    }

    export const getDownloadTasks = () => downloadTasksState.value

    export const removeDownloadTask = (taskId: string) => {
        downloadCancelCallbacks.delete(taskId)
        const index = downloadTasksState.value.findIndex(t => t.id === taskId)
        if (index !== -1) {
            downloadTasksState.value.splice(index, 1)
        }
    }

</script>

<script setup lang="ts">
    import { computed } from 'vue'

    const downloadTasks = computed(() => downloadTasksState.value)

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

    const cancelDownload = (taskId: string) => {
        const task = downloadTasks.value.find(t => t.id === taskId)
        if (task) {
            const cancelCallback = downloadCancelCallbacks.get(taskId)
            if (cancelCallback) {
                cancelCallback()
            } else {
                task.status = 'cancelled'
                task.updatedAt = Date.now()
            }
            setTimeout(() => removeDownloadTask(taskId), 1000)
        }
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
