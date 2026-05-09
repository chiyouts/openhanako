/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import {
  PLUGIN_UI_CAPABILITY,
  PLUGIN_UI_PROTOCOL,
  PLUGIN_UI_PROTOCOL_VERSION,
} from '@hana/plugin-protocol';
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

function renderCard() {
  const rendered = render(
    <PluginCardBlock
      card={{ type: 'iframe', pluginId: 'demo', route: '/card', title: 'Demo', description: 'fallback' }}
      agentId="butter"
    />,
  );
  const iframe = rendered.container.querySelector('iframe') as HTMLIFrameElement;
  const trustedWindow = { postMessage: vi.fn() } as unknown as Window;
  attachIframeWindow(iframe, trustedWindow);
  return { ...rendered, iframe, trustedWindow };
}

describe('PluginCardBlock', () => {
  afterEach(() => {
    cleanup();
    useStore.getState().closeMediaViewer();
  });

  it('only accepts ready / resize messages from the iframe window and expected origin', () => {
    const { iframe, trustedWindow } = renderCard();

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

  it('accepts SDK envelope ready / resize messages', () => {
    const { iframe, trustedWindow } = renderCard();

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          kind: 'event',
          type: 'hana.ready',
        },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          kind: 'event',
          type: PLUGIN_UI_CAPABILITY.UI_RESIZE,
          payload: { width: 260, height: 210 },
        },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
    });

    expect(iframe.style.opacity).toBe('1');
    expect(iframe.style.width).toBe('260px');
    expect(iframe.style.height).toBe('210px');
  });

  it('accepts trusted open-media-viewer messages and opens the parent MediaViewer state', () => {
    const { trustedWindow } = renderCard();

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
    const { trustedWindow } = renderCard();

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
