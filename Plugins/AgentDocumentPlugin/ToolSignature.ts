export type DocumentToolArguments = {
  // Opaque upload handle copied from an attachment, for example "senera://upload/upl_0123abcd".
  uploadUri: string

  // Optional processing mode. If omitted, the plugin TOML defaultMode is used.
  // auto: probe first and extract text only when a configured parser matches.
  // probe: return registration/probe facts only.
  // extract: require text extraction.
  mode?: string
}

export type DocumentToolResult = {
  documents: {
    item: Array<{
      uploadUri: string
      mode: string
      status: "not_found" | "probed" | "extracted"
      name?: string
      mime?: string
      size?: number
      sha256?: string
      effectiveMime?: string
      detectedMime?: string
      declaredMime?: string
      namedMime?: string
      detectedExtension?: string
      namedExtension?: string
      mediaType?: string
      charset?: string
      isText?: boolean
      isBinary?: boolean
      containerFormat?: "zip"
      containerEntryCount?: number
      contentTypeDefaultCount?: number
      contentTypeOverrideCount?: number
      probe?: {
        status: "probed"
        effectiveMime: string
        detectedMime?: string
        detectedExtension?: string
        declaredMime?: string
        namedMime?: string
        namedExtension?: string
        mediaType?: string
        charset?: string
        isText?: boolean
        isBinary?: boolean
        container?: {
          format: "zip"
          entryCount: number
          sampledEntries: string[]
          contentTypes?: {
            entryName: string
            defaults: Array<{
              extension: string
              contentType: string
            }>
            overrides: Array<{
              partName: string
              contentType: string
            }>
          }
        }
        signals: Array<{
          source: string
          fields: Record<string, unknown>
        }>
      }
      contentAvailable: boolean
      textAvailable: boolean
      fileType?: string
      parser?: string
      textLength?: number
      markdownLength?: number
      chunkCount?: number
      warningCount?: number
      textPreview?: string
      markdownPreview?: string
      metadata?: Record<string, unknown>
      chunks?: {
        item: Array<{
          index: number
          text: string
          length: number
          metadata?: Record<string, unknown>
        }>
      }
      warnings?: {
        item: Array<{
          type: "warning" | "info" | "error"
          code: string
          message: string
        }>
      }
      message: string
    }>
  }
}
