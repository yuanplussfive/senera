export async function downloadUrl(source: string, fileName: string): Promise<void> {
  const response = await fetch(source, { credentials: "include" });
  if (!response.ok) throw new Error(`Download failed with status ${response.status}.`);
  downloadBlob(await response.blob(), fileName);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
