import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from '../describe-error.js';
import { defaultStrings } from '../strings.js';

test('an Error yields its message', () => {
  assert.equal(describeError(new Error('tainted canvas')), 'tainted canvas');
});

test('an Error with no message falls back to its name, never to undefined', () => {
  assert.equal(describeError(new TypeError('')), 'TypeError');
});

test('a string is its own description', () => {
  assert.equal(describeError('  session expired  '), 'session expired');
});

/**
 * The production case: html-to-image rejects with a DOM `error` Event whose target is
 * the <img> that failed. `.message` is undefined and `String(it)` is
 * "[object Event]"; the src is the only useful thing in the object.
 */
test('a DOM error Event names the element that failed instead of printing undefined', () => {
  const event = { type: 'error', target: { tagName: 'IMG', src: 'https://cdn.example.com/logo.png' } };
  const described = describeError(event);
  assert.equal(described, 'could not load img https://cdn.example.com/logo.png');
  assert.doesNotMatch(described, /undefined|\[object/);
});

test('an Event on a target with no url still names the tag', () => {
  assert.equal(describeError({ type: 'error', target: { tagName: 'LINK' } }), 'could not load link');
});

test('an event with no usable target degrades to its type, not to [object Event]', () => {
  assert.equal(describeError({ type: 'abort' }), 'abort event');
});

test('a plain object with a message uses it', () => {
  assert.equal(describeError({ message: 'HTTP 502' }), 'HTTP 502');
});

test('anything else is a readable fallback, never undefined', () => {
  for (const value of [undefined, null, {}, 42, [], '']) {
    const described = describeError(value);
    assert.equal(described, defaultStrings.errorUnknown, `for ${JSON.stringify(value) ?? 'undefined'}`);
  }
});
