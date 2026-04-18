import { describe, expect, it } from 'vitest';
import { selectDeskFiles } from '../../../stores/selectors/file-refs';
import type { DeskFile } from '../../../types';

function makeState(deskFiles: DeskFile[], basePath = '/home/u', currentPath = '') {
  return {
    deskFiles,
    deskBasePath: basePath,
    deskCurrentPath: currentPath,
    chatSessions: {},
  } as any;
}

describe('selectDeskFiles', () => {
  it('过滤掉目录', () => {
    const state = makeState([
      { name: 'a.png', isDir: false },
      { name: 'sub', isDir: true },
      { name: 'b.mp4', isDir: false },
    ]);
    const refs = selectDeskFiles(state);
    expect(refs.map(r => r.name)).toEqual(['a.png', 'b.mp4']);
  });

  it('按扩展名推断 kind', () => {
    const state = makeState([
      { name: 'pic.jpg', isDir: false },
      { name: 'note.md', isDir: false },
      { name: 'clip.mp4', isDir: false },
      { name: 'mystery', isDir: false },
    ]);
    const refs = selectDeskFiles(state);
    expect(refs.find(r => r.name === 'pic.jpg')?.kind).toBe('image');
    expect(refs.find(r => r.name === 'note.md')?.kind).toBe('markdown');
    expect(refs.find(r => r.name === 'clip.mp4')?.kind).toBe('video');
    expect(refs.find(r => r.name === 'mystery')?.kind).toBe('other');
  });

  it('路径拼接 = basePath + currentPath + name', () => {
    const state = makeState(
      [{ name: 'a.png', isDir: false }],
      '/root',
      'sub/dir',
    );
    expect(selectDeskFiles(state)[0].path).toBe('/root/sub/dir/a.png');
  });

  it('currentPath 为空时路径 = basePath + name', () => {
    const state = makeState(
      [{ name: 'a.png', isDir: false }],
      '/root',
      '',
    );
    expect(selectDeskFiles(state)[0].path).toBe('/root/a.png');
  });

  it('同一输入多次调用返回引用稳定（memoization）', () => {
    const files: DeskFile[] = [{ name: 'a.png', isDir: false }];
    const state = makeState(files);
    const r1 = selectDeskFiles(state);
    const r2 = selectDeskFiles(state);
    expect(r1).toBe(r2);
  });

  it('id 由 buildFileRefId 构造（desk:<path>）', () => {
    const state = makeState([{ name: 'a.png', isDir: false }], '/x');
    const [ref] = selectDeskFiles(state);
    expect(ref.id).toBe('desk:/x/a.png');
    expect(ref.source).toBe('desk');
  });
});
