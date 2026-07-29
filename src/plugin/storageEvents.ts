export const PLUGIN_STORAGE_CHANGED_EVENT = "orbit:plugin-storage-changed";

export interface PluginStorageChangedDetail {
  pluginId: string;
  namespace: "settings" | "storage";
  key: string;
  storageKey: string;
  value: unknown;
  removed: boolean;
}

export function emitPluginStorageChanged(detail: PluginStorageChangedDetail): void {
  window.dispatchEvent(
    new CustomEvent<PluginStorageChangedDetail>(PLUGIN_STORAGE_CHANGED_EVENT, {
      detail
    })
  );
}
