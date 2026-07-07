import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../src/renderer/components/review/ConfirmDialog.jsx';

// Direct component tests for the two ConfirmDialog branches — the gap
// documented by the H3 characterization suite (they gate on a >=75%
// top match and were not exercised through the DOM there). The real i18n
// catalog is used so assertions key off the actual Swedish strings.
//
// A2 note: the dialog now renders on the shared Modal (native <dialog>) base.
// Selectors were redirected from the old .confirm-overlay/.confirm-dialog/
// .btn-confirm/.btn-cancel structure to the Modal DOM (dialog element, the
// .modal__title heading and the .btn primitive buttons). Keyboard assertions
// target the dialog element (Enter is handled there; Esc arrives via the native
// `cancel` event) rather than document, matching the native-dialog contract.

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
    expect(container.querySelector('.modal__title').textContent).toBe('Bekräfta namnändring');
    const matchInfo = container.querySelector('.match-info').textContent;
    expect(matchInfo).toContain('Anna Andersson');
    expect(matchInfo).toContain('82%');
    expect(container.querySelector('.modal__message').textContent).toBe(
      'Du valde ”Berit” istället. Är du säker?',
    );
  });

  it('exposes aria-labelledby wired to the title', () => {
    const { container } = render(
      <ConfirmDialog
        type="name-mismatch"
        topMatch={topMatch}
        chosenName="Berit"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dialog = container.querySelector('dialog');
    const title = container.querySelector('.modal__title');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(title.id).toBeTruthy();
  });

  it('Enter confirms, the native cancel event cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        type="name-mismatch"
        topMatch={topMatch}
        chosenName="Berit"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = container.querySelector('dialog');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Esc is delivered by the browser as a `cancel` event on the dialog.
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
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
    expect(container.querySelector('.modal__title').textContent).toBe('Bekräfta ignorering');
    expect(container.querySelector('.modal__message').textContent).toBe(
      'Du valde att ignorera det här ansiktet. Är du säker?',
    );
    expect(container.querySelector('.match-info').textContent).toContain('Anna Andersson');
  });

  it('the buttons call onConfirm/onCancel; a backdrop click cancels', () => {
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
    const dialog = container.querySelector('dialog');
    fireEvent.click(container.querySelector('.btn--primary'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.btn--secondary'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    // Clicking the dialog element itself (the backdrop region) cancels.
    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(2);
    // Clicking inside the content does NOT cancel.
    fireEvent.click(container.querySelector('.modal__content'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
