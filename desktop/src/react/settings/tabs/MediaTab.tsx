import React, { useCallback, useEffect, useState } from 'react';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { updateSettingsSnapshot } from '../actions';
import { MediaProviderDetail } from './media/MediaProviderDetail';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { SelectWidget } from '@/ui';
import { Toggle } from '../widgets/Toggle';
import styles from '../Settings.module.css';

interface MediaProvider {
  providerId: string;
  displayName?: string;
  hasCredentials: boolean;
  unavailableReason?: string | null;
  models: { id: string; name: string; protocolId?: string; adapterAvailable?: boolean }[];
  availableModels: { id: string; name: string }[];
}

interface MediaConfig {
  defaultImageModel?: { id: string; provider: string };
  defaultVideoModel?: { id: string; provider: string };
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

interface SpeechModel {
  id: string;
  name?: string;
  displayName?: string;
  protocolId?: string;
  adapterAvailable?: boolean;
}

interface SpeechProvider {
  providerId: string;
  displayName?: string;
  hasCredentials: boolean;
  unavailableReason?: string | null;
  models: SpeechModel[];
  availableModels?: { id: string; name: string }[];
}

interface SpeechConfig {
  enabled: boolean;
  defaultModel?: { id: string; provider: string };
}

type SpeechConfigPatch = {
  enabled?: boolean;
  defaultModel?: SpeechConfig['defaultModel'] | null;
};

type MediaSelection =
  | { kind: 'imageGeneration'; providerId: string }
  | { kind: 'videoGeneration'; providerId: string }
  | { kind: 'speechRecognition'; providerId: string };

const LOADING_SELECT_VALUE = '__loading';

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

function encodeSpeechConfigPatch(updates: SpeechConfigPatch): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(updates).map(([key, value]) => [key, value === undefined ? null : value]),
  );
}

function applySpeechConfigPatch(prev: SpeechConfig, updates: SpeechConfigPatch): SpeechConfig {
  const next: SpeechConfig = { ...prev };
  if (typeof updates.enabled === 'boolean') next.enabled = updates.enabled;
  if ('defaultModel' in updates) {
    if (updates.defaultModel) next.defaultModel = updates.defaultModel;
    else delete next.defaultModel;
  }
  return next;
}

function mergeSpeechConfig(prev: SpeechConfig, incoming: any): SpeechConfig {
  const next: SpeechConfig = { ...prev };
  if (typeof incoming?.enabled === 'boolean') next.enabled = incoming.enabled;
  if (incoming && Object.prototype.hasOwnProperty.call(incoming, 'defaultModel')) {
    if (incoming.defaultModel) next.defaultModel = incoming.defaultModel;
    else delete next.defaultModel;
  }
  return next;
}

function speechModelLabel(model: SpeechModel | { id: string; name: string }): string {
  return 'displayName' in model && model.displayName ? model.displayName : model.name || model.id;
}

function getRunnableSpeechModels(provider: SpeechProvider): Array<{ id: string; name: string }> {
  if (!provider.hasCredentials) return [];
  if (Array.isArray(provider.availableModels)) {
    return provider.availableModels.map((model) => ({ id: model.id, name: model.name || model.id }));
  }
  return (provider.models || [])
    .filter((model) => model.adapterAvailable !== false)
    .map((model) => ({ id: model.id, name: speechModelLabel(model) }));
}

function textOrFallback(key: string, fallback: string): string {
  const value = t(key);
  return value === key ? fallback : value;
}

