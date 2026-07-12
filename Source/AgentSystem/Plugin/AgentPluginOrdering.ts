import type { LoadedPlugin } from "../Types/PluginRuntimeTypes.js";

export function compareLoadedPluginsForPrompting(left: LoadedPlugin, right: LoadedPlugin): number {
  return (
    compareOptionalAscending(left.manifest.Prompting?.Priority, right.manifest.Prompting?.Priority) ||
    compareLoadedPluginsByName(left, right)
  );
}

export function compareLoadedPluginsByName(left: LoadedPlugin, right: LoadedPlugin): number {
  return left.manifest.Plugin.Name.localeCompare(right.manifest.Plugin.Name);
}

function compareOptionalAscending(left: number | undefined, right: number | undefined): number {
  if (left !== undefined && right !== undefined) {
    return left - right;
  }
  if (left !== undefined) {
    return -1;
  }
  if (right !== undefined) {
    return 1;
  }
  return 0;
}
