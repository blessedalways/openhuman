import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SkillSearchBar from '../SkillSearchBar';

describe('SkillSearchBar', () => {
  it('labels the search input accessibly', () => {
    render(<SkillSearchBar value="" onChange={() => {}} />);

    expect(screen.getByRole('textbox', { name: 'Search skills' })).toBeInTheDocument();
  });

  it('renders no clear button when the query is empty', () => {
    render(<SkillSearchBar value="" onChange={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('clears the query via a labeled clear button', () => {
    const onChange = vi.fn();
    render(<SkillSearchBar value="gmail" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('');
  });
});
