// Vue subscribes to the same attachment controller as the console. AGPL-3.0-only.
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { v4 as uuid } from 'uuid'
import { getComposerAttachmentDraft, type ComposerAttachmentDraft, type PendingAttachment } from '../../../../../../src/api/composerAttachmentDraft'
import { buildResourceUploadUrl } from '../../../../../../src/api/resourceUpload'
import { seneraMutationHeaders, seneraResourceBaseUrl } from './seneraContext'
import { PopInfo, PopType } from '../function/base'

export function useSeneraAttachments(key: () => string) {
    const state = shallowRef<{ pending: PendingAttachment[]; restoring: boolean }>({ pending: [], restoring: true })
    let draft: ComposerAttachmentDraft
    let release: (() => void) | undefined
    let unsubscribe: (() => void) | undefined
    watch(key, draftKey => {
        unsubscribe?.()
        release?.()
        const base = seneraResourceBaseUrl()
        if (!base) throw new Error('当前页面没有 Senera 工作区上传上下文')
        draft = getComposerAttachmentDraft({
            scope: 'onebot11', draftKey, uploadUrl: buildResourceUploadUrl(base),
            createId: uuid,
            headers: seneraMutationHeaders,
            describeError: error => error instanceof Error ? error.message : String(error),
            interruptedMessage: () => '附件上传未完成，请重试',
            onStorageError: (_operation, error) => new PopInfo().add(PopType.ERR, `无法保存或恢复附件草稿：${error instanceof Error ? error.message : String(error)}`),
        })
        release = draft.retain()
        state.value = draft.store.getState()
        unsubscribe = draft.store.subscribe(value => { state.value = value })
    }, { immediate: true, flush: 'sync' })
    onScopeDispose(() => { unsubscribe?.(); release?.() })
    return {
        pending: computed(() => state.value.pending),
        restoring: computed(() => state.value.restoring),
        current: () => draft,
    }
}
