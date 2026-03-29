import React from 'react';
import { t } from '../../helpers';
import styles from '../../Settings.module.css';

interface Props {
  providerId: string;
  provider: { hasCredentials: boolean; models: { id: string; name: string }[] };
  config: { defaultImageModel?: { id: string; provider: string }; providerDefaults?: Record<string, any> };
  onSaveConfig: (updates: any) => Promise<void>;
  onRefresh: () => Promise<void>;
}

export function MediaProviderDetail({ providerId, provider, config, onSaveConfig }: Props) {
  const defaults = config.providerDefaults?.[providerId] || {};
  const isDefault = (modelId: string) =>
    config.defaultImageModel?.id === modelId && config.defaultImageModel?.provider === providerId;

  const updateDefault = (key: string, value: any) => {
    const current = config.providerDefaults || {};
    const provDefaults = { ...current[providerId], [key]: value };
    onSaveConfig({ providerDefaults: { ...current, [providerId]: provDefaults } });
  };

  return (
    <div className={styles['pv-detail-inner']}>
      <div className={styles['pv-detail-header']}>
        <h2 className={styles['pv-detail-title']}>{providerId}</h2>
      </div>

      {/* Credential status */}
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: provider.hasCredentials ? 'var(--success)' : 'var(--text-muted)',
          display: 'inline-block',
        }} />
        {provider.hasCredentials ? t('settings.media.credentialOk') : t('settings.media.credentialMissing')}
      </div>

      {/* Model list */}
      <div className={styles['pv-fav-title']}>
        {t('settings.media.models')}
        <span className={styles['pv-models-count']}>{provider.models.length}</span>
      </div>
      <div className={styles['pv-fav-list']}>
        {provider.models.map(m => (
          <div key={m.id} className={styles['pv-fav-item']}>
            <span className={styles['pv-fav-item-name']} title={m.id}>{m.name || m.id}</span>
            {isDefault(m.id) && (
              <span style={{
                fontSize: '0.6rem', color: 'var(--accent)',
                background: 'var(--accent-light)', padding: '1px 6px',
                borderRadius: '4px', fontWeight: 500,
              }}>
                {t('settings.media.default')}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Provider-specific defaults */}
      {provider.models.length > 0 && (
        <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--overlay-light)' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
            {t('settings.media.providerDefaults')}
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {t('settings.media.size')}
              </span>
              <select
                style={{ fontFamily: 'inherit', fontSize: '0.75rem', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)' }}
                value={defaults.size || ''}
                onChange={(e) => updateDefault('size', e.target.value || undefined)}
              >
                <option value="">默认</option>
                <option value="1024x1024">1024 × 1024</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {t('settings.media.format')}
              </span>
              <select
                style={{ fontFamily: 'inherit', fontSize: '0.75rem', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)' }}
                value={defaults.format || ''}
                onChange={(e) => updateDefault('format', e.target.value || undefined)}
              >
                <option value="">默认</option>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {t('settings.media.quality')}
              </span>
              <select
                style={{ fontFamily: 'inherit', fontSize: '0.75rem', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)' }}
                value={defaults.quality || ''}
                onChange={(e) => updateDefault('quality', e.target.value || undefined)}
              >
                <option value="">默认</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
