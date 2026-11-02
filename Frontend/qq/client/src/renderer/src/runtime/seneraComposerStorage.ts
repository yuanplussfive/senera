// Upgrade durable drafts once; sending and editing only consume version 2. AGPL-3.0-only.
import { v4 as uuid } from 'uuid'
import type { ComposerAttachmentDraft } from '../../../../../../src/api/composerAttachmentDraft'
import { messageDraftRepository } from '../../../../../../src/api/messageDraftRepository'
import type { UploadAttachmentData } from '../../../../../../src/api/uploadTypes'
import type { MsgItemElem } from '../function/elements/information'

export interface StoredSeneraComposer {
    version: 2
    message: string
    parts: { id: string; value: MsgItemElem }[]
}
interface PreviousComposer { message: string; segments: MsgItemElem[] }
interface PreviousMedia { id: number; file: File; kind: 'image' | 'file'; resource?: UploadAttachmentData }

export async function readSeneraComposer(key: string, attachments: ComposerAttachmentDraft, signal?: AbortSignal): Promise<StoredSeneraComposer | undefined> {
    const stored = await messageDraftRepository.read<StoredSeneraComposer | PreviousComposer>(key)
    signal?.throwIfAborted()
    if (stored && 'version' in stored && stored.version === 2) return stored
    const media = await messageDraftRepository.read<PreviousMedia[]>(key + ':images')
    signal?.throwIfAborted()
    if (!stored && !media?.length) return undefined
    await attachments.ready
    signal?.throwIfAborted()
    for (const entry of media ?? []) {
        signal?.throwIfAborted()
        if (entry.resource) {
            if (!attachments.store.getState().pending.some(item => item.attachment?.resourceUri === entry.resource?.resourceUri))
                await attachments.addUploaded(entry.resource, entry.kind)
        } else await attachments.enqueue([entry.file], entry.kind)
    }
    await attachments.flush()
    signal?.throwIfAborted()
    const previous = stored as PreviousComposer | undefined
    const mediaIndexes = new Set(media?.map(entry => entry.id))
    const result: StoredSeneraComposer = {
        version: 2,
        message: (previous?.message ?? '').replace(/\[SQ:(\d+)\]/g, (_match, index: string) => {
            const segment = previous?.segments[Number(index)]
            return !mediaIndexes.has(Number(index)) && segment?.type === 'text' ? String(segment.text) : ''
        }),
        parts: (previous?.segments ?? []).flatMap((segment, index) =>
            mediaIndexes.has(index) || segment.type === 'text' ? [] : [{ id: uuid(), value: segment }]),
    }
    await messageDraftRepository.write(key, result)
    await messageDraftRepository.write(key + ':images', undefined)
    return result
}
