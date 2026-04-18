/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useStore } from '../../../../stores';
import { MediaViewer } from '../../../../components/shared/MediaViewer/MediaViewer';

describe('MediaViewer shell', () => {
  beforeEach(() => {
    useStore.getState().closeMediaViewer();
  });
  afterEach(() => {
    cleanup();
    useStore.getState().closeMediaViewer();
  });

  it('mediaViewer 为 null 时不渲染任何元素', () => {
    const { container } = render(<MediaViewer />);
    expect(container.firstChild).toBeNull();
  });

  it('mediaViewer 非 null 时渲染 overlay', () => {
    useStore.getState().setMediaViewer({
      files: [{ id: 'x', kind: 'image', source: 'desk', name: 'x.png', path: '/x.png' }],
      currentId: 'x',
      origin: 'desk',
    });
    const { getByTestId } = render(<MediaViewer />);
    expect(getByTestId('media-viewer-overlay')).toBeTruthy();
  });
});
