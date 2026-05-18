import type { FileRef } from '../../../types/file-ref';
import { useStore } from '../../../stores';
import { resolveServerConnection } from '../../../services/server-connection';
import { resolveFileRefUrl } from '../../../services/resource-url';

export interface MediaSource {
  url: string;
  cleanup?: () => void;
}

/**
 * Resolve a FileRef to a URL consumable by <img> / <video>.
 *
 * Local desktop connections prefer platform.getFileUrl so local images stay on
 * disk and do not inflate the renderer heap. Remote clients use resource
 * content links instead of exposing server-local paths.
 */
export async function loadMediaSource(ref: FileRef): Promise<MediaSource> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- preload injects window.platform at runtime.
  const platform = (window as any).platform;

  if (ref.kind !== 'image' && ref.kind !== 'svg' && ref.kind !== 'video') {
    throw new Error(`unsupported media kind: ${ref.kind}`);
  }

  const connection = resolveServerConnection(useStore.getState());
  const source = resolveFileRefUrl(ref, { connection, platform });
  return { url: source.url };
}
