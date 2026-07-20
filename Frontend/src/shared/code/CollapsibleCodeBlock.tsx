import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { motionTimings, useMotionLevel } from "../motion";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { CodeArtifactSourceView } from "./CodeArtifactSourceView";

interface CollapsibleCodeBlockProps {
  code: string;
  language: string;
  lineCount: number;
  className?: string;
  collapseThreshold?: number;
  previewLines?: number;
}

const DEFAULT_COLLAPSE_THRESHOLD = 30;
const DEFAULT_PREVIEW_LINES = 10;

export function CollapsibleCodeBlock({
  code,
  language,
  lineCount,
  className,
  collapseThreshold = DEFAULT_COLLAPSE_THRESHOLD,
  previewLines = DEFAULT_PREVIEW_LINES,
}: CollapsibleCodeBlockProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const { disableMotion } = useMotionLevel();
  const shouldCollapse = lineCount > collapseThreshold;
  const transition = disableMotion ? { duration: 0 } : motionTimings.fast;
  const previewCode = useMemo(() => readPreviewCode(code, previewLines), [code, previewLines]);

  if (!shouldCollapse) {
    return <CodeArtifactSourceView code={code} language={language} className={className} />;
  }

  return (
    <div className="relative">
      <div className="relative">
        <AnimatePresence mode="wait" initial={false}>
          {isExpanded ? (
            <motion.div
              key="expanded"
              initial={disableMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={disableMotion ? undefined : { opacity: 0 }}
              transition={transition}
            >
              <CodeArtifactSourceView code={code} language={language} className={className} />
            </motion.div>
          ) : (
            <motion.div
              key="collapsed"
              initial={disableMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={disableMotion ? undefined : { opacity: 0 }}
              transition={transition}
            >
              <CodeArtifactSourceView
                code={previewCode}
                language={language}
                maxVisibleLines={previewLines}
                className={className}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {!isExpanded && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-ink-900/5 to-transparent" />
        )}
      </div>

      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-ink-200 bg-paper-50 py-1.5 text-[12px] font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-800 focus:outline-none focus:ring-2 focus:ring-accent-focus"
      >
        {isExpanded ? (
          <>
            <ChevronUp className="h-3.5 w-3.5" />
            {frontendMessage("code.collapse")}
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5" />
            {frontendMessage("code.expandAll", { count: lineCount })}
          </>
        )}
      </button>
    </div>
  );
}

function readPreviewCode(code: string, previewLines: number): string {
  const safePreviewLines = Math.max(1, Math.floor(previewLines));
  let linesSeen = 1;
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) !== 10) continue;
    linesSeen += 1;
    if (linesSeen > safePreviewLines) {
      return code.slice(0, index);
    }
  }
  return code;
}
