import { describe, expect, it, vi } from 'vitest';
import { saveModel } from '../onboarding-actions';
import type { HanaFetch } from '../onboarding-actions';

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe('onboarding saveModel', () => {
  it('persists only models the user explicitly added to the provider', async () => {
    const hanaFetch = vi.fn<HanaFetch>(async () => jsonResponse({ ok: true }));

    await saveModel({
      hanaFetch,
      providerName: 'deepseek',
      selectedModel: 'deepseek-v4-pro',
      selectedUtility: 'deepseek-v4-flash',
      selectedUtilityLarge: 'deepseek-v4-pro',
      addedModels: [
        'deepseek-v4-flash',
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      ],
      fetchedModels: [
        { id: 'deepseek-v4-flash' },
        { id: 'deepseek-v4-pro' },
        { id: 'deepseek-v4-unused' },
      ],
    } as Parameters<typeof saveModel>[0] & {
      addedModels: Array<string | { id: string; name?: string }>;
    });

    const providerSaveCall = hanaFetch.mock.calls.find(([path, options]) => {
      const body = JSON.parse(String(options?.body));
      return path === '/api/agents/hanako/config' && body.providers;
    });

    expect(providerSaveCall).toBeTruthy();
    const body = JSON.parse(String(providerSaveCall?.[1]?.body));
    expect(body.providers.deepseek.models).toEqual([
      'deepseek-v4-flash',
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    ]);
  });
});
