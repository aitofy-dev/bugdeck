/**
 * The picker's one judgement is "which entry of the hit stack does the user
 * mean", and it is exactly what was broken in production: the outline never moved
 * because the answer kept coming back as widget chrome (→ null). Fixture stack,
 * no DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstForeignElement, isOwnUi } from '../ElementPicker.js';
import { WIDGET_ROOT_ATTR } from '../capture.js';
import { applyImportant, pickerBox, pickerLayerDecls } from '../styles.js';

/** Enough of an Element for the owner test: `closest`, and an id to assert on. */
const node = (id: string, own = false): Element =>
  ({
    id,
    closest: (selector: string) => (own && selector === `[${WIDGET_ROOT_ATTR}]` ? { id: 'root' } : null),
  }) as unknown as Element;

test('the widget never picks itself', () => {
  assert.equal(isOwnUi(node('banner', true)), true);
  assert.equal(isOwnUi(node('table')), false);
  assert.equal(isOwnUi(null), true);
});

test('the topmost element the widget does not own is the one picked', () => {
  const stack = [node('picker-banner', true), node('card'), node('main'), node('body')];
  assert.equal(firstForeignElement(stack)?.id, 'card');
});

test('a stack that is only widget chrome picks nothing rather than the wrong thing', () => {
  assert.equal(firstForeignElement([node('banner', true), node('outline', true)]), null);
  assert.equal(firstForeignElement([]), null);
});

test('an iframe or canvas is picked as itself — the shot is of that box', () => {
  const stack = [node('iframe'), node('body')];
  assert.equal(firstForeignElement(stack)?.id, 'iframe');
});

/**
 * The second thing that was broken, and the one a DOM assertion cannot
 * see: WHERE the outline sits in the stack. It had no z-index at all, so the
 * host's fixed sidebar (`z-10`) painted over it. The layer now declares one —
 * and declares it at a weight a host stylesheet cannot outrank.
 */
test('the picker layer declares its own stacking, above host chrome', () => {
  const decls = pickerLayerDecls(2_147_483_000);
  assert.equal(decls['z-index'], '2147483000');
  assert.equal(decls.position, 'fixed');
  assert.equal(decls['pointer-events'], 'none');
  // A transform on the layer would make it the containing block for its own
  // fixed children and can clip them; pin the neutralisers too.
  assert.equal(decls.transform, 'none');
  assert.equal(decls.filter, 'none');
});

test('every layer declaration is written !important, or the host can hide it', () => {
  const written: string[] = [];
  applyImportant(
    { setProperty: (property, value, priority) => written.push(`${property}:${value}:${priority}`) },
    { position: 'fixed', 'z-index': '9' },
  );
  assert.deepEqual(written, ['position:fixed:important', 'z-index:9:important']);
});

/**
 * The ring is INSET. A 2px border outside the rect leaves the viewport as soon
 * as the hovered element reaches a screen edge, and a full-width admin panel
 * reaches three at once — which is how "the highlight" managed to be entirely
 * off-screen while its rect was correct.
 */
test('the outline never grows past the element it marks', () => {
  const box = pickerBox({ top: 0, left: 0, width: 1200, height: 800 });
  assert.equal(box.top, 0);
  assert.equal(box.left, 0);
  assert.equal(box.width, 1200);
  assert.equal(box.height, 800);
  assert.match(String(box.boxShadow), /inset/);
});
