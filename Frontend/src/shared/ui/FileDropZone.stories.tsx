import type { Story } from "@ladle/react";
import type { FileRejection } from "react-dropzone";
import { FileText, Image as ImageIcon, Upload } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/util";
import { Button } from "./Button";
import { FileDropZone } from "./FileDropZone";

export const BasicDropZone: Story = () => {
  const [files, setFiles] = useState<File[]>([]);

  return (
    <div className="flex min-h-[420px] items-center justify-center p-8">
      <div className="w-[500px] max-w-full space-y-4">
        <h3 className="font-medium text-ink-900">基础文件拖放</h3>
        <FileDropZone
          accept={{ "image/*": [] }}
          onFiles={(acceptedFiles) => setFiles(acceptedFiles)}
          className="w-full"
        >
          {({ isDragActive, open }) => (
            <div
              className={cn(
                "flex flex-col items-center justify-center border-2 border-dashed p-12 transition-colors",
                isDragActive
                  ? "border-accent-border-strong bg-accent-surface"
                  : "border-ink-300 bg-paper-100 hover:border-ink-400",
              )}
            >
              <Upload className="mb-4 h-12 w-12 text-ink-400" />
              <div className="mb-1 font-medium text-ink-900">{isDragActive ? "松开即可上传" : "拖放图片到这里"}</div>
              <div className="mb-4 text-sm text-ink-500">也可以选择本地文件</div>
              <Button onClick={open}>选择文件</Button>
            </div>
          )}
        </FileDropZone>
        {files.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-ink-700">已选择的文件</div>
            {files.map((file) => (
              <div
                key={file.name + "-" + file.size}
                className="flex items-center gap-3 border border-ink-200 bg-paper-50 px-3 py-2"
              >
                <FileText className="h-4 w-4 text-ink-500" />
                <div className="min-w-0 flex-1 truncate text-sm text-ink-900">{file.name}</div>
                <div className="text-xs text-ink-400">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const ImageUpload: Story = () => {
  const [files, setFiles] = useState<File[]>([]);

  return (
    <div className="flex min-h-[460px] items-center justify-center p-8">
      <div className="w-[600px] max-w-full space-y-4">
        <h3 className="font-medium text-ink-900">图片上传</h3>
        <FileDropZone
          accept={{ "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"] }}
          onFiles={(acceptedFiles) => setFiles(acceptedFiles)}
          multiple
        >
          {({ isDragActive, isDragReject, open }) => (
            <button
              type="button"
              className={cn(
                "flex w-full cursor-pointer flex-col items-center justify-center border-2 border-dashed p-8 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                isDragReject && "border-brick-400 bg-brick-50",
                isDragActive && !isDragReject && "border-accent-border-strong bg-accent-surface",
                !isDragActive && "border-ink-300 bg-paper-100 hover:border-ink-400",
              )}
              onClick={open}
            >
              <ImageIcon className="mb-3 h-10 w-10 text-ink-400" />
              <div className="mb-1 font-medium text-ink-900">
                {isDragReject ? "文件类型不符合" : isDragActive ? "松开即可上传图片" : "拖放图片到这里"}
              </div>
              <div className="text-sm text-ink-500">支持 PNG、JPEG 和 WebP</div>
            </button>
          )}
        </FileDropZone>
        {files.length > 0 ? <div className="text-sm text-ink-600">已选择 {files.length} 个图片文件。</div> : null}
      </div>
    </div>
  );
};

export const WithValidation: Story = () => {
  const [error, setError] = useState("");
  const handleFiles = (acceptedFiles: File[], rejections: FileRejection[]) => {
    if (rejections.length > 0) {
      setError("只允许上传不超过 5MB 的 PDF 文件。");
      return;
    }
    setError(acceptedFiles.length > 0 ? "已接收 " + acceptedFiles.length + " 个文件。" : "尚未选择文件。");
  };

  return (
    <div className="flex min-h-[420px] items-center justify-center p-8">
      <div className="w-[500px] max-w-full space-y-4">
        <h3 className="font-medium text-ink-900">带校验的上传</h3>
        <FileDropZone accept={{ "application/pdf": [".pdf"] }} onFiles={handleFiles} multiple={false}>
          {({ isDragActive, isDragReject, open }) => (
            <button
              type="button"
              className={cn(
                "flex w-full cursor-pointer flex-col items-center justify-center border-2 border-dashed p-10 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                isDragReject && "border-brick-400 bg-brick-50",
                isDragActive && !isDragReject && "border-accent-border-strong bg-accent-surface",
                !isDragActive && "border-ink-300 bg-paper-100 hover:border-ink-400",
              )}
              onClick={open}
            >
              <Upload className="mb-3 h-9 w-9 text-ink-400" />
              <div className="mb-1 font-medium text-ink-900">
                {isDragReject ? "文件类型不符合" : isDragActive ? "松开即可上传" : "上传 PDF 文件"}
              </div>
              <div className="text-sm text-ink-500">仅支持 PDF，最大 5MB</div>
            </button>
          )}
        </FileDropZone>
        {error ? <p className="text-sm text-brick-600">{error}</p> : null}
      </div>
    </div>
  );
};
