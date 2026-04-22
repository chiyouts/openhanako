import { describe, it, expect } from 'vitest';
import reg from '../desktop/src/shared/theme-registry.cjs';

describe('theme-registry', () => {
  describe('constants', () => {
    it('STORAGE_KEY 是 "hana-theme"', () => {
      expect(reg.STORAGE_KEY).toBe('hana-theme');
    });

    it('DEFAULT_THEME 是 "warm-paper"', () => {
      expect(reg.DEFAULT_THEME).toBe('warm-paper');
    });

    it('AUTO_LIGHT_DEFAULT / AUTO_DARK_DEFAULT 都在 THEMES 表里', () => {
      expect(reg.THEMES).toHaveProperty(reg.AUTO_LIGHT_DEFAULT);
      expect(reg.THEMES).toHaveProperty(reg.AUTO_DARK_DEFAULT);
    });

    it('AUTO_OPTION 带 i18nName / i18nMode', () => {
      expect(reg.AUTO_OPTION).toEqual({
        id: 'auto',
        i18nName: 'settings.appearance.auto',
        i18nMode: 'settings.appearance.autoMode',
      });
    });
  });

  describe('THEMES 完整性', () => {
    it('恰好 9 条', () => {
      expect(Object.keys(reg.THEMES)).toHaveLength(9);
    });

    it('包含所有已知主题 id', () => {
      expect(Object.keys(reg.THEMES).sort()).toEqual([
        'absolutely', 'claude-design', 'contemplation', 'deep-think',
        'delve', 'grass-aroma', 'high-contrast', 'midnight', 'warm-paper',
      ]);
    });

    it.each(['warm-paper', 'midnight', 'high-contrast', 'grass-aroma',
             'contemplation', 'absolutely', 'delve', 'deep-think', 'claude-design'])(
      '"%s" 每条都有完整字段',
      (id) => {
        const t = reg.THEMES[id];
        expect(t).toHaveProperty('cssPath');
        expect(t).toHaveProperty('backgroundColor');
        expect(t).toHaveProperty('i18nName');
        expect(t).toHaveProperty('i18nMode');
        expect(t.cssPath).toMatch(/^themes\/[a-z-]+\.css$/);
        expect(t.backgroundColor).toMatch(/^#[0-9A-F]{6}$/i);
        expect(t.i18nName).toMatch(/^settings\.appearance\./);
        expect(t.i18nMode).toMatch(/^settings\.appearance\..+Mode$/);
      }
    );
  });

  describe('migrateSavedTheme', () => {
    it('合法主题 id 原样返回', () => {
      expect(reg.migrateSavedTheme('warm-paper')).toBe('warm-paper');
      expect(reg.migrateSavedTheme('midnight')).toBe('midnight');
      expect(reg.migrateSavedTheme('claude-design')).toBe('claude-design');
    });

    it('"auto" 原样返回', () => {
      expect(reg.migrateSavedTheme('auto')).toBe('auto');
    });

    it('null / undefined / 空串 → DEFAULT_THEME', () => {
      expect(reg.migrateSavedTheme(null)).toBe('warm-paper');
      expect(reg.migrateSavedTheme(undefined)).toBe('warm-paper');
      expect(reg.migrateSavedTheme('')).toBe('warm-paper');
    });

    it('非法值 → DEFAULT_THEME', () => {
      expect(reg.migrateSavedTheme('cyberpunk')).toBe('warm-paper');
      expect(reg.migrateSavedTheme(42)).toBe('warm-paper');
      expect(reg.migrateSavedTheme({})).toBe('warm-paper');
    });
  });

  describe('resolveSavedTheme', () => {
    it('具体主题透传：stored == concrete', () => {
      expect(reg.resolveSavedTheme('midnight', true)).toEqual({
        stored: 'midnight', concrete: 'midnight',
      });
      expect(reg.resolveSavedTheme('grass-aroma', false)).toEqual({
        stored: 'grass-aroma', concrete: 'grass-aroma',
      });
    });

    it('auto + 深色 → { stored: auto, concrete: midnight }', () => {
      expect(reg.resolveSavedTheme('auto', true)).toEqual({
        stored: 'auto', concrete: 'midnight',
      });
    });

    it('auto + 浅色 → { stored: auto, concrete: warm-paper }', () => {
      expect(reg.resolveSavedTheme('auto', false)).toEqual({
        stored: 'auto', concrete: 'warm-paper',
      });
    });

    it('null + 浅色 → DEFAULT_THEME', () => {
      expect(reg.resolveSavedTheme(null, false)).toEqual({
        stored: 'warm-paper', concrete: 'warm-paper',
      });
    });

    it('非法值 + 深色 → DEFAULT_THEME（不走 auto）', () => {
      expect(reg.resolveSavedTheme('nope', true)).toEqual({
        stored: 'warm-paper', concrete: 'warm-paper',
      });
    });
  });

  describe('getThemeIds / getAllUIOptions', () => {
    it('getThemeIds 返回 THEMES keys', () => {
      expect(reg.getThemeIds().sort()).toEqual(Object.keys(reg.THEMES).sort());
    });

    it('getAllUIOptions 含 9 个主题 + auto', () => {
      const opts = reg.getAllUIOptions();
      expect(opts).toHaveLength(10);
      expect(opts.map(o => o.id).sort()).toContain('auto');
      expect(opts.map(o => o.id).sort()).toContain('warm-paper');
      opts.forEach(o => {
        expect(o).toHaveProperty('id');
        expect(o).toHaveProperty('i18nName');
        expect(o).toHaveProperty('i18nMode');
      });
    });
  });
});
