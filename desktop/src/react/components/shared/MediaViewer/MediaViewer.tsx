import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../../stores';
import { isMediaKind } from '../../../utils/file-kind';
import { showError } from '../../../utils/ui-helpers';
import { ImageStage } from './ImageStage';
import { VideoStage } from './VideoStage';
import styles from './MediaViewer.module.css';

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function MediaViewer() {
  const state = useStore((s) => s.mediaViewer);
  const closeMediaViewer = useStore((s) => s.closeMediaViewer);
  const setMediaViewerCurrent = useStore((s) => s.setMediaViewerCurrent);

  const containerRef = useRef<HTMLDivElement>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const idleTimerRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 800, height: 600 });
  const [zoomCmd, setZoomCmd] = useState({ in: 0, out: 0, reset: 0 });
  const [saving, setSaving] = useState(false);

  const isOpen = !!state;

  useEffect(() => {
    if (!isOpen) return;
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isOpen]);

  const kickIdleTimer = useCallback(() => {
    setChromeVisible(true);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => setChromeVisible(false), 2500);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    kickIdleTimer();
    const onMove = () => kickIdleTimer();
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [isOpen, kickIdleTimer]);

  const currentIndex = useMemo(() => {
    if (!state) return -1;
    return state.files.findIndex((file) => file.id === state.currentId);
  }, [state]);

  const canPrev = currentIndex > 0;
  const canNext = state ? currentIndex >= 0 && currentIndex < state.files.length - 1 : false;

  const goPrev = useCallback(() => {
    if (!state || !canPrev) return;
    setMediaViewerCurrent(state.files[currentIndex - 1].id);
  }, [state, canPrev, currentIndex, setMediaViewerCurrent]);

  const goNext = useCallback(() => {
    if (!state || !canNext) return;
    setMediaViewerCurrent(state.files[currentIndex + 1].id);
  }, [state, canNext, currentIndex, setMediaViewerCurrent]);

  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ' ' && document.activeElement instanceof HTMLVideoElement) return;
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          closeMediaViewer();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          goPrev();
          break;
        case 'ArrowRight':
          event.preventDefault();
          goNext();
          break;
        case '+':
        case '=':
          event.preventDefault();
          setZoomCmd((cmd) => ({ ...cmd, in: cmd.in + 1 }));
          break;
        case '-':
          event.preventDefault();
          setZoomCmd((cmd) => ({ ...cmd, out: cmd.out + 1 }));
          break;
        case '0':
          event.preventDefault();
          setZoomCmd((cmd) => ({ ...cmd, reset: cmd.reset + 1 }));
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, closeMediaViewer, goPrev, goNext]);

  useEffect(() => {
    if (!state) return;
    const currentFile = state.files.find((file) => file.id === state.currentId);
    if (!currentFile || !isMediaKind(currentFile.kind)) {
      closeMediaViewer();
    }
  }, [state, closeMediaViewer]);

  const current = state?.files[currentIndex] || null;
  const currentValid = !!current && isMediaKind(current.kind);
  const prev = state && canPrev ? state.files[currentIndex - 1] : undefined;
  const next = state && canNext ? state.files[currentIndex + 1] : undefined;
  const multi = !!state && state.files.length > 1;

  const handleSaveAs = useCallback(async () => {
    const platform = (window as any).platform;
    if (!current || saving) return;
    if (!platform?.saveFileAs || !platform?.writeFileBinary) {
      showError('Save As is not available in this environment.');
      return;
    }

    try {
      setSaving(true);
      const destination = await platform.saveFileAs({ defaultPath: current.name });
      if (!destination) return;

      let base64: string | null = null;
      if (current.path && typeof platform.readFileBase64 === 'function') {
        base64 = await platform.readFileBase64(current.path);
      } else if (current.remoteUrl) {
        const res = await fetch(current.remoteUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error(`download failed: ${res.status}`);
        base64 = await arrayBufferToBase64(await res.arrayBuffer());
      }

      if (!base64) throw new Error('unable to read media content');
      const ok = await platform.writeFileBinary(destination, base64);
      if (!ok) throw new Error('write failed');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [current, saving]);

  const onOverlayClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) closeMediaViewer();
  };

  if (!state || !currentValid || !current) return null;

  return (
    <div
      ref={containerRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="media-viewer"
      data-testid="media-viewer-overlay"
      onClick={onOverlayClick}
    >
      <div className={`${styles.topbar} ${chromeVisible ? '' : styles.hidden}`}>
        <span className={styles.name} data-testid="media-viewer-name">{current.name}</span>
        {multi && (
          <span className={styles.index} data-testid="media-viewer-index">
            {currentIndex + 1} / {state.files.length}
          </span>
        )}
        <button
          className={styles.closeBtn}
          data-testid="media-viewer-save"
          aria-label="save-as"
          onClick={(event) => { event.stopPropagation(); handleSaveAs(); }}
          disabled={saving}
          title="Save As"
        >
          Save
        </button>
        <button
          className={styles.closeBtn}
          data-testid="media-viewer-close"
          aria-label="close"
          onClick={(event) => { event.stopPropagation(); closeMediaViewer(); }}
        >
          Close
        </button>
      </div>

      {multi && (
        <>
          <button
            className={`${styles.navBtn} ${styles.navPrev} ${chromeVisible ? '' : styles.hidden}`}
            data-testid="media-viewer-prev"
            aria-label="previous"
            disabled={!canPrev}
            onClick={(event) => { event.stopPropagation(); goPrev(); }}
          >
            {'<'}
          </button>
          <button
            className={`${styles.navBtn} ${styles.navNext} ${chromeVisible ? '' : styles.hidden}`}
            data-testid="media-viewer-next"
            aria-label="next"
            disabled={!canNext}
            onClick={(event) => { event.stopPropagation(); goNext(); }}
          >
            {'>'}
          </button>
        </>
      )}

      <div className={styles.stageWrap} onClick={(event) => event.stopPropagation()}>
        {current.kind === 'video' ? (
          <VideoStage file={current} viewport={viewport} />
        ) : (
          <ImageStage
            file={current}
            viewport={viewport}
            neighbors={{ prev, next }}
            zoomCmd={zoomCmd}
            key={current.id}
          />
        )}
      </div>
    </div>
  );
}
