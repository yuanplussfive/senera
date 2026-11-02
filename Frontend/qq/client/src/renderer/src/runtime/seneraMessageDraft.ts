// OneBot is a protocol projection of structured composer data, never an editor syntax. AGPL-3.0-only.
import type { PendingAttachment } from '../../../../../../src/api/composerAttachmentDraft'
import { buildResourceContentUrl } from '../../../../../../src/api/resourceUpload'
import type { MsgItemElem } from '../function/elements/information'

export function buildSeneraMessage(
    text: string,
    segments: readonly MsgItemElem[],
    attachments: readonly PendingAttachment[],
    resourceBase: string,
    suffix = '',
): MsgItemElem[] {
    const media = attachments.map(entry => {
        if (entry.status !== 'uploaded' || !entry.attachment) throw new Error(entry.error ?? '附件尚未上传完成')
        const resource = entry.attachment
        return {
            type: entry.mediaType ?? (resource.mime.startsWith('image/') ? 'image' : 'file'),
            file: resource.resourceUri, url: buildResourceContentUrl(resourceBase, resource.resourceUri),
            name: resource.name, content_type: resource.mime, size: resource.size,
        }
    })
    const body = text ? [{ type: 'text', text: text + suffix }] : []
    return [...segments.map(segment => ({ ...segment })), ...body, ...media]
}
