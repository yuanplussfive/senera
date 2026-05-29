import { LogoMark } from "../ui/Logo";

export function EmptyChatState(): JSX.Element {
  const suggestions = (import.meta.env.VITE_EMPTY_SUGGESTIONS ?? "")
    .split("|")
    .map((s: string) => s.trim())
    .filter(Boolean);
  return (
    <div className="flex max-w-xl flex-col items-center text-center">
      <LogoMark size={34} />
      <h2 className="mt-5 font-serif text-[26px] italic text-ink-900" style={{ fontWeight: 500 }}>
        今天想做点什么？
      </h2>
      <p className="mt-1 text-[13.5px] text-ink-500">
        senera 用行动决策协议处理你的请求；右栏会展示完整的思考、决策与工具链路。
      </p>
      {suggestions.length > 0 ? (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          {suggestions.map((s: string) => (
            <span
              key={s}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper-100 px-3 py-1 text-[12.5px] text-ink-700"
            >
              {s}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
