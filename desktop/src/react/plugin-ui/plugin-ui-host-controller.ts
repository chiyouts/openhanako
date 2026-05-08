import {
  PLUGIN_UI_CAPABILITY,
  parsePluginUiMessage,
} from '@hana/plugin-protocol';

export type PluginIframeStatus = 'loading' | 'ready' | 'error';
export type PluginUiSlot = 'page' | 'widget' | 'card' | 'settings';

export interface PluginIframeSize {
  width?: number;
  height?: number;
}

export type PluginIframeHostMessage =
  | { kind: 'ready' }
  | { kind: 'navigate-tab'; tab: string }
  | { kind: 'resize'; size: PluginIframeSize };

const CARD_MIN_WIDTH = 50;
const CARD_MAX_WIDTH = 400;
const CARD_MIN_HEIGHT = 30;
const CARD_MAX_HEIGHT = 600;
const SURFACE_MIN_HEIGHT = 100;
const SURFACE_CHROME_HEIGHT = 48;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function getPluginIframeOrigin(routeUrl: string | null): string | null {
  if (!routeUrl) return null;
  try {
    return new URL(routeUrl).origin;
  } catch (err) {
    console.warn('[plugin-iframe] invalid routeUrl, messaging disabled:', routeUrl, err);
    return null;
  }
}

export function isTrustedPluginIframeMessage(
  event: MessageEvent,
  iframeWindow: Window | null | undefined,
  expectedOrigin: string | null,
): boolean {
  if (!iframeWindow) return false;
  if (!expectedOrigin) return false;
  if (event.source !== iframeWindow) return false;
  return event.origin === expectedOrigin;
}

export function parsePluginIframeHostMessage(data: unknown): PluginIframeHostMessage | null {
  if (!isObject(data)) return null;

  if (data.protocol === undefined) {
    if (data.type === 'ready') return { kind: 'ready' };

    if (data.type === 'navigate-tab' && isObject(data.payload) && typeof data.payload.tab === 'string') {
      return { kind: 'navigate-tab', tab: data.payload.tab };
    }

    if (data.type === 'resize-request' && isObject(data.payload)) {
      const width = numberField(data.payload.width);
      const height = numberField(data.payload.height);
      if (width === undefined && height === undefined) return null;
      return { kind: 'resize', size: { width, height } };
    }

    return null;
  }

  const parsed = parsePluginUiMessage(data);
  if (!parsed.ok) return null;

  const message = parsed.value;
  if (message.kind !== 'event') return null;

  if (message.type === 'hana.ready') return { kind: 'ready' };

  if (message.type === PLUGIN_UI_CAPABILITY.UI_RESIZE && isObject(message.payload)) {
    const width = numberField(message.payload.width);
    const height = numberField(message.payload.height);
    if (width === undefined && height === undefined) return null;
    return { kind: 'resize', size: { width, height } };
  }

  return null;
}

export function clampPluginIframeSize(
  slot: PluginUiSlot,
  requested: PluginIframeSize,
  current: PluginIframeSize,
  viewportHeight: number,
): PluginIframeSize {
  if (slot === 'card') {
    const width = requested.width !== undefined && requested.width >= CARD_MIN_WIDTH
      ? Math.min(requested.width, CARD_MAX_WIDTH)
      : current.width;
    const height = requested.height !== undefined && requested.height >= CARD_MIN_HEIGHT
      ? Math.min(requested.height, CARD_MAX_HEIGHT)
      : current.height;
    return { width, height };
  }

  const maxHeight = Math.max(SURFACE_MIN_HEIGHT, viewportHeight - SURFACE_CHROME_HEIGHT);
  const height = requested.height !== undefined
    ? Math.max(SURFACE_MIN_HEIGHT, Math.min(requested.height, maxHeight))
    : current.height;
  return { width: current.width, height };
}
