import React, { useCallback, useEffect, useState } from 'react';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { MediaProviderDetail } from './media/MediaProviderDetail';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { SelectWidget } from '@/ui';
import styles from '../Settings.module.css';

interface MediaProvider {
  providerId: string;
  displayName?: string;
  hasCredentials: boolean;
  unavailableReason?: string | null;
  models: { id: string; name: string }[];
  availableModels: { id: string; name: string }[];
}

interface MediaConfig {
  defaultImageModel?: { id: string; provider: string };
  providerDefaults?: Record<string, any>;
  outputDir?: string;
  resolvedOutputDir?: string;
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 3v6h6" />
    </svg>
  );
}

function encodeConfigPatch(updates: Partial<MediaConfig>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(updates).map(([key, value]) => [key, value === undefined ? null : value]),
  );
}

function applyConfigPatch(prev: MediaConfig, updates: Partial<MediaConfig>): MediaConfig {
  const next: MediaConfig = { ...prev };
  for (const [key, value] of Object.entries(updates) as Array<[keyof MediaConfig, MediaConfig[keyof MediaConfig]]>) {
    if (value === undefined) delete next[key];
    else next[key] = value as any;
  }
  return next;
}

export function MediaTab() {
  const [providers, setProviders] = useState<Record<string, MediaProvider>>({});
  const [config, setConfig] = useState<MediaConfig>({});
  const [selected, setSelected] = useState<string | null>(null);
  const showToast = useSettingsStore(s => s.showToast);

  const load = useCallback(async () => {
    try {
      const res = await hanaFetch('/api/plugins/image-gen/providers');
      const data = await res.json();
      const nextProviders = data.providers || {};
      setProviders(nextProviders);
      setConfig(data.config || {});
      setSelected(current => {
        if (current && nextProviders[current]) return current;
        const ids = Object.keys(nextProviders);
        return ids.find(id => nextProviders[id]?.hasCredentials) || ids[0] || null;
      });
    } catch {
      // plugin may not be loaded yet
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const providerIds = Object.keys(providers);
  const allImageModels = providerIds.flatMap((providerId) =>
    (providers[providerId].models || []).map((model) => ({ ...model, provider: providerId })),
  );

  const saveConfig = async (updates: Partial<MediaConfig>) => {
    try {
      const agentId = useSettingsStore.getState().getSettingsAgentId();
      const query = agentId ? `?agentId=${agentId}` : '';
      const res = await hanaFetch(`/api/plugins/image-gen/config${query}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: encodeConfigPatch(updates) }),
      });
      const data = await res.json().catch(() => null);
      if (data?.config) setConfig(data.config);
      else if (data?.values) setConfig(data.values);
      else setConfig((prev) => applyConfigPatch(prev, updates));
      showToast(t('settings.saved'), 'success');
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error');
    }
  };

  const chooseOutputDir = async () => {
    const folder = await window.platform?.selectFolder?.();
    if (!folder) return;
    await saveConfig({ outputDir: folder });
  };

  const resetOutputDir = async () => {
    await saveConfig({ outputDir: '' });
  };

  return (
    <div className={`${styles['settings-tab-content']} ${styles.active}`} data-tab="media">
      <SettingsSection variant="double-column">
        <div className={styles['pv-layout']}>
          <div className={styles['pv-list']}>
            <div className={styles['pv-list-group-label']}>{t('settings.media.imageGeneration')}</div>
            {providerIds.map((providerId) => {
              const provider = providers[providerId];
              return (
                <button
                  key={providerId}
                  className={`${styles['pv-list-item']}${selected === providerId ? ` ${styles.selected}` : ''}${!provider.hasCredentials ? ` ${styles.dim}` : ''}`}
                  onClick={() => setSelected(providerId)}
                >
                  <span className={`${styles['pv-status-dot']}${provider.hasCredentials ? ` ${styles.on}` : ''}`} />
                  <span className={styles['pv-list-item-name']}>{provider.displayName || providerId}</span>
                  <span className={styles['pv-list-item-count']}>{provider.models.length}</span>
                </button>
              );
            })}

            <div className={styles['pv-list-divider']} />
            <div className={styles['pv-list-group-label']} style={{ color: 'var(--text-muted)' }}>
              {t('settings.media.speechRecognition')}
            </div>
            <div className={styles['pv-list-item']} style={{ opacity: 0.3, pointerEvents: 'none' }}>
              <span className={styles['pv-status-dot']} />
              <span className={styles['pv-list-item-name']} style={{ fontStyle: 'italic', fontSize: '0.7rem' }}>
                {t('settings.media.comingSoon')}
              </span>
            </div>

            <div className={styles['pv-list-divider']} />
            <div className={styles['pv-list-group-label']} style={{ color: 'var(--text-muted)' }}>
              {t('settings.media.speechSynthesis')}
            </div>
            <div className={styles['pv-list-item']} style={{ opacity: 0.3, pointerEvents: 'none' }}>
              <span className={styles['pv-status-dot']} />
              <span className={styles['pv-list-item-name']} style={{ fontStyle: 'italic', fontSize: '0.7rem' }}>
                {t('settings.media.comingSoon')}
              </span>
            </div>
          </div>

          <div className={styles['pv-detail']}>
            {selected && providers[selected] ? (
              <MediaProviderDetail
                providerId={selected}
                provider={providers[selected]}
                config={config}
                onSaveConfig={saveConfig}
                onRefresh={load}
              />
            ) : (
              <div className={styles['pv-empty']}>{t('settings.media.noProvider')}</div>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.media.globalDefault')}>
        <SettingsRow
          label={t('settings.media.defaultModel')}
          control={
            <SelectWidget
              value={config.defaultImageModel ? `${config.defaultImageModel.provider}/${config.defaultImageModel.id}` : ''}
              onChange={(value) => {
                if (!value) {
                  saveConfig({ defaultImageModel: undefined });
                  return;
                }
                const [provider, ...rest] = value.split('/');
                saveConfig({ defaultImageModel: { id: rest.join('/'), provider } });
              }}
              options={[
                { value: '', label: '-' },
                ...allImageModels.map((model) => {
                  const providerHasCredentials = providers[model.provider]?.hasCredentials === true;
                  const label = `${model.provider} / ${model.name || model.id}`;
                  return {
                    value: `${model.provider}/${model.id}`,
                    label: providerHasCredentials ? label : `${label} (${t('settings.media.credentialMissing')})`,
                    disabled: !providerHasCredentials,
                  };
                }),
              ]}
            />
          }
        />

        <SettingsRow
          label={t('settings.mediaExtra.outputDir')}
          control={(
            <div className={styles['pv-inline-action-row']}>
              <input
                className={styles['settings-input']}
                type="text"
                value={config.resolvedOutputDir || config.outputDir || ''}
                readOnly
                title={config.resolvedOutputDir || config.outputDir || ''}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                className={styles['pv-inline-icon-btn']}
                onClick={chooseOutputDir}
                title={t('settings.mediaExtra.chooseOutputDir')}
                aria-label={t('settings.mediaExtra.chooseOutputDir')}
              >
                <FolderIcon />
              </button>
              <button
                type="button"
                className={`${styles['pv-inline-icon-btn']} ${styles.danger}`}
                onClick={resetOutputDir}
                title={t('settings.mediaExtra.resetOutputDir')}
                aria-label={t('settings.mediaExtra.resetOutputDir')}
              >
                <ResetIcon />
              </button>
            </div>
          )}
        />
      </SettingsSection>
    </div>
  );
}
