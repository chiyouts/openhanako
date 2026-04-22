export interface ThemeEntry {
  cssPath: string;
  backgroundColor: string;
  i18nName: string;
  i18nMode: string;
}

export interface ThemeUIOption {
  id: string;
  i18nName: string;
  i18nMode: string;
}

export interface ResolvedTheme {
  stored: string;
  concrete: string;
}

export const STORAGE_KEY: 'hana-theme';
export const DEFAULT_THEME: string;
export const AUTO_LIGHT_DEFAULT: string;
export const AUTO_DARK_DEFAULT: string;
export const AUTO_OPTION: ThemeUIOption;
export const THEMES: Readonly<Record<string, ThemeEntry>>;

export function migrateSavedTheme(raw: unknown): string;
export function resolveSavedTheme(raw: unknown, isDark: boolean): ResolvedTheme;
export function getThemeIds(): string[];
export function getAllUIOptions(): ThemeUIOption[];
