import { useEffect, useRef, useState } from 'react';
import type { FileRef } from '../../../types/file-ref';
import { loadMediaSource } from './media-source';
import { useMediaTransform } from './use-media-transform';
import styles from './MediaViewer.module.css';

// 注意：prop 名 `file` 不可改为 `ref`。React 会把 `ref` 当 forwardRef 的 ref 截获，
// 函数组件 props 里拿不到值，会导致 loadMediaSource(undefined) → 图片渲染不出来。
interface Props {
  file: FileRef;
  viewport: { width: number; height: number };
  neighbors?: { prev?: FileRef; next?: FileRef };
  onReady?: () => void;
  onError?: (e: unknown) => void;
}

export function ImageStage({ file, viewport, neighbors, onReady, onError }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);

  // 加载当前图
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setNatural(null);
    loadMediaSource(file)
      .then((s) => { if (!cancelled) setSrc(s.url); })
      .catch((err) => { if (!cancelled) onError?.(err); });
    return () => { cancelled = true; };
  }, [file.id]);

  // 邻近预加载（触发浏览器缓存）
  useEffect(() => {
    const preload = async (nf?: FileRef) => {
      if (!nf || nf.kind === 'video') return;
      try {
        const s = await loadMediaSource(nf);
        const img = new Image();
        img.src = s.url;
      } catch { /* ignore */ }
    };
    preload(neighbors?.prev);
    preload(neighbors?.next);
  }, [neighbors?.prev?.id, neighbors?.next?.id]);

  const transformApi = useMediaTransform({
    natural,
    viewport: { w: viewport.width, h: viewport.height },
  });

  const { cssTransform, onWheel, onPointerDown, onPointerMove, onPointerUp, onDoubleClick, fitScale, transform } = transformApi;

  const cursorStyle = transform.scale > fitScale + 0.01 ? 'grab' : 'default';

  return (
    <div
      className={styles.stage}
      data-testid="image-stage"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={{ transform: cssTransform, cursor: cursorStyle }}
    >
      {!src && <div className={styles.spinner} data-testid="image-stage-spinner" />}
      {src && (
        <img
          ref={imgElRef}
          src={src}
          alt={file.name}
          onLoad={(e) => {
            const el = e.currentTarget;
            setNatural({ w: el.naturalWidth, h: el.naturalHeight });
            onReady?.();
          }}
          draggable={false}
          className={styles.stageImg}
        />
      )}
    </div>
  );
}
