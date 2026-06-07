export function readVendorChunkName(id: string): string | undefined {
  const packageName = readNodeModulePackageName(id);
  if (!packageName) return undefined;
  if (packageName === "react" || packageName === "react-dom" || packageName === "scheduler") {
    return "vendor-react";
  }
  if (packageName.startsWith("@radix-ui/")) return "vendor-radix";
  return undefined;
}

function readNodeModulePackageName(id: string): string | undefined {
  const normalized = id.replace(/\\/g, "/");
  const marker = "/node_modules/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return undefined;
  const packagePath = normalized.slice(index + marker.length);
  const [first, second] = packagePath.split("/");
  if (!first) return undefined;
  return first.startsWith("@") && second ? `${first}/${second}` : first;
}
