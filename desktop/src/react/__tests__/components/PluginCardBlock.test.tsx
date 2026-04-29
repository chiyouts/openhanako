/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { PluginCardBlock } from '../../components/chat/PluginCardBlock';
import { useStore } from '../../stores';

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaUrl: (path: string) => `http://127.0.0.1:3210${path}`,
}));

function attachIframeWindow(iframe: HTMLIFrameElement, contentWindow: Window) {
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: contentWindow,
  });
}

describe('PluginCardBlock', () => {
  afterEach(() => {
    cleanup();
    useStore.getState().closeMediaViewer();
  });

  it('只接受来�?iframe 自身�?origin 正确�?ready / resize 消息', () => {
    const { container } = render(
      <PluginCardBlock
        card={{ type: 'iframe', pluginId: 'demo', route: '/card', title: 'Demo', description: 'fallback' }}
        agentId="butter"
      />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();

    const trustedWindow = { postMessage: vi.fn() } as unknown as Window;
    attachIframeWindow(iframe, trustedWindow);

    expect(iframe.style.opacity).toBe('0.3');
    expect(iframe.style.width).toBe('400px');
    expect(iframe.style.height).toBe('300px');

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'ready' },
        origin: 'http://evil.test',
        source: trustedWindow,
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'resize-request', payload: { width: 280, height: 220 } },
        origin: 'http://evil.test',
        source: trustedWindow,
      }));
    });

    expect(iframe.style.opacity).toBe('0.3');
    expect(iframe.style.width).toBe('400px');
    expect(iframe.style.height).toBe('300px');

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'ready' },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'resize-request', payload: { width: 280, height: 220 } },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
    });

    expect(iframe.style.opacity).toBe('1');
    expect(iframe.style.width).toBe('280px');
    expect(iframe.style.height).toBe('220px');
  });

  it('accepts trusted open-media-viewer messages and opens the parent MediaViewer state', () => {
    const { container } = render(
      <PluginCardBlock
        card={{ type: 'iframe', pluginId: 'demo', route: '/card', title: 'Demo', description: 'fallback' }}
        agentId="butter"
      />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const trustedWindow = { postMessage: vi.fn() } as unknown as Window;
    attachIframeWindow(iframe, trustedWindow);

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'open-media-viewer',
          payload: {
            kind: 'image',
            name: 'cat.png',
            url: 'http://127.0.0.1:3210/api/plugins/image-gen/media/cat.png',
            ext: 'png',
          },
        },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
    });

    const viewer = useStore.getState().mediaViewer;
    expect(viewer?.currentId).toContain('plugin-card:demo:');
    expect(viewer?.files[0].remoteUrl).toContain('/api/plugins/image-gen/media/cat.png');
  });
  it('normalizes relative plugin media URLs to absolute URLs before opening the MediaViewer state', () => {
    const { container } = render(
      <PluginCardBlock
        card={{ type: 'iframe', pluginId: 'demo', route: '/card', title: 'Demo', description: 'fallback' }}
        agentId="butter"
      />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const trustedWindow = { postMessage: vi.fn() } as unknown as Window;
    attachIframeWindow(iframe, trustedWindow);

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'open-media-viewer',
          payload: {
            kind: 'image',
            name: 'cat.png',
            url: '/api/plugins/image-gen/media/cat.png?token=abc',
            ext: 'png',
          },
        },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
    });

    const viewer = useStore.getState().mediaViewer;
    expect(viewer?.files[0].remoteUrl).toBe('http://127.0.0.1:3210/api/plugins/image-gen/media/cat.png?token=abc');
  });
});
