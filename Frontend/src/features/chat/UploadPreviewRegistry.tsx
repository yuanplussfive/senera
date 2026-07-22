import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface UploadPreviewRegistry {
  register(uploadUri: string, previewUrl: string): void;
  release(uploadUri: string, previewUrl: string): void;
  resolve(uploadUri: string): string | undefined;
}

interface UploadPreviewContextValue extends UploadPreviewRegistry {
  readonly revision: number;
}

const UploadPreviewContext = createContext<UploadPreviewContextValue | null>(null);

export function UploadPreviewProvider({ children }: { children: ReactNode }): JSX.Element {
  const previewsRef = useRef(new Map<string, string>());
  const [revision, setRevision] = useState(0);

  const register = useCallback((uploadUri: string, previewUrl: string): void => {
    const previous = previewsRef.current.get(uploadUri);
    if (previous === previewUrl) return;
    if (previous) URL.revokeObjectURL(previous);
    previewsRef.current.set(uploadUri, previewUrl);
    setRevision((current) => current + 1);
  }, []);

  const release = useCallback((uploadUri: string, previewUrl: string): void => {
    if (previewsRef.current.get(uploadUri) !== previewUrl) return;
    previewsRef.current.delete(uploadUri);
    URL.revokeObjectURL(previewUrl);
    setRevision((current) => current + 1);
  }, []);

  useEffect(
    () => () => {
      for (const previewUrl of previewsRef.current.values()) {
        URL.revokeObjectURL(previewUrl);
      }
      previewsRef.current.clear();
    },
    [],
  );

  const value = useMemo<UploadPreviewContextValue>(
    () => ({
      register,
      release,
      resolve: (uploadUri) => previewsRef.current.get(uploadUri),
      revision,
    }),
    [register, release, revision],
  );

  return <UploadPreviewContext.Provider value={value}>{children}</UploadPreviewContext.Provider>;
}

export function useUploadPreviewRegistry(): UploadPreviewRegistry {
  const registry = useContext(UploadPreviewContext);
  if (!registry) {
    throw new Error("Upload preview consumers must be rendered inside UploadPreviewProvider.");
  }
  return registry;
}
