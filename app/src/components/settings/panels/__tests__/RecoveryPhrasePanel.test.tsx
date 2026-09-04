import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../../test/test-utils';
import RecoveryPhrasePanel from '../RecoveryPhrasePanel';

vi.mock('../../../../providers/CoreStateProvider', () => ({
  useCoreState: () => ({
    snapshot: { currentUser: null },
    setEncryptionKey: vi.fn(async () => undefined),
  }),
}));

vi.mock('../../../../services/walletApi', () => ({
  setupLocalWallet: vi.fn(async () => ({
    configured: true,
    onboardingCompleted: true,
    consentGranted: true,
    source: 'generated',
    mnemonicWordCount: 12,
    accounts: [],
    updatedAtMs: Date.now(),
  })),
}));

describe('RecoveryPhrasePanel — trust-surface polish', () => {
  it('renders the amber warning callout in generate mode', () => {
    const { container } = renderWithProviders(<RecoveryPhrasePanel />);
    expect(screen.getByText(/can never be recovered if lost/i)).toBeTruthy();
    // Polish guarantee: the disclaimer lives in its own amber callout,
    // not buried in body text.
    expect(container.querySelector('.bg-amber-50')).not.toBeNull();
  });

  it('renders import-mode intro copy when switching modes', () => {
    renderWithProviders(<RecoveryPhrasePanel />);
    fireEvent.click(screen.getByText(/I already have a recovery phrase/i));
    expect(screen.getByText(/Enter your recovery phrase below/i)).toBeTruthy();
  });

  it('uses palette token text-stone-700 on the confirm-checkbox label (not opacity)', () => {
    const { container } = renderWithProviders(<RecoveryPhrasePanel />);
    const label = screen.getByText(/consent to using it for local wallet setup/i);
    expect(label.className).toContain('text-stone-700');
    // Sanity: the old opacity hack is gone from this label.
    expect(label.className).not.toContain('opacity-80');
    expect(container).toBeTruthy();
  });
});

describe('RecoveryPhrasePanel — paste overflow feedback', () => {
  const TWELVE_WORDS =
    'abandon ability able about above absent absorb abstract absurd abuse access accident';

  function openImportMode() {
    renderWithProviders(<RecoveryPhrasePanel />);
    fireEvent.click(screen.getByText(/I already have a recovery phrase/i));
    return screen.getByLabelText('Recovery phrase word 1');
  }

  it('warns when pasting more words than the grid fits instead of silently dropping them', () => {
    const firstInput = openImportMode();
    fireEvent.change(firstInput, {
      target: { value: `${TWELVE_WORDS} extra` }, // 13 words into 12 slots
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/13 words pasted, but only 12 fit/i);
  });

  it('shows no warning when the pasted phrase matches an allowed length', () => {
    const firstInput = openImportMode();
    fireEvent.change(firstInput, { target: { value: TWELVE_WORDS } });

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the overflow warning when the word count selection changes', () => {
    const firstInput = openImportMode();
    fireEvent.change(firstInput, { target: { value: `${TWELVE_WORDS} extra` } });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '24' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
