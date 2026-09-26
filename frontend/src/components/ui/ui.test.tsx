import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge';
import { Modal } from './Modal';
import { Stepper } from './Stepper';
import { Tabs } from './Tabs';
import { Timeline } from './Timeline';

afterEach(cleanup);

describe('Tabs', () => {
  const tabs = [
    { id: 'a', label: 'Overview' },
    { id: 'b', label: 'Notes' },
  ];

  it('renders the tabs, marks the active one, and reports clicks', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="a" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: 'Overview' }).className).toContain('active');
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('roving tabIndex: only the active tab is a tab stop', () => {
    render(<Tabs tabs={tabs} active="a" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Notes' }).getAttribute('tabindex')).toBe('-1');
  });

  it('ArrowRight moves selection to the next tab (wrapping)', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="a" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('Stepper', () => {
  it('marks earlier steps done and the current one active', () => {
    const { container } = render(<Stepper steps={['Case', 'Metadata', 'File', 'Review']} current={2} />);
    const steps = Array.from(container.querySelectorAll('.step'));
    expect(steps).toHaveLength(4);
    expect(steps[0].className).toContain('done');
    expect(steps[1].className).toContain('done');
    expect(steps[2].className).toContain('active');
    expect(steps[3].className).not.toContain('active');
    expect(steps[0].textContent).toContain('completed');
    // a11y: the active step is marked aria-current
    expect(steps[2].getAttribute('aria-current')).toBe('step');
    expect(steps[0].getAttribute('aria-current')).toBeNull();
  });
});

describe('Modal', () => {
  it('closes on Escape and overlay click, but not on panel clicks', () => {
    const onClose = vi.fn();
    const { container } = render(<Modal title="Assign role" onClose={onClose}>content</Modal>);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('Timeline', () => {
  it('renders one toned item per entry', () => {
    const { container } = render(
      <Timeline items={[
        { key: '1', marker: '+', tone: 'ok', content: <span>created</span> },
        { key: '2', tone: 'danger', content: <span>removed</span> },
      ]}
      />,
    );
    const dots = Array.from(container.querySelectorAll('.tl-dot'));
    expect(dots[0].className).toContain('tone-ok');
    expect(dots[1].className).toContain('tone-danger');
    expect(container.textContent).toContain('created');
  });
});

describe('Badge', () => {
  it('applies the tone class', () => {
    render(<Badge tone="warn">Lead Investigator</Badge>);
    const el = screen.getByText('Lead Investigator');
    expect(el.className).toContain('badge');
    expect(el.className).toContain('tone-warn');
  });
});