function SpeechProviderDetail({
  providerId,
  provider,
  config,
}: {
  providerId: string;
  provider: SpeechProvider;
  config: SpeechConfig | null;
}) {
  const runnableModels = getRunnableSpeechModels(provider);
  const isDefault = (modelId: string) =>
    config?.defaultModel?.id === modelId && config.defaultModel.provider === providerId;

  return (
    <div className={styles['pv-detail-inner']}>
      <div className={styles['pv-detail-header']}>
        <h2 className={styles['pv-detail-title']}>{provider.displayName || providerId}</h2>
      </div>

      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 'var(--space-16)', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: provider.hasCredentials ? 'var(--success)' : 'var(--text-muted)',
          display: 'inline-block',
        }} />
        {provider.hasCredentials ? t('settings.media.credentialOk') : t('settings.media.credentialMissing')}
      </div>

      <div className={styles['pv-models']}>
        <div className={styles['pv-fav-section']}>
          <div className={styles['pv-fav-title']}>
            {textOrFallback('settings.media.speechModels', '转录模型')}
            <span className={styles['pv-models-count']}>{runnableModels.length}</span>
          </div>
          {runnableModels.length > 0 ? (
            <div className={styles['pv-fav-list']}>
              {runnableModels.map((model) => (
                <div key={model.id} className={styles['pv-fav-item']}>
                  <span className={styles['pv-fav-item-name']} title={model.id}>{model.name || model.id}</span>
                  <span className={styles['pv-fav-item-id']}>{model.id}</span>
                  {isDefault(model.id) && (
                    <span style={{
                      fontSize: '0.6rem', color: 'var(--accent)',
                      background: 'var(--accent-light)', padding: '1px 6px',
                      borderRadius: '4px', fontWeight: 500, flexShrink: 0,
                    }}>
                      {t('settings.media.default')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles['pv-empty']}>{t('settings.media.noProvider')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MediaTab() {
  const snapshotSpeechConfig = useSettingsStore((s) => s.settingsSnapshot.data?.preferences?.speechRecognition);
  const [providers, setProviders] = useState<Record<string, MediaProvider>>({});
  const [config, setConfig] = useState<MediaConfig | null>(null);
  const [imageConfigLoading, setImageConfigLoading] = useState(true);
  const [videoProviders, setVideoProviders] = useState<Record<string, MediaProvider>>({});
  const [videoConfig, setVideoConfig] = useState<MediaConfig | null>(null);
  const [videoConfigLoading, setVideoConfigLoading] = useState(true);
  const [speechProviders, setSpeechProviders] = useState<Record<string, SpeechProvider>>({});
  const [speechConfig, setSpeechConfig] = useState<SpeechConfig | null>(() => (
    snapshotSpeechConfig ? mergeSpeechConfig({ enabled: false }, snapshotSpeechConfig) : null
  ));
  const [speechConfigLoading, setSpeechConfigLoading] = useState(() => !snapshotSpeechConfig);
  const [selected, setSelected] = useState<MediaSelection | null>(null);
  const showToast = useSettingsStore((s) => s.showToast);

  useEffect(() => {
    if (!snapshotSpeechConfig) return;
    setSpeechConfig(mergeSpeechConfig({ enabled: false }, snapshotSpeechConfig));
  }, [snapshotSpeechConfig]);

  const loadImageProviders = useCallback(async () => {
    setImageConfigLoading(true);
    try {
      const res = await hanaFetch('/api/media/image/providers');
      const data = await res.json();
      const nextProviders = data.providers || {};
      setProviders(nextProviders);
      setConfig(data.config || {});
      setSelected((current) => {
        if (current && current.kind !== 'imageGeneration') return current;
        if (current?.kind === 'imageGeneration' && nextProviders[current.providerId]) return current;
        const ids = Object.keys(nextProviders);
        const providerId = ids.find((id) => nextProviders[id]?.hasCredentials) || ids[0] || null;
        return providerId ? { kind: 'imageGeneration', providerId } : null;
      });
    } catch {
      setProviders({});
      setConfig({});
    } finally {
      setImageConfigLoading(false);
    }
  }, []);

  const loadVideoProviders = useCallback(async () => {
    setVideoConfigLoading(true);
    try {
      const res = await hanaFetch('/api/media/video/providers');
      const data = await res.json();
      const nextProviders = data.providers || {};
      setVideoProviders(nextProviders);
      setVideoConfig(data.config || {});
      setSelected(current => {
        if (current && current.kind !== 'videoGeneration') return current;
        if (current?.kind === 'videoGeneration' && nextProviders[current.providerId]) return current;
        const ids = Object.keys(nextProviders);
        const providerId = ids.find(id => nextProviders[id]?.hasCredentials) || ids[0] || null;
        return providerId ? { kind: 'videoGeneration', providerId } : null;
      });
    } catch {
      setVideoProviders({});
      setVideoConfig({});
    } finally {
      setVideoConfigLoading(false);
    }
  }, []);

  const loadSpeechProviders = useCallback(async () => {
    try {
      const res = await hanaFetch('/api/speech-recognition/providers');
      const data = await res.json();
      const nextProviders = data.providers || {};
      setSpeechProviders(nextProviders);
      setSpeechConfig(mergeSpeechConfig({ enabled: false }, data.config || {}));
      setSelected((current) => {
        if (current?.kind !== 'speechRecognition') return current;
        if (nextProviders[current.providerId]) return current;
        return null;
      });
    } catch (err: any) {
      setSpeechProviders({});
      showToast(err.message || 'Failed to load speech recognition providers', 'error');
    } finally {
      setSpeechConfigLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadImageProviders();
    loadVideoProviders();
    loadSpeechProviders();
  }, [loadImageProviders, loadVideoProviders, loadSpeechProviders]);

  const providerIds = Object.keys(providers);
  const videoProviderIds = Object.keys(videoProviders);
  const speechProviderIds = Object.keys(speechProviders);
  const allImageModels = providerIds.flatMap((providerId) =>
    (providers[providerId].models || []).map((model) => ({ ...model, provider: providerId })),
  );
  const allVideoModels = videoProviderIds.flatMap((providerId) =>
    (videoProviders[providerId].models || []).map((model) => ({ ...model, provider: providerId })),
  );
  const allSpeechModels = speechProviderIds.flatMap((providerId) =>
    getRunnableSpeechModels(speechProviders[providerId]).map((model) => ({ ...model, provider: providerId })),
  );
  const speechEnabled = speechConfig?.enabled === true;
  const speechRecognitionEnabledLabel = textOrFallback('settings.media.speechRecognitionEnabled', '发送语音条时转录');
  const defaultSpeechModelLabel = textOrFallback('settings.media.defaultSpeechModel', '语音条转录模型');
  const selectedImageProviderId = selected?.kind === 'imageGeneration' ? selected.providerId : null;
  const selectedVideoProviderId = selected?.kind === 'videoGeneration' ? selected.providerId : null;
  const selectedSpeechProviderId = selected?.kind === 'speechRecognition' ? selected.providerId : null;
  const imageConfigReady = !imageConfigLoading && config !== null;
  const imageDefaultValue = imageConfigReady && config?.defaultImageModel
    ? `${config.defaultImageModel.provider}/${config.defaultImageModel.id}`
    : imageConfigReady ? '' : LOADING_SELECT_VALUE;
  const videoConfigReady = !videoConfigLoading && videoConfig !== null;
  const videoDefaultValue = videoConfigReady && videoConfig?.defaultVideoModel
    ? `${videoConfig.defaultVideoModel.provider}/${videoConfig.defaultVideoModel.id}`
    : videoConfigReady ? '' : LOADING_SELECT_VALUE;
  const speechConfigReady = !speechConfigLoading && speechConfig !== null;
  const speechDefaultValue = speechConfigReady && speechConfig?.defaultModel
    ? `${speechConfig.defaultModel.provider}/${speechConfig.defaultModel.id}`
    : speechConfigReady ? '' : LOADING_SELECT_VALUE;

  const saveConfig = async (updates: Partial<MediaConfig>) => {
    try {
      const res = await hanaFetch('/api/media/image/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: encodeConfigPatch(updates) }),
      });
      const data = await res.json().catch(() => null);
      if (data?.config) setConfig(data.config);
      else if (data?.values) setConfig(data.values);
      else setConfig((prev) => applyConfigPatch(prev || {}, updates));
      showToast(t('settings.saved'), 'success');
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error');
    }
  };

  const saveImageOutputDirConfig = async (updates: Partial<MediaConfig>) => {
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
      else setConfig((prev) => applyConfigPatch(prev || {}, updates));
      showToast(t('settings.saved'), 'success');
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error');
    }
  };

  const saveVideoConfig = async (updates: Partial<MediaConfig>) => {
    try {
      const res = await hanaFetch('/api/media/video/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: encodeConfigPatch(updates) }),
      });
      const data = await res.json().catch(() => null);
      if (data?.values) setVideoConfig(data.values);
      else setVideoConfig(prev => applyConfigPatch(prev || {}, updates));
      showToast(t('settings.saved'), 'success');
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error');
    }
  };

  const saveSpeechConfig = async (updates: SpeechConfigPatch) => {
    try {
      const res = await hanaFetch('/api/speech-recognition/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: encodeSpeechConfigPatch(updates) }),
      });
      const data = await res.json().catch(() => null);
      setSpeechConfig((prev) => {
        const base = prev || { enabled: false };
        const next = data?.config
          ? mergeSpeechConfig(base, data.config)
          : data?.values
            ? mergeSpeechConfig(base, data.values)
            : applySpeechConfigPatch(base, updates);
        updateSettingsSnapshot((snapshot) => ({
          ...snapshot,
          preferences: { ...snapshot.preferences, speechRecognition: next },
        }));
        return next;
      });
      showToast(t('settings.saved'), 'success');
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error');
    }
  };

  const chooseOutputDir = async () => {
    const folder = await window.platform?.selectFolder?.();
    if (!folder) return;
    await saveImageOutputDirConfig({ outputDir: folder });
  };

  const resetOutputDir = async () => {
    await saveImageOutputDirConfig({ outputDir: '' });
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
                  className={`${styles['pv-list-item']}${selectedImageProviderId === providerId ? ` ${styles.selected}` : ''}${!provider.hasCredentials ? ` ${styles.dim}` : ''}`}
                  onClick={() => setSelected({ kind: 'imageGeneration', providerId })}
                >
                  <span className={`${styles['pv-status-dot']}${provider.hasCredentials ? ` ${styles.on}` : ''}`} />
                  <span className={styles['pv-list-item-name']}>{provider.displayName || providerId}</span>
                  <span className={styles['pv-list-item-count']}>{provider.models.length}</span>
                </button>
              );
            })}

            <div className={styles['pv-list-divider']} />
            <div className={styles['pv-list-group-label']}>{t('settings.media.videoGeneration')}</div>
            {videoProviderIds.map((providerId) => {
              const provider = videoProviders[providerId];
              return (
                <button
                  key={providerId}
                  className={`${styles['pv-list-item']}${selectedVideoProviderId === providerId ? ` ${styles.selected}` : ''}${!provider.hasCredentials ? ` ${styles.dim}` : ''}`}
                  onClick={() => setSelected({ kind: 'videoGeneration', providerId })}
                >
                  <span className={`${styles['pv-status-dot']}${provider.hasCredentials ? ` ${styles.on}` : ''}`} />
                  <span className={styles['pv-list-item-name']}>{provider.displayName || providerId}</span>
                  <span className={styles['pv-list-item-count']}>{provider.models.length}</span>
                </button>
              );
            })}

            <div className={styles['pv-list-divider']} />
            <div className={styles['pv-list-group-label']}>
              {t('settings.media.speechRecognition')}
            </div>
            {speechProviderIds.map((providerId) => {
              const provider = speechProviders[providerId];
              const runnableCount = getRunnableSpeechModels(provider).length;
              return (
                <button
                  key={providerId}
                  type="button"
                  className={`${styles['pv-list-item']}${selectedSpeechProviderId === providerId ? ` ${styles.selected}` : ''}${!provider.hasCredentials || runnableCount === 0 ? ` ${styles.dim}` : ''}`}
                  onClick={() => setSelected({ kind: 'speechRecognition', providerId })}
                  title={provider.unavailableReason || undefined}
                >
                  <span className={`${styles['pv-status-dot']}${provider.hasCredentials && runnableCount > 0 ? ` ${styles.on}` : ''}`} />
                  <span className={styles['pv-list-item-name']}>{provider.displayName || providerId}</span>
                  <span className={styles['pv-list-item-count']}>{runnableCount}</span>
                </button>
              );
            })}

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
            {selectedImageProviderId && providers[selectedImageProviderId] ? (
              <MediaProviderDetail
                providerId={selectedImageProviderId}
                provider={providers[selectedImageProviderId]}
                capability="imageGeneration"
                config={config || {}}
                onSaveConfig={saveConfig}
                onRefresh={loadImageProviders}
              />
            ) : selectedVideoProviderId && videoProviders[selectedVideoProviderId] ? (
              <MediaProviderDetail
                providerId={selectedVideoProviderId}
                provider={videoProviders[selectedVideoProviderId]}
                capability="videoGeneration"
                config={videoConfig || {}}
                onSaveConfig={saveVideoConfig}
                onRefresh={loadVideoProviders}
              />
            ) : selectedSpeechProviderId && speechProviders[selectedSpeechProviderId] ? (
              <SpeechProviderDetail
                providerId={selectedSpeechProviderId}
                provider={speechProviders[selectedSpeechProviderId]}
                config={speechConfig}
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
              value={imageDefaultValue}
              onChange={(value) => {
                if (value === LOADING_SELECT_VALUE) return;
                if (!value) {
                  saveConfig({ defaultImageModel: undefined });
                  return;
                }
                const [provider, ...rest] = value.split('/');
                saveConfig({ defaultImageModel: { id: rest.join('/'), provider } });
              }}
              disabled={!imageConfigReady}
              options={[
                ...(imageConfigReady ? [{ value: '', label: '-' }] : [{ value: LOADING_SELECT_VALUE, label: t('common.loading'), disabled: true }]),
                ...(imageConfigReady && config?.defaultImageModel && !allImageModels.some((model) => `${model.provider}/${model.id}` === imageDefaultValue)
                  ? [{
                      value: imageDefaultValue,
                      label: `${config.defaultImageModel.provider} / ${config.defaultImageModel.id}`,
                      disabled: true,
                    }]
                  : []),
                ...(imageConfigReady ? allImageModels.map((model) => {
                  const providerHasCredentials = providers[model.provider]?.hasCredentials === true;
                  const adapterAvailable = model.adapterAvailable !== false;
                  const label = `${model.provider} / ${model.name || model.id}`;
                  const unavailableReason = !providerHasCredentials
                    ? t('settings.media.credentialMissing')
                    : !adapterAvailable
                      ? t('settings.media.adapterMissing')
                      : '';
                  return {
                    value: `${model.provider}/${model.id}`,
                    label: unavailableReason ? `${label} (${unavailableReason})` : label,
                    disabled: !providerHasCredentials || !adapterAvailable,
                  };
                }) : []),
              ]}
            />
          }
        />
        <SettingsRow
          label={t('settings.media.defaultVideoModel')}
          control={
            <SelectWidget
              value={videoDefaultValue}
              onChange={(val) => {
                if (val === LOADING_SELECT_VALUE) return;
                if (!val) {
                  saveVideoConfig({ defaultVideoModel: undefined });
                  return;
                }
                const [provider, ...rest] = val.split('/');
                saveVideoConfig({ defaultVideoModel: { provider, id: rest.join('/') } });
              }}
              disabled={!videoConfigReady}
              options={[
                ...(videoConfigReady ? [{ value: '', label: '—' }] : [{ value: LOADING_SELECT_VALUE, label: t('common.loading'), disabled: true }]),
                ...(videoConfigReady && videoConfig?.defaultVideoModel && !allVideoModels.some(m => `${m.provider}/${m.id}` === videoDefaultValue)
                  ? [{
                      value: videoDefaultValue,
                      label: `${videoConfig.defaultVideoModel.provider} / ${videoConfig.defaultVideoModel.id}`,
                      disabled: true,
                    }]
                  : []),
                ...(videoConfigReady ? allVideoModels.map(m => {
                  const providerHasCredentials = videoProviders[m.provider]?.hasCredentials === true;
                  const adapterAvailable = m.adapterAvailable !== false;
                  const label = `${m.provider} / ${m.name || m.id}`;
                  const unavailableReason = !providerHasCredentials
                    ? t('settings.media.credentialMissing')
                    : !adapterAvailable
                      ? t('settings.media.videoAdapterMissing')
                      : '';
                  return {
                    value: `${m.provider}/${m.id}`,
                    label: unavailableReason ? `${label} (${unavailableReason})` : label,
                    disabled: !providerHasCredentials || !adapterAvailable,
                  };
                }) : []),
              ]}
            />
          }
        />
        <SettingsRow
          label={speechRecognitionEnabledLabel}
          control={
            <Toggle
              ariaLabel={speechRecognitionEnabledLabel}
              on={speechConfig ? speechEnabled : undefined}
              onChange={(enabled) => saveSpeechConfig({ enabled })}
            />
          }
        />
        <SettingsRow
          label={defaultSpeechModelLabel}
          control={
            <SelectWidget
              value={speechDefaultValue}
              onChange={(value) => {
                if (value === LOADING_SELECT_VALUE) return;
                if (!value) {
                  saveSpeechConfig({ defaultModel: undefined });
                  return;
                }
                const [provider, ...rest] = value.split('/');
                saveSpeechConfig({ defaultModel: { id: rest.join('/'), provider } });
              }}
              disabled={!speechConfigReady || !speechEnabled || (allSpeechModels.length === 0 && !speechConfig?.defaultModel)}
              options={[
                ...(speechConfigReady ? [{ value: '', label: '-' }] : [{ value: LOADING_SELECT_VALUE, label: t('common.loading'), disabled: true }]),
                ...(speechConfigReady && speechConfig?.defaultModel && !allSpeechModels.some((model) => `${model.provider}/${model.id}` === speechDefaultValue)
                  ? [{
                      value: speechDefaultValue,
                      label: `${speechConfig.defaultModel.provider} / ${speechConfig.defaultModel.id}`,
                      disabled: true,
                    }]
                  : []),
                ...(speechConfigReady && speechEnabled ? allSpeechModels.map((model) => ({
                  value: `${model.provider}/${model.id}`,
                  label: `${model.provider} / ${model.name || model.id}`,
                })) : []),
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
                value={config?.resolvedOutputDir || config?.outputDir || ''}
                readOnly
                title={config?.resolvedOutputDir || config?.outputDir || ''}
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
