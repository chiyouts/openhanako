import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('InputArea placeholder style', () => {
  it('targets TipTap placeholder paragraphs under the editor root class', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/input/InputArea.module.css'),
      'utf8',
    );
    const inputAreaSource = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/InputArea.tsx'),
      'utf8',
    );

    expect(inputAreaSource).toContain("class: styles['input-box']");
    expect(css).toMatch(/\.input-box\s+p:global\(\.is-editor-empty\):first-child::before\s*\{/);
    expect(css).toMatch(/\.input-box\s+p:global\(\.is-editor-empty\):first-child::before\s*\{[^}]*font-style:\s*italic;/s);
    expect(css).toMatch(/\.input-box\s+p:global\(\.is-editor-empty\):first-child::before\s*\{[^}]*opacity:\s*0\.55;/s);
    expect(css).not.toMatch(/\.input-box\s+:global\(\.tiptap\s+p\.is-editor-empty:first-child::before\)/);
  });

  it('keeps the TipTap placeholder decoration tied to the latest i18n value', () => {
    const inputAreaSource = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/InputArea.tsx'),
      'utf8',
    );

    expect(inputAreaSource).toContain('placeholderRef.current = placeholder');
    expect(inputAreaSource).toContain('createInputEditorExtensions(getEditorPlaceholder)');
    expect(inputAreaSource).toMatch(/setMeta\('input-placeholder-refresh'/);
  });
});
