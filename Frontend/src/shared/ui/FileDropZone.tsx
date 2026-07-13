import { useCallback, type DragEventHandler, type InputHTMLAttributes, type ReactNode } from "react";
import {
  useDropzone,
  type Accept,
  type DropzoneOptions,
  type FileRejection,
} from "react-dropzone";
import { cn } from "../../lib/util";

export type FileDropZoneAccept = Accept;

const noopDragHandler: DragEventHandler<HTMLElement> = () => undefined;

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
    onDragEnter: noopDragHandler,
    onDragLeave: noopDragHandler,
    onDragOver: noopDragHandler,
    onDrop: handleDrop,
  } satisfies DropzoneOptions);
  const inputProps = getInputProps({}) as InputHTMLAttributes<HTMLInputElement>;

  return (
    <div
      {...getRootProps({
        className: cn("relative", className),
      })}
    >
      <input {...inputProps} />
      {children({ isDragActive, isDragReject, open })}
    </div>
  );
}
