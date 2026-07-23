export const DocumentToolModes = ["auto", "probe", "extract"] as const;

export type DocumentToolMode = (typeof DocumentToolModes)[number];

export const DefaultDocumentToolMode: DocumentToolMode = "auto";
