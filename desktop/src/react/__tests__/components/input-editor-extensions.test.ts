// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import type { DecorationSet } from '@tiptap/pm/view';
import { describe, expect, it } from 'vitest';
import { createInputEditorExtensions } from '../../components/input/input-editor-extensions';
import { serializeEditor } from '../../utils/editor-serializer';

function readPlaceholderDecoration(editor: Editor): string | undefined {
  const decorationSet = editor.view.state.plugins
    .map(plugin => plugin.props.decorations?.call(plugin, editor.view.state))
    .find((value): value is DecorationSet => Boolean(value && 'find' in value));
  const decoration = decorationSet?.find()[0];
  const attrs = (decoration as unknown as { type?: { attrs?: Record<string, string> } } | undefined)?.type?.attrs;
  return attrs?.['data-placeholder'];
}

describe('input editor extensions', () => {
  it('does not register TipTap link marks for the chat input', () => {
    const editor = new Editor({
      extensions: createInputEditorExtensions(''),
      content: '<p><a href="https://example.com/article">Example Article</a></p>',
    });

    expect(editor.schema.marks.link).toBeUndefined();
    expect(editor.getJSON()).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Example Article' }],
      }],
    });
    expect(serializeEditor(editor.getJSON()).text).toBe('Example Article');

    editor.destroy();
  });

  it('allows placeholder decorations to read the latest supplied label', () => {
    let placeholder = 'input.placeholder';
    const editor = new Editor({
      extensions: createInputEditorExtensions(() => placeholder),
    });

    expect(readPlaceholderDecoration(editor)).toBe('input.placeholder');

    placeholder = 'Say something...';
    editor.view.dispatch(editor.state.tr.setMeta('input-placeholder-refresh', placeholder));

    expect(readPlaceholderDecoration(editor)).toBe('Say something...');

    editor.destroy();
  });

  it('serializes file badges as readable text and attachment references', () => {
    const editor = new Editor({
      extensions: createInputEditorExtensions(''),
      content: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ' },
            {
              type: 'fileBadge',
              attrs: {
                fileId: 'sf_readme',
                path: '/workspace/README.md',
                name: 'README.md',
                isDirectory: false,
                mimeType: 'text/markdown',
              },
            },
            { type: 'text', text: ' before editing.' },
          ],
        }],
      },
    });

    const serialized = serializeEditor(editor.getJSON());

    expect(serialized.text).toBe('Read @README.md before editing.');
    expect(serialized.fileRefs).toEqual([{
      fileId: 'sf_readme',
      path: '/workspace/README.md',
      name: 'README.md',
      isDirectory: false,
      mimeType: 'text/markdown',
    }]);

    editor.destroy();
  });
});
