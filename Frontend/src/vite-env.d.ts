/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_URL?: string;
  readonly VITE_MODEL_LABEL?: string;
  /** 启动空状态时显示的建议——用 `|` 分隔多条，例如 "天气|代码|总结" */
  readonly VITE_EMPTY_SUGGESTIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
