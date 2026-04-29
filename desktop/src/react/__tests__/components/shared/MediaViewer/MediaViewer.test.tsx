/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useStore } from '../../../../stores';
import { MediaViewer } from '../../../../components/shared/MediaViewer/MediaViewer';
import type { FileRef } from '../../../../types/file-ref';

const fileRef = (id: string, kind: FileRef['kind'] = 'image'): FileRef => ({
  id,
  kind,
  source: 'desk',
  name: `${id}.png`,
  path: `/${id}.png`,
  ext: 'png',
});

describe('MediaViewer interaction', () => {
  beforeEach(() => {
    useStore.getState().closeMediaViewer();
    (window as any).platform = {
      readFileBase64: vi.fn(async () => 'BASE64'),
      getFileUrl: vi.fn((p: string) => `file://${p}`),
      saveFileAs: vi.fn(async () => '/saved/output.png'),
      writeFileBinary: vi.fn(async () => true),
    };
  });

  afterEach(() => {
    cleanup();
    useStore.getState().closeMediaViewer();
    delete (window as any).platform;
  });

  it('closes on Escape', () => {
    useStore.getState().setMediaViewer({ files: [fileRef('a'), fileRef('b')], currentId: 'a', origin: 'desk' });
    render(<MediaViewer />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStore.getState().mediaViewer).toBeNull();
  });

  it('closes when clicking the overlay', () => {
    useStore.getState().setMediaViewer({ files: [fileRef('a')], currentId: 'a', origin: 'desk' });
    const { getByTestId } = render(<MediaViewer />);
    fireEvent.click(getByTestId('media-viewer-overlay'));
    expect(useStore.getState().mediaViewer).toBeNull();
  });

  it('closes when clicking the close button', () => {
    useStore.getState().setMediaViewer({ files: [fileRef('a')], currentId: 'a', origin: 'desk' });
    const { getByTestId } = render(<MediaViewer />);
    fireEvent.click(getByTestId('media-viewer-close'));
    expect(useStore.getState().mediaViewer).toBeNull();
  });

  it('navigates forward and backward with arrow keys', () => {
    useStore.getState().setMediaViewer({ files: [fileRef('a'), fileRef('b'), fileRef('c')], currentId: 'a', origin: 'desk' });
    render(<MediaViewer />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(useStore.getState().mediaViewer?.currentId).toBe('b');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(useStore.getState().mediaViewer?.currentId).toBe('a');
  });

  it('keeps the current file at the boundaries', () => {
    useStore.getState().setMediaViewer({ files: [fileRef('a'), fileRef('b')], currentId: 'a', origin: 'desk' });
    render(<MediaViewer />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(useStore.getState().mediaViewer?.currentId).toBe('a');

    useStore.getState().setMediaViewer({ files: [fileRef('a'), fileRef('b')], currentId: 'b', origin: 'desk' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(useStore.getState().mediaViewer?.currentId).toBe('b');
  });

  it('renders navigation buttons only for multi-file sequences', () => {
    useStore.getState().setMediaViewer({ files: [fileRef('a')], currentId: 'a', origin: 'desk' });
    let view = render(<MediaViewer />);
    expect(view.queryByTestId('media-viewer-prev')).toBeNull();
    expect(view.queryByTestId('media-viewer-next')).toBeNull();
    cleanup();

    useStore.getState().setMediaViewer({ files: [fileRef('a'), fileRef('b')], currentId: 'a', origin: 'desk' });
    view = render(<MediaViewer />);
    expect(view.getByTestId('media-viewer-prev')).toBeTruthy();
    expect(view.getByTestId('media-viewer-next')).toBeTruthy();
  });

  it('renders VideoStage for video files', async () => {
    useStore.getState().setMediaViewer({
      files: [{ ...fileRef('v'), kind: 'video', ext: 'mp4' }],
      currentId: 'v',
      origin: 'desk',
    });
    const { getByTestId } = render(<MediaViewer />);
    await waitFor(() => expect(getByTestId('video-stage-video')).toBeTruthy());
  });

  it('shows the file name and sequence index in the top bar', () => {
    useStore.getState().setMediaViewer({ files: [fileRef('a'), fileRef('b'), fileRef('c')], currentId: 'b', origin: 'desk' });
    const { getByTestId } = render(<MediaViewer />);
    expect(getByTestId('media-viewer-index').textContent).toContain('2 / 3');
    expect(getByTestId('media-viewer-name').textContent).toContain('b.png');
  });

  it('dispatches zoom commands from keyboard shortcuts', () => {
    useStore.getState().setMediaViewer({ files: [fileRef('a')], currentId: 'a', origin: 'desk' });
    const { container } = render(<MediaViewer />);

    fireEvent.keyDown(window, { key: '=' });
    fireEvent.keyDown(window, { key: '-' });
    fireEvent.keyDown(window, { key: '0' });

    const stage = container.querySelector('[data-testid="image-stage"]') as HTMLElement;
    expect(stage.dataset.zoomInSeq).toBe('1');
    expect(stage.dataset.zoomOutSeq).toBe('1');
    expect(stage.dataset.resetSeq).toBe('1');
  });

  it('writes the current media to the chosen Save As path', async () => {
    useStore.getState().setMediaViewer({ files: [fileRef('a')], currentId: 'a', origin: 'desk' });
    const { getByTestId } = render(<MediaViewer />);

    await act(async () => {
      fireEvent.click(getByTestId('media-viewer-save'));
      await Promise.resolve();
    });

    expect((window as any).platform.saveFileAs).toHaveBeenCalled();
    expect((window as any).platform.writeFileBinary).toHaveBeenCalledWith('/saved/output.png', 'BASE64');
  });
});
