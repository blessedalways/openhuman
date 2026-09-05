/**
 * CoreJobList — vitest coverage
 *
 * Verifies:
 * - Renders each core job row with its action buttons.
 * - Removal is destructive and two-click: the first click arms a Confirm
 *   state, only the second click invokes onRemoveCoreJob.
 * - Blur on the armed button disarms it back to Remove.
 * - While a removal is in flight the button shows Removing… and is disabled.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CoreCronJob, CoreCronRun } from '../../../../utils/tauriCommands';
import CoreJobList from '../cron/CoreJobList';

function makeJob(overrides: Partial<CoreCronJob> = {}): CoreCronJob {
  return {
    id: 'job-1',
    expression: '* * * * *',
    schedule: { kind: 'cron', expr: '* * * * *' },
    command: 'echo hi',
    name: 'Hello Job',
    job_type: 'shell',
    session_target: 'isolated',
    enabled: true,
    delivery: { mode: 'console', best_effort: false },
    delete_after_run: false,
    created_at: '2026-01-01T00:00:00.000Z',
    next_run: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function renderList(
  overrides: {
    coreJobs?: CoreCronJob[];
    coreBusyKey?: string | null;
    onRemove?: (jobId: string) => void;
  } = {}
) {
  const props = {
    loading: false,
    coreJobs: overrides.coreJobs ?? [makeJob()],
    coreRunsByJob: {} as Record<string, CoreCronRun[]>,
    coreBusyKey: overrides.coreBusyKey ?? null,
    onToggleCoreJob: vi.fn(),
    onRunCoreJob: vi.fn(),
    onLoadCoreRuns: vi.fn(),
    onRemoveCoreJob: overrides.onRemove ?? vi.fn(),
  };
  render(<CoreJobList {...props} />);
  return props;
}

const removeButton = () => screen.getByTestId('cron-job-remove-job-1');

describe('CoreJobList — destructive remove safety', () => {
  it('renders the job row with its actions', () => {
    renderList();
    expect(screen.getByText('Hello Job')).toBeTruthy();
    expect(removeButton()).toBeTruthy();
  });

  it('needs a second click to actually remove a job', () => {
    const onRemove = vi.fn();
    renderList({ onRemove });

    fireEvent.click(removeButton());
    expect(onRemove).not.toHaveBeenCalled();
    expect(removeButton().textContent).toBe('Confirm');

    fireEvent.click(removeButton());
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('job-1');
  });

  it('cancels the confirm state when focus leaves the button', () => {
    renderList();

    fireEvent.click(removeButton());
    fireEvent.blur(removeButton());

    expect(removeButton().textContent).toBe('Remove');
  });

  it('shows Removing… and disables the button while removal is in flight', () => {
    renderList({ coreBusyKey: 'core-remove:job-1' });

    const removing = removeButton();
    expect(removing.textContent).toBe('Removing…');
    expect(removing).toBeDisabled();
  });
});
