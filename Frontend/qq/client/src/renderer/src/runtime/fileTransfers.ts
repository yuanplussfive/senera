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

export const cancelDownload = (taskId: string) => {
    const task = downloadTasksState.value.find(t => t.id === taskId)
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
