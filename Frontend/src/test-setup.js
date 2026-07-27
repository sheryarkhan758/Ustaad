import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

/**
 * Unmount between tests.
 *
 * Testing Library registers this itself only when `globals: true`. This suite
 * runs with explicit imports, so the hook has to be registered here — without
 * it every render accumulates in the same document and `getByText` fails with
 * "found multiple elements", which reads like a component bug and is not one.
 */
afterEach(cleanup);

/**
 * `<dialog>` in jsdom.
 *
 * jsdom implements the element but not `showModal()` or `close()`, so any
 * component built on a real dialogue throws on mount — which reads like a
 * component defect and is an environment gap. `Modal` uses the platform
 * dialogue deliberately (focus trapping, inert background, Escape, the top
 * layer), and that decision should not be undone to make it testable.
 *
 * This is the smallest stand-in that lets the component behave: `open` is a
 * real reflected property, so toggling it is what the component already checks.
 * It does not emulate the top layer or the focus trap, and no test here asserts
 * on those — they are the platform's behaviour, not ours.
 */
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}
