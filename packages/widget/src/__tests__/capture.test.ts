/**
 * `html-to-image` is never loaded here: `toPng` is injected, and the real one is
 * behind a dynamic import, so this file runs in plain Node with no DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_IMAGE_PLACEHOLDER,
  WIDGET_ROOT_ATTR,
  captureScreenshot,
  dataUrlToFile,
  withTimeout,
} from '../capture.js';

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`;

test('dataUrlToFile decodes base64 into a png File', async () => {
  const file = dataUrlToFile(PNG_DATA_URL, 'screenshot.png');
  assert.equal(file.name, 'screenshot.png');
  assert.equal(file.type, 'image/png');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), PNG_BYTES);
});

test('dataUrlToFile rejects anything that is not a data URL', () => {
  assert.throws(() => dataUrlToFile('https://example.com/a.png', 'a.png'), /invalid image/i);
  assert.throws(() => dataUrlToFile('', 'a.png'), /invalid image/i);
});

test('captureScreenshot passes pixelRatio 1 and no cache-busting to html-to-image', async () => {
  let options: Record<string, unknown> | undefined;
  const node = {} as HTMLElement;

  const file = await captureScreenshot(node, {
    toPng: async (target, opts) => {
      assert.equal(target, node);
      options = opts;
      return PNG_DATA_URL;
    },
  });

  assert.equal(options?.pixelRatio, 1);
  // Was `true`. It re-fetched every image on every shot for no benefit once
  // failures degrade to a placeholder — see the comment on CaptureOptions.
  assert.equal(options?.cacheBust, false);
  assert.equal(file.name, 'screenshot.png');
});

/**
 * The production regression: without a placeholder, html-to-image assigns
 * '' to a cloned <img>, the browser loads the page HTML as an image, and the
 * whole capture rejects with a DOM Event. Pinning the option is the cheap half;
 * the browser half was verified in Chrome 148 (see CAPTURE_IMAGE_PLACEHOLDER).
 */
test('captureScreenshot hands html-to-image a real placeholder for images it cannot fetch', async () => {
  let options: Record<string, unknown> | undefined;
  await captureScreenshot({} as HTMLElement, {
    toPng: async (_target, opts) => {
      options = opts;
      return PNG_DATA_URL;
    },
  });

  const placeholder = options?.imagePlaceholder;
  assert.equal(placeholder, CAPTURE_IMAGE_PLACEHOLDER);
  assert.match(String(placeholder), /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  // The empty string is the exact value that caused the prod failure.
  assert.notEqual(placeholder, '');
});

test('captureScreenshot gives up rather than hanging on a shot that never finishes', async () => {
  await assert.rejects(
    captureScreenshot({} as HTMLElement, {
      timeoutMs: 20,
      toPng: () => new Promise<string>(() => {}),
    }),
    /did not finish within/,
  );
});

test('withTimeout passes a value through and does not fire once settled', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 1000), 'ok');
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 1000), /boom/);
  // 0 disables the guard entirely.
  assert.equal(await withTimeout(Promise.resolve('ok'), 0), 'ok');
});

test('the capture filter excludes the widget so the shot is of the page, not the button', async () => {
  let options: Record<string, unknown> | undefined;
  await captureScreenshot({} as HTMLElement, {
    toPng: async (_target, opts) => {
      options = opts;
      return PNG_DATA_URL;
    },
  });

  const filter = options?.filter as (node: unknown) => boolean;
  const widgetNode = { closest: (selector: string) => (selector === `[${WIDGET_ROOT_ATTR}]` ? {} : null) };
  const pageNode = { closest: () => null };
  assert.equal(filter(widgetNode), false);
  assert.equal(filter(pageNode), true);
});

test('a failing capture rejects rather than shipping an empty image', async () => {
  await assert.rejects(
    captureScreenshot({} as HTMLElement, {
      toPng: async () => {
        throw new Error('tainted canvas');
      },
    }),
    /tainted canvas/,
  );
});
