import type { Story } from "@ladle/react";
import type { FileRejection } from "react-dropzone";
import { useRef, useState } from "react";
import { Upload, FileText, Image as ImageIcon, File } from "lucide-react";
import { FileDropZone } from "./FileDropZone";
import { Button } from "./Button";

export const BasicDropZone: Story = () => {
  const [files, setFiles] = useState<File[]>([]);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <div className="w-[500px] space-y-4">
        <h3 className="text-ink-900 font-medium">Basic File Drop Zone</h3>
        <FileDropZone
          accept={{ "image/*": [] }}
          onFiles={(acceptedFiles) => setFiles(acceptedFiles)}
          className="w-full"
        >
          {({ isDragActive, open }) => (
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors",
                isDragActive ? "border-terra-400 bg-terra-50" : "border-ink-300 bg-paper-100 hover:border-ink-400",
              )}
            >
              <Upload className="h-12 w-12 text-ink-400 mb-4" />
              <div className="text-ink-900 font-medium mb-1">
                {isDragActive ? "Drop files here" : "Drag & drop files here"}
              </div>
              <div className="text-ink-500 text-sm mb-4">or</div>
              <Button onClick={open}>Browse Files</Button>
            </div>
          )}
        </FileDropZone>
        {files.length > 0 && (
          <div className="space-y-2">
            <div className="text-ink-700 text-sm font-medium">Selected files:</div>
            {files.map((file, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-ink-200 bg-paper-50 px-3 py-2">
                <FileText className="h-4 w-4 text-ink-500" />
                <div className="flex-1 text-ink-900 text-sm truncate">{file.name}</div>
                <div className="text-ink-400 text-xs">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export const ImageUpload: Story = () => {
  const [previews, setPreviews] = useState<Array<{ file: File; preview: string }>>([]);
  const previewGenerationRef = useRef(0);

  const handleFiles = (acceptedFiles: File[]) => {
    const generation = ++previewGenerationRef.current;
    setPreviews([]);
    void Promise.all(
      acceptedFiles.map(async (file) => ({
        file,
        preview: await readImagePreview(file),
      })),
    )
      .then((entries) => {
        if (previewGenerationRef.current === generation) setPreviews(entries);
      })
      .catch(() => {
        if (previewGenerationRef.current === generation) setPreviews([]);
      });
  };

  return (
    <div className="flex items-center justify-center min-h-[500px] p-8">
      <div className="w-[600px] space-y-4">
        <h3 className="text-ink-900 font-medium">Image Upload with Preview</h3>
        <FileDropZone
          accept={{ "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"] }}
          onFiles={handleFiles}
          multiple
        >
          {({ isDragActive, isDragReject, open }) => (
            <button
              type="button"
              className={cn(
                "flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-terra-300",
                isDragReject && "border-brick-400 bg-brick-50",
                isDragActive && !isDragReject && "border-terra-400 bg-terra-50",
                !isDragActive && "border-ink-300 bg-paper-100 hover:border-ink-400",
              )}
              onClick={open}
            >
              <ImageIcon className="h-10 w-10 text-ink-400 mb-3" />
              <div className="text-ink-900 font-medium mb-1">
                {isDragReject ? "Only images allowed" : isDragActive ? "Drop images here" : "Upload Images"}
              </div>
              <div className="text-ink-500 text-sm">PNG, JPEG, or WebP</div>
            </button>
          )}
        </FileDropZone>
        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {previews.map(({ file, preview }) => (
              <div key={file.name} className="relative rounded-lg overflow-hidden border border-ink-200">
                <img src={preview} alt={file.name} className="w-full h-32 object-cover" />
                <div className="absolute bottom-0 left-0 right-0 bg-ink-900/70 text-paper-50 text-xs p-2 truncate">
                  {file.name}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function readImagePreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Image preview did not produce a data URL."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image preview."));
    reader.readAsDataURL(file);
  });
}

export const SingleFile: Story = () => {
  const [file, setFile] = useState<File | null>(null);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <div className="w-[400px] space-y-4">
        <h3 className="text-ink-900 font-medium">Single File Upload</h3>
        <FileDropZone
          accept={{ "*/*": [] }}
          multiple={false}
          onFiles={(acceptedFiles) => setFile(acceptedFiles[0] || null)}
        >
          {({ isDragActive, open }) => (
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
                isDragActive ? "border-terra-400 bg-terra-50" : "border-ink-300 bg-paper-100",
              )}
            >
              <File className="h-10 w-10 text-ink-400 mb-3" />
              <div className="text-ink-900 font-medium mb-1">{file ? "Replace file" : "Upload a file"}</div>
              <div className="text-ink-500 text-sm mb-3">Any file type accepted</div>
              <Button onClick={open} variant="outline" size="sm">
                Choose File
              </Button>
            </div>
          )}
        </FileDropZone>
        {file && (
          <div className="rounded-lg border border-ink-200 bg-paper-50 p-4">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-ink-500" />
              <div className="flex-1">
                <div className="text-ink-900 text-sm font-medium">{file.name}</div>
                <div className="text-ink-500 text-xs">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const WithValidation: Story = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = (acceptedFiles: File[], rejections: FileRejection[]) => {
    if (rejections.length > 0) {
      setError(`${rejections.length} file(s) rejected: only PDF files under 5MB allowed`);
      setTimeout(() => setError(null), 3000);
    } else {
      setError(null);
      setFiles(acceptedFiles);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <div className="w-[500px] space-y-4">
        <h3 className="text-ink-900 font-medium">Upload with Validation</h3>
        <FileDropZone accept={{ "application/pdf": [".pdf"] }} onFiles={handleFiles}>
          {({ isDragActive, isDragReject, open }) => (
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
                isDragReject && "border-brick-400 bg-brick-50",
                isDragActive && !isDragReject && "border-terra-400 bg-terra-50",
                !isDragActive && "border-ink-300 bg-paper-100",
              )}
            >
              <FileText className="h-10 w-10 text-ink-400 mb-3" />
              <div className="text-ink-900 font-medium mb-1">
                {isDragReject ? "Invalid file type" : "Upload PDF Documents"}
              </div>
              <div className="text-ink-500 text-sm mb-3">PDF files only, max 5MB</div>
              <Button onClick={open} variant="outline">
                Browse
              </Button>
            </div>
          )}
        </FileDropZone>
        {error && (
          <div className="rounded-lg border border-brick-200 bg-brick-50 text-brick-600 text-sm p-3">{error}</div>
        )}
        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((file, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-ink-200 bg-paper-50 px-3 py-2">
                <FileText className="h-4 w-4 text-brick-500" />
                <div className="flex-1 text-ink-900 text-sm">{file.name}</div>
                <div className="text-ink-400 text-xs">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
