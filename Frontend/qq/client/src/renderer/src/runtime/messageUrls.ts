// Resolve transport addresses before rendering; the document base belongs to static assets. AGPL-3.0-only.
import { buildResourceContentUrl } from '@senera/resource-links'

export function resolveMessageUrls(segments: Record<string, unknown>[], hostUrl: string, resourceBaseUrl?: string): void {
    for (const segment of segments) {
        if (resourceBaseUrl) {
            const source = typeof segment.url === 'string' ? segment.url : segment.file
            const resource = typeof source === 'string' ? buildResourceContentUrl(resourceBaseUrl, source) : undefined
            if (resource) segment.url = resource
        }
        if (typeof segment.url === 'string' && segment.url && !URL.canParse(segment.url)) {
            segment.url = new URL(segment.url, hostUrl).href
        }
    }
}
