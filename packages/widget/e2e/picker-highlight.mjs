/**
 * Does "Pick element" actually DRAW a highlight — in a real page, in real pixels?
 *
 * This exists because the picker was "fixed" twice against a bare demo page and
 * shipped broken both times. A page with no fixed sidebar, no sticky header and
 * no z-index anywhere makes an outline with `z-index: auto` look perfect, while
 * it paints underneath half of a real app. Asserting on the DOM (does a box
 * exist, is its rect right) passed on the broken build too — the box existed and
 * its rect was correct to the pixel.
 *
 * So the assertion here is made of PIXELS: hover a point, screenshot the page,
 * read the four mid-edge pixels of the outline back out of that screenshot, and
 * demand they are the ring's blue. Nothing else can tell the difference between
 * "drawn" and "drawn under the sidebar". The demo app therefore has to carry a
 * fixed sidebar and a sticky header, or this test proves nothing.
 *
 * Run (from the repo root):
 *   pnpm --filter bugdeck build          # the demo imports dist/
 *   pnpm --filter @bugdeck/example-vite-react dev
 *   pnpm --filter bugdeck e2e:picker
 *
 * Playwright is not a dependency of this repo — it is imported from wherever it
 * is already installed:
 *
 *   WIDGET_DEMO_URL=http://localhost:5173        # the demo app
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs   # only if bare `playwright` fails
 *   HEADED=1                                     # watch it happen
 */
const DEMO_URL = process.env.WIDGET_DEMO_URL ?? 'http://localhost:5173';

/** The ring colour, straight out of `styles.pickerBox`. */
const RING = [37, 99, 235];
/** JPEG-free PNG screenshots, so an exact-ish match is fair; allow AA slop. */
const TOLERANCE = 24;

/** The attribute every node the widget owns carries — see `capture.ts`. */
const WIDGET_ROOT_ATTR = 'data-bugdeck-widget';

/**
 * Where to hover. Points, not selectors: the contract is "wherever the user
 * points, the ring shows", and the three regions that broke are regions, not
 * components — a fixed sidebar (z-10), a sticky header, and the content.
 */
const PROBES = [
  { label: 'sidebar (fixed, z-10)', x: 100, y: 220 },
  { label: 'header (sticky)', x: 1130, y: 28 },
  { label: 'content card', x: 838, y: 250 },
  { label: 'content, lower half', x: 700, y: 700 },
  { label: 'sidebar footer', x: 120, y: 862 },
];

/** Whichever Playwright the machine already has; the env var is the escape hatch. */
async function loadChromium() {
  const override = process.env.PLAYWRIGHT_MODULE;
  if (override) return (await import(override)).chromium;
  try {
    return (await import('playwright')).chromium;
  } catch {
    throw new Error(
      'Playwright is not installed. Install it, or point PLAYWRIGHT_MODULE at an existing copy.',
    );
  }
}

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Read four mid-edge pixels of `rect` out of a PNG, using the page's own canvas. */
async function ringPixels(page, rect) {
  const b64 = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, rect }) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = 'data:image/png;base64,' + b64;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const at = (x, y) => {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      return {
        top: at(rect.x + rect.width / 2, rect.y + 1),
        bottom: at(rect.x + rect.width / 2, rect.y + rect.height - 1),
        left: at(rect.x + 1, rect.y + rect.height / 2),
        right: at(rect.x + rect.width - 1, rect.y + rect.height / 2),
      };
    },
    { b64, rect },
  );
}

const isRing = (px) => px.every((c, i) => Math.abs(c - RING[i]) <= TOLERANCE);

async function main() {
  const chromium = await loadChromium();
  if (!(await reachable(DEMO_URL))) {
    throw new Error(
      `Nothing answers on ${DEMO_URL}. Start the demo app first, or set WIDGET_DEMO_URL.`,
    );
  }
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  const failures = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
    const launcher = page.locator(`[${WIDGET_ROOT_ATTR}] button, button`).first();
    await launcher.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500); // let the shell settle so rects stop moving
    await launcher.click();
    await page.getByRole('button', { name: 'Pick element' }).first().click();
    await page.waitForTimeout(400);

    for (const probe of PROBES) {
      // Two moves: the first enters the element, the second is the one the
      // picker reacts to. A single jump can land between frames.
      await page.mouse.move(probe.x - 8, probe.y - 8);
      await page.waitForTimeout(80);
      await page.mouse.move(probe.x, probe.y, { steps: 4 });
      await page.waitForTimeout(250);

      // Find the outline WITHOUT naming how it is drawn (border? shadow? svg?):
      // it is the bit of widget chrome whose box matches the hovered element.
      // Anything narrower would go green again the next time the implementation
      // changes, which is exactly how this bug survived two rewrites.
      const box = await page.evaluate(
        ({ x, y, attr }) => {
          const target = document.elementsFromPoint(x, y)[0];
          if (!target) return { rect: null, targetRect: null, target: null };
          const want = target.getBoundingClientRect();
          let best = null;
          for (const root of document.querySelectorAll(`[${attr}]`)) {
            for (const node of root.querySelectorAll('*')) {
              const r = node.getBoundingClientRect();
              const off = Math.max(
                Math.abs(r.x - want.x),
                Math.abs(r.y - want.y),
                Math.abs(r.width - want.width),
                Math.abs(r.height - want.height),
              );
              if (off <= 6 && (!best || off < best.off)) best = { off, rect: r.toJSON() };
            }
          }
          return {
            rect: best?.rect ?? null,
            off: best?.off,
            targetRect: want.toJSON(),
            target: target.tagName,
          };
        },
        { ...probe, attr: WIDGET_ROOT_ATTR },
      );

      if (!box.rect) {
        failures.push(`${probe.label}: nothing of the widget's marks the hovered element`);
        continue;
      }
      if (box.rect.width < 6 || box.rect.height < 6) {
        console.log(`  · ${probe.label}: element too small to sample, skipped`);
        continue;
      }

      const px = await ringPixels(page, box.rect);
      const hidden = Object.entries(px).filter(([, value]) => !isRing(value));
      if (hidden.length) {
        failures.push(
          `${probe.label}: ring invisible on ${hidden.map(([edge]) => edge).join('/')} ` +
            `— read ${hidden.map(([edge, v]) => `${edge}=rgb(${v})`).join(' ')} ` +
            `(rect ${Math.round(box.rect.x)},${Math.round(box.rect.y)} ` +
            `${Math.round(box.rect.width)}x${Math.round(box.rect.height)})`,
        );
      } else {
        console.log(`  ✓ ${probe.label}: ring drawn on all four edges over <${box.target}>`);
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error('\nFAIL — the picker highlight is not visible:');
    for (const line of failures) console.error(`  ✗ ${line}`);
    process.exit(1);
  }
  console.log('\nPASS — highlight visible at every probe point.');
}

await main();
