import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { VoiceSkillStatus } from '../../../features/voice/useVoiceSkillStatus';
import VoiceSetupModal from '../VoiceSetupModal';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-router-dom');
  return { ...actual, useNavigate: vi.fn(() => vi.fn()) };
});

vi.mock('../../../utils/tauriCommands/voice', () => ({
  openhumanUpdateVoiceServerSettings: vi.fn().mockResolvedValue(undefined),
  openhumanVoiceServerStart: vi.fn().mockResolvedValue(undefined),
}));

function idleSkillStatus(): VoiceSkillStatus {
  return {
    connectionStatus: 'disconnected',
    statusDot: 'stone',
    statusLabel: 'Not running',
    statusColor: 'text-stone-400',
    ctaLabel: 'Start',
    ctaVariant: 'primary',
    sttModelMissing: false,
    voiceStatus: null,
    serverStatus: null,
  };
}

describe('VoiceSetupModal', () => {
  it('blocks Escape while a voice server start is in flight', async () => {
    const { openhumanUpdateVoiceServerSettings } = await import(
      '../../../utils/tauriCommands/voice'
    );
    let resolveEnable!: (value: unknown) => void;
    vi.mocked(openhumanUpdateVoiceServerSettings).mockReturnValue(
      new Promise(resolve => {
        resolveEnable = resolve;
      }) as never
    );

    const onClose = vi.fn();
    render(<VoiceSetupModal onClose={onClose} skillStatus={idleSkillStatus()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Start Voice Server/i }));
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(document.querySelectorAll('.fixed.inset-0')[0]);

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveEnable({});
    });
    await waitFor(() => {
      expect(screen.getByText(/Voice Intelligence is Active/i)).toBeInTheDocument();
    });
    // Idle again: backdrop and Escape both close.
    fireEvent.click(document.querySelectorAll('.fixed.inset-0')[0]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
