import { BrandIcon } from "./BrandIcon";

export const Brands = () => (
  <main className="flex flex-wrap gap-6 bg-surface-canvas p-6 text-content-primary">
    <h1 className="w-full">平台标记</h1>
    {(["git", "telegram", "discord", "qq"] as const).map((brand) => (
      <span key={brand} className="flex items-center gap-2">
        <BrandIcon brand={brand} size={24} />
        {brand}
      </span>
    ))}
  </main>
);
