export interface BrowserSlice {
  browserRunning: boolean;
  browserUrl: string | null;
  browserThumbnail: string | null;
  /** 按 session path 存储的 browser 状态（权威源） */
  browserBySession: Record<string, { running: boolean; url: string | null; thumbnail: string | null }>;
  setBrowserRunning: (running: boolean) => void;
  setBrowserUrl: (url: string | null) => void;
  setBrowserThumbnail: (thumbnail: string | null) => void;
}

export const createBrowserSlice = (
  set: (partial: Partial<BrowserSlice>) => void
): BrowserSlice => ({
  browserRunning: false,
  browserUrl: null,
  browserThumbnail: null,
  browserBySession: {},
  setBrowserRunning: (running) => set({ browserRunning: running }),
  setBrowserUrl: (url) => set({ browserUrl: url }),
  setBrowserThumbnail: (thumbnail) => set({ browserThumbnail: thumbnail }),
});

// ── Selectors ──
export const selectBrowserRunning = (s: BrowserSlice) => s.browserRunning;
export const selectBrowserUrl = (s: BrowserSlice) => s.browserUrl;
export const selectBrowserThumbnail = (s: BrowserSlice) => s.browserThumbnail;
