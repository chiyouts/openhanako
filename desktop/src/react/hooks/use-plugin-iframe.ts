import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  clampPluginIframeSize,
  getPluginIframeOrigin,
  isTrustedPluginIframeMessage,
  parsePluginIframeHostMessage,
  type PluginIframeSize,
  type PluginIframeStatus,
  type PluginUiSlot,
} from '../plugin-ui/plugin-ui-host-controller';
import type { TabType } from '../types';

const HANDSHAKE_TIMEOUT_MS = 5000;

function isAllowedPluginNavigationTab(tab: string): tab is TabType {
  return tab === 'chat' || tab === 'channels' || tab.startsWith('plugin:');
}

interface UsePluginIframeOptions {
  slot?: PluginUiSlot;
  initialSize?: PluginIframeSize;
  readyOnTimeout?: boolean;
}

export function usePluginIframe(routeUrl: string | null, options: UsePluginIframeOptions = {}) {
  const {
    slot = 'page',
    initialSize,
    readyOnTimeout = false,
  } = options;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<PluginIframeStatus>('loading');
  const [size, setSize] = useState<PluginIframeSize>(() => initialSize ?? {});
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seqRef = useRef(0);
  const expectedOrigin = useMemo(() => getPluginIframeOrigin(routeUrl), [routeUrl]);

  const resetHandshakeTimeout = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setStatus(readyOnTimeout ? 'ready' : 'error');
    }, HANDSHAKE_TIMEOUT_MS);
  }, [readyOnTimeout]);

  useEffect(() => {
    if (!routeUrl) return;
    setStatus('loading');
    setSize(initialSize ?? {});

    const onMessage = (event: MessageEvent) => {
      if (!isTrustedPluginIframeMessage(event, iframeRef.current?.contentWindow, expectedOrigin)) return;
      const message = parsePluginIframeHostMessage(event.data);
      if (!message) return;

      if (message.kind === 'ready') {
        clearTimeout(timeoutRef.current);
        setStatus('ready');
      }
      if (message.kind === 'navigate-tab' && isAllowedPluginNavigationTab(message.tab)) {
        const tab = message.tab;
        import('../components/channels/ChannelTabBar').then(m => m.switchTab(tab));
      }
      if (message.kind === 'resize') {
        const iframe = iframeRef.current;
        setSize(current => {
          const next = clampPluginIframeSize(slot, message.size, current, window.innerHeight);
          if (slot !== 'card' && iframe && typeof next.height === 'number') {
            iframe.style.height = `${next.height}px`;
          }
          return next;
        });
      }
    };

    window.addEventListener('message', onMessage);
    resetHandshakeTimeout();

    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timeoutRef.current);
    };
  }, [
    routeUrl,
    expectedOrigin,
    slot,
    initialSize?.width,
    initialSize?.height,
    resetHandshakeTimeout,
  ]);

  const postToIframe = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    if (!expectedOrigin) return;
    seqRef.current += 1;
    iframe.contentWindow.postMessage({ type, payload, seq: seqRef.current }, expectedOrigin);
  }, [expectedOrigin]);

  const retry = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setStatus('loading');
    setSize(initialSize ?? {});
    const iframe = iframeRef.current;
    if (iframe && routeUrl) {
      iframe.src = routeUrl;
    }
    resetHandshakeTimeout();
  }, [routeUrl, initialSize?.width, initialSize?.height, resetHandshakeTimeout]);

  return { iframeRef, status, size, postToIframe, retry };
}
