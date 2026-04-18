/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import { ImageStage } from '../../../../components/shared/MediaViewer/ImageStage';
import type { FileRef } from '../../../../types/file-ref';

describe('ImageStage', () => {
  // 注意：prop 名必须是 `file` 不是 `ref`。React 会把 `ref` 当 forwardRef ref 截获，
  // 导致组件拿不到该 prop。
  const file: FileRef = { id: '1', kind: 'image', source: 'desk', name: 'a.png', path: '/a.png', ext: 'png' };

  beforeEach(() => {
    (window as any).platform = {
      readFileBase64: vi.fn(async () => 'BASE64'),
    };
  });
  afterEach(() => { cleanup(); delete (window as any).platform; });

  it('渲染 img 并异步加载 src', async () => {
    const { container } = render(<ImageStage file={file} viewport={{ width: 800, height: 600 }} />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toBeTruthy();
      expect(img!.getAttribute('src')).toContain('data:image/png;base64,');
    });
  });

  it('wheel 事件触发 transform 变化', async () => {
    const { container } = render(<ImageStage file={file} viewport={{ width: 800, height: 600 }} />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });
    const img = container.querySelector('img')!;
    // 触发 load 让 natural size 稳定（jsdom 下默认 0，需注入）
    Object.defineProperty(img, 'naturalWidth', { value: 400, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 300, configurable: true });
    fireEvent.load(img);
    const stage = container.querySelector('[data-testid="image-stage"]')!;
    const before = (stage as HTMLElement).style.transform || '';
    fireEvent.wheel(stage, { deltaY: -100, clientX: 400, clientY: 300 });
    const after = (stage as HTMLElement).style.transform || '';
    expect(after).not.toBe(before);
  });

  it('natural size 就绪后 img 样式含 scale', async () => {
    const { container } = render(<ImageStage file={file} viewport={{ width: 1000, height: 800 }} />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true });
    fireEvent.load(img);
    // scale(1.8) = 0.9 * min(1000/500, 800/400) = 0.9 * 2
    await waitFor(() => {
      const t = (container.querySelector('[data-testid="image-stage"]') as HTMLElement).style.transform;
      expect(t).toMatch(/scale\(1\.8\)/);
    });
  });

  it('loading 状态下显示 spinner', () => {
    // readFileBase64 pending forever
    (window as any).platform.readFileBase64 = vi.fn(() => new Promise(() => {}));
    const { getByTestId } = render(<ImageStage file={file} viewport={{ width: 800, height: 600 }} />);
    expect(getByTestId('image-stage-spinner')).toBeTruthy();
  });
});
