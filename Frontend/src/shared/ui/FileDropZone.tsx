import { useCallback, type ReactNode } from "react";
import {
  useDropzone,
  type Accept,
  type FileRejection,
} from "react-dropzone";
import { cn } from "../../lib/util";

export type FileDropZoneAccept = Accept;

export interface FileDropZoneState {
  isDragActive: boolean;
  isDragReject: boolean;
  open: () => void;
}

export interface FileDropZoneProps {
  accept: Accept;
  children: (state: FileDropZoneState) => ReactNode;
  className?: string;
  disabled?: boolean;
  multiple?: boolean;
  onFiles: (files: File[], rejections: FileRejection[]) => void;
}

export function FileDropZone({
  accept,
  children,
  className,
  disabled = false,
  multiple = true,
  onFiles,
}: FileDropZoneProps): JSX.Element {
  const handleDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      onFiles(acceptedFiles, fileRejections);
    },
    [onFiles],
  );
  const {
    getInputProps,
    getRootProps,
    isDragActive,
    isDragReject,
    open,
  } = useDropzone({
    accept,
    disabled,
    multiple,
    noClick: true,
    noKeyboard: true,
    onDrop: handleDrop,
  });

  return (
    <div
      {...getRootProps({
        className: cn("relative", className),
      })}
    >
      <input {...getInputProps()} />
      {children({ isDragActive, isDragReject, open })}
    </div>
  );
}
