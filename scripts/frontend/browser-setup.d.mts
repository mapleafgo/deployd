export type BrowserSetup = {
  snapshotSuffix?: string;
  prepare?(context: { page: unknown; baseURL?: string | undefined }): Promise<void>;
  settle?(context: { page: unknown; baseURL?: string | undefined }): Promise<void>;
  setup?(context: { page: unknown; baseURL?: string | undefined }): Promise<void>;
};
export function loadBrowserSetups(root?: string, appName?: string): Promise<BrowserSetup[]>;
