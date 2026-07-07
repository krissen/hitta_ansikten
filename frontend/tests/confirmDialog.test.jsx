import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../src/renderer/components/review/ConfirmDialog.jsx';

// Direct component tests for the two ConfirmDialog branches — the gap
// documented by the H3 characterization suite (they gate on a >=75%
// top match and were not exercised through the DOM there). The real i18n
// catalog is used so assertions key off the actual Swedish strings.

afterEach(cleanup);

const topMatch = { name: 'Anna Andersson', confidence: 82 };

describe('ConfirmDialog — name-mismatch branch', () => {
  it('renders the name-change title, the best match and the chosen name', () => {
    const { container } = render(
      <ConfirmDialog
        type="name-mismatch"
        topMatch={topMatch}
        chosenName="Berit"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.querySelector('h3').textContent).toBe('Bekräfta namnändring');
    const matchInfo = container.querySelector('.match-info').textContent;
    expect(matchInfo).toContain('Anna Andersson');
    expect(matchInfo).toContain('82%');
    expect(container.querySelector('p').textContent).toBe(
      'Du valde "Berit" istället. Är du säker?',
    );
  });

  it('Enter confirms, Escape cancels (document-level keys)', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        type="name-mismatch"
        topMatch={topMatch}
        chosenName="Berit"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmDialog — high-confidence-ignore branch', () => {
  it('renders the ignore title and the ignore question', () => {
    const { container } = render(
      <ConfirmDialog
        type="ignore-high-confidence"
        topMatch={topMatch}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.querySelector('h3').textContent).toBe('Bekräfta ignorering');
    expect(container.querySelector('p').textContent).toBe(
      'Du valde att ignorera det här ansiktet. Är du säker?',
    );
    expect(container.querySelector('.match-info').textContent).toContain('Anna Andersson');
  });

  it('the buttons call onConfirm/onCancel; clicking the overlay cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        type="ignore-high-confidence"
        topMatch={topMatch}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(container.querySelector('.btn-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.btn-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    // Clicking the backdrop (not the dialog itself) also cancels.
    fireEvent.click(container.querySelector('.confirm-overlay'));
    expect(onCancel).toHaveBeenCalledTimes(2);
    // Clicking inside the dialog does NOT cancel (stopPropagation).
    fireEvent.click(container.querySelector('.confirm-dialog'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
