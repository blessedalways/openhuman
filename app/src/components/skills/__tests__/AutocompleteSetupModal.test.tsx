import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AutocompleteSetupModal from '../AutocompleteSetupModal';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-router-dom');
  return { ...actual, useNavigate: vi.fn(() => vi.fn()) };
});

vi.mock('../../../providers/CoreStateProvider', () => ({
  useCoreState: () => ({
    snapshot: {
      runtime: {
        autocomplete: {
          platform_supported: true,
          debounce_ms: 120,
        },
      },
    },
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../utils/tauriCommands/autocomplete', () => ({
  openhumanAutocompleteSetStyle: vi.fn().mockResolvedValue(undefined),
  openhumanAutocompleteStart: vi.fn().mockResolvedValue(undefined),
}));

function dialogCloseButton(): HTMLButtonElement {
  // The header X is the first button inside the dialog.
  const dialog = document.querySelector('[role="dialog"]');
  const x = dialog?.querySelector('button');
  if (!x) throw new Error('dialog close button not found');
  return x as HTMLButtonElement;
}

describe('AutocompleteSetupModal', () => {
  it('closes on Escape or backdrop click while idle', () => {
    const onClose = vi.fn();
    render(<AutocompleteSetupModal onClose={onClose} />);

    fireEvent.click(document.querySelectorAll('.fixed.inset-0')[0]);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('blocks Escape, backdrop, and X close while an enable is in flight', async () => {
    const { openhumanAutocompleteSetStyle } = await import(
      '../../../utils/tauriCommands/autocomplete'
    );
    let resolveEnable!: (value: unknown) => void;
    vi.mocked(openhumanAutocompleteSetStyle).mockReturnValue(
      new Promise(resolve => {
        resolveEnable = resolve;
      }) as never
    );

    const onClose = vi.fn();
    render(<AutocompleteSetupModal onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Enable Auto-Complete/i }));
    });

    // All three dismiss paths must be inert mid-enable so the outcome isn't lost.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(dialogCloseButton());
    fireEvent.click(document.querySelectorAll('.fixed.inset-0')[0]);
    await act(async () => {});

    expect(onClose).not.toHaveBeenCalled();

    // Once the enable settles, the modal may close again.
    await act(async () => {
      resolveEnable({});
    });
    await waitFor(() => {
      expect(screen.getByText(/Auto-Complete is Active/i)).toBeInTheDocument();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
