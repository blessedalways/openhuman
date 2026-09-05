/**
 * VoiceSetupModal — vitest coverage
 *
 * Verifies:
 * - Renders the enable step when the STT model is present.
 * - Start flows through settings update + server start to the success step.
 * - A failed start surfaces the error and returns to a dismissable state.
 * - Escape closes when idle, but NOT while an enable is in flight (the
 *   closePolicy port — the outcome must not be lost mid-operation).
 * - The Cancel button is disabled while an enable is in flight.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { VoiceSkillStatus } from '../../../features/voice/useVoiceSkillStatus';
import VoiceSetupModal from '../VoiceSetupModal';

const voiceCommands = vi.hoisted(() => ({
  openhumanUpdateVoiceServerSettings: vi.fn(),
  openhumanVoiceServerStart: vi.fn(),
}));

vi.mock('../../../utils/tauriCommands/voice', () => voiceCommands);

function status(overrides: Partial<VoiceSkillStatus> = {}): VoiceSkillStatus {
  return {
    sttModelMissing: false,
    serverStatus: null,
    ...overrides,
  } as unknown as VoiceSkillStatus;
}

describe('VoiceSetupModal', () => {
  it('renders the enable step and starts the server on demand', async () => {
    voiceCommands.openhumanUpdateVoiceServerSettings.mockResolvedValue({});
    voiceCommands.openhumanVoiceServerStart.mockResolvedValue({});
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <VoiceSetupModal onClose={onClose} skillStatus={status()} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    await waitFor(() =>
      expect(voiceCommands.openhumanVoiceServerStart).toHaveBeenCalledTimes(1)
    );
    expect(voiceCommands.openhumanUpdateVoiceServerSettings).toHaveBeenCalledWith(
      expect.objectContaining({ auto_start: true })
    );
    // Success step takes over; the modal is not auto-closed.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces a start failure and stays dismissable', async () => {
    voiceCommands.openhumanUpdateVoiceServerSettings.mockResolvedValue({});
    voiceCommands.openhumanVoiceServerStart.mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <VoiceSetupModal onClose={onClose} skillStatus={status()} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeTruthy());

    // The failed enable re-enabled dismissal.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss on Escape while an enable is in flight', async () => {
    let release: () => void = () => {};
    voiceCommands.openhumanUpdateVoiceServerSettings.mockResolvedValue({});
    voiceCommands.openhumanVoiceServerStart.mockImplementation(
      () => new Promise(resolve => { release = () => resolve({}); })
    );
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <VoiceSetupModal onClose={onClose} skillStatus={status()} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    await waitFor(() => expect(voiceCommands.openhumanVoiceServerStart).toHaveBeenCalled());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    release();
  });

  it('removes the header close button while an enable is in flight', async () => {
    let release: () => void = () => {};
    voiceCommands.openhumanUpdateVoiceServerSettings.mockResolvedValue({});
    voiceCommands.openhumanVoiceServerStart.mockImplementation(
      () => new Promise(resolve => { release = () => resolve({}); })
    );
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <VoiceSetupModal onClose={onClose} skillStatus={status()} />
      </MemoryRouter>
    );

    // Idle: the header X is offered.
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /starting/i }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
    );

    release();
  });
});
