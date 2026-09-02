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

describe('CoreJobList — destructive remove safety', () => {
  it('needs a second click to actually remove a job', () => {
    const onRemove = vi.fn();
    renderList({ onRemove });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove?' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('job-1');
  });

  it('cancels the confirm state when focus leaves the button', () => {
    renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.blur(screen.getByRole('button', { name: 'Confirm remove?' }));

    expect(screen.queryByRole('button', { name: 'Confirm remove?' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('shows Removing… and disables the button while removal is in flight', () => {
    renderList({ coreBusyKey: 'core-remove:job-1' });

    const removing = screen.getByRole('button', { name: 'Removing…' });
    expect(removing).toBeDisabled();
  });
});
