// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { createInputEditorExtensions } from '../../components/input/input-editor-extensions';
import { serializeEditor } from '../../utils/editor-serializer';

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
