/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mocks = vi.hoisted(() => ({
  loadModels: vi.fn(),
  saveModel: vi.fn(),
}));

vi.mock('../../onboarding-actions', () => ({
  loadModels: (...args: unknown[]) => mocks.loadModels(...args),
  saveModel: (...args: unknown[]) => mocks.saveModel(...args),
}));

import { ModelStep } from '../ModelStep';

describe('ModelStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('t', (key: string) => key);
    mocks.loadModels.mockResolvedValue({
      models: [
        { id: 'deepseek-v4-flash' },
        { id: 'deepseek-v4-pro' },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps discovered models out of the added-model list until the user adds one', async () => {
    render(
      <ModelStep
        preview={false}
        hanaFetch={vi.fn()}
        providerName="deepseek"
        providerUrl="https://api.deepseek.com/v1"
        providerApi="openai-completions"
        apiKey="sk-test"
        goToStep={vi.fn()}
        showError={vi.fn()}
      />,
    );

    await waitFor(() => expect(mocks.loadModels).toHaveBeenCalled());

    expect(screen.getByText('onboarding.model.noAddedModels')).toBeInTheDocument();
    expect(screen.queryByText('deepseek-v4-flash')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.model.addModel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'deepseek-v4-flash' }));

    expect(screen.queryByText('onboarding.model.noAddedModels')).not.toBeInTheDocument();
    expect(screen.getByText('deepseek-v4-flash')).toBeInTheDocument();
    expect(screen.getByText('onboarding.model.mainModel')).toBeInTheDocument();
  });
});
