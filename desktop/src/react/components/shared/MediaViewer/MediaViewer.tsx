import { useStore } from '../../../stores';
import styles from './MediaViewer.module.css';

export function MediaViewer() {
  const state = useStore(s => s.mediaViewer);
  if (!state) return null;
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="媒体预览"
      data-testid="media-viewer-overlay"
    />
  );
}
