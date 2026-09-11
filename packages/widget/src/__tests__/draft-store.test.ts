/**
 * The draft rules, pinned. Two of them decide whether the feature helps or
 * quietly hurts:
 *
 *  - the SLUG, because keying too broadly merges two unrelated bugs into one
 *    report and keying too narrowly scatters one report across three drafts;
 *  - the BUDGET, because a draft that fills localStorage breaks the app it was
 *    supposed to help someone report a bug about.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDraft,
  draftKey,
  draftSlug,
  isExpired,
  loadDraft,
  parseDraft,
  pruneDrafts,
  saveDraft,
  serializeDraft,
  DRAFT_BUDGET_CHARS,
  DRAFT_KEY_PREFIX,
  DRAFT_TTL_MS,
  type FeedbackDraft,
} from '../draft-store.js';

const draft = (over: Partial<FeedbackDraft> = {}): FeedbackDraft => ({
  slug: '/campaigns',
  url: 'https://app/campaigns?page=2',
  text: 'the save button is dead',
  images: [],
  savedAt: Date.now(),
  ...over,
});

const image = (key: string, size = 10) => ({
  key,
  name: `${key}.png`,
  type: 'image/png',
  dataUrl: `data:image/png;base64,${'A'.repeat(size)}`,
});

/** Minimal in-memory localStorage — the store shell is what needs exercising. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    _map: map,
  } as unknown as Storage & { _map: Map<string, string> };
}

function withStorage<T>(fn: (ls: Storage & { _map: Map<string, string> }) => T): T {
  const ls = fakeStorage();
  (globalThis as { localStorage?: Storage }).localStorage = ls;
  try {
    return fn(ls);
  } finally {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
}

// ─── the slug ────────────────────────────────────────────────────

test('query and hash do NOT split a page into several drafts', () => {
  // Same screen, three URLs. Keying on the full URL would scatter one report.
  assert.equal(draftSlug('https://app/campaigns?page=2'), '/campaigns');
  assert.equal(draftSlug('https://app/campaigns#tab=x'), '/campaigns');
  assert.equal(draftSlug('https://app/campaigns'), '/campaigns');
});

test('a different page IS a different draft — two bugs never merge', () => {
  assert.notEqual(draftSlug('https://app/campaigns'), draftSlug('https://app/accounts'));
});

test('a trailing slash is the same page', () => {
  assert.equal(draftSlug('https://app/campaigns/'), draftSlug('https://app/campaigns'));
});

test('the site root has a slug of its own, not an empty string', () => {
  assert.equal(draftSlug('https://app/'), '/');
  assert.equal(draftSlug('https://app'), '/');
});

test('a bare path works too — the caller may not hand over a full URL', () => {
  assert.equal(draftSlug('/campaigns?x=1'), '/campaigns');
});

test('the key is namespaced so pruning can find its own drafts', () => {
  assert.ok(draftKey('/campaigns').startsWith(DRAFT_KEY_PREFIX));
});

// ─── parsing ─────────────────────────────────────────────────────

test('a stored draft round-trips', () => {
  const original = draft({ images: [image('k1')] });
  const parsed = parseDraft(serializeDraft(original).json);
  assert.equal(parsed?.text, 'the save button is dead');
  assert.equal(parsed?.images.length, 1);
});

test('junk in storage loses the draft, never blanks the editor', () => {
  assert.equal(parseDraft('not json'), null);
  assert.equal(parseDraft('null'), null);
  assert.equal(parseDraft('[]'), null);
  assert.equal(parseDraft(null), null);
});

test('an image entry missing fields is dropped, the words are kept', () => {
  const raw = JSON.stringify({
    text: 'text remains',
    images: [{ key: 'k1' }, image('k2'), { key: 'k3', dataUrl: 'javascript:x' }],
    savedAt: Date.now(),
  });
  const parsed = parseDraft(raw);
  assert.equal(parsed?.text, 'text remains');
  assert.deepEqual(parsed?.images.map((i) => i.key), ['k2']);
});

test('an empty draft is not a draft — no banner over an empty editor', () => {
  assert.equal(parseDraft(JSON.stringify({ text: '   ', images: [] })), null);
});

// ─── expiry ──────────────────────────────────────────────────────

test('a week-old draft is expired; a fresh one is not', () => {
  const now = Date.now();
  assert.equal(isExpired(draft({ savedAt: now }), now), false);
  assert.equal(isExpired(draft({ savedAt: now - DRAFT_TTL_MS - 1 }), now), true);
});

test('a draft with no timestamp counts as expired rather than immortal', () => {
  assert.equal(isExpired(draft({ savedAt: 0 })), true);
});

// ─── the budget ──────────────────────────────────────────────────

test('images are shed newest-first until the draft fits', () => {
  const big = DRAFT_BUDGET_CHARS; // one image alone blows the budget
  const out = serializeDraft(draft({ images: [image('k1', big), image('k2', big)] }));
  assert.equal(out.dropped, 2);
  assert.ok(out.json.length <= DRAFT_BUDGET_CHARS);
});

test('the WORDS are never shed — they are the part a button cannot recreate', () => {
  const out = serializeDraft(
    draft({ text: 'the description that matters', images: [image('k1', DRAFT_BUDGET_CHARS)] }),
  );
  assert.equal(parseDraft(out.json)?.text, 'the description that matters');
});

test('a draft that fits sheds nothing', () => {
  const out = serializeDraft(draft({ images: [image('k1')] }));
  assert.equal(out.dropped, 0);
});

// ─── the store ───────────────────────────────────────────────────

test('save then load returns the same draft', () => {
  withStorage(() => {
    saveDraft(draft());
    assert.equal(loadDraft('/campaigns')?.text, 'the save button is dead');
  });
});

test('loading an expired draft removes it and returns nothing', () => {
  withStorage((ls) => {
    saveDraft(draft({ savedAt: Date.now() - DRAFT_TTL_MS - 1 }));
    assert.equal(loadDraft('/campaigns'), null);
    assert.equal(ls._map.size, 0);
  });
});

test('clearing removes only that page', () => {
  withStorage(() => {
    saveDraft(draft({ slug: '/a' }));
    saveDraft(draft({ slug: '/b' }));
    clearDraft('/a');
    assert.equal(loadDraft('/a'), null);
    assert.ok(loadDraft('/b'));
  });
});

test('pruning drops expired drafts and leaves live ones', () => {
  withStorage(() => {
    saveDraft(draft({ slug: '/old', savedAt: Date.now() - DRAFT_TTL_MS - 1 }));
    saveDraft(draft({ slug: '/new' }));
    assert.equal(pruneDrafts(), 1);
    assert.ok(loadDraft('/new'));
  });
});

test('pruning never touches keys that are not ours', () => {
  withStorage((ls) => {
    ls.setItem('aff.range', 'something the app owns');
    saveDraft(draft({ slug: '/old', savedAt: 0 }));
    pruneDrafts();
    assert.equal(ls.getItem('aff.range'), 'something the app owns');
  });
});

test('a storage that throws is survivable — no localStorage at all', () => {
  // Private mode, or a profile with site data blocked.
  assert.equal(loadDraft('/campaigns'), null);
  assert.deepEqual(saveDraft(draft()), { saved: false, dropped: 0 });
  assert.equal(pruneDrafts(), 0);
  clearDraft('/campaigns'); // must not throw
});

test('a quota error falls back to storing the text alone', () => {
  const ls = fakeStorage();
  let refuseImages = true;
  const realSet = ls.setItem.bind(ls);
  ls.setItem = (k: string, v: string) => {
    if (refuseImages && v.includes('data:')) throw new Error('QuotaExceededError');
    realSet(k, v);
  };
  (globalThis as { localStorage?: Storage }).localStorage = ls;
  try {
    const out = saveDraft(draft({ images: [image('k1')] }));
    assert.deepEqual(out, { saved: true, dropped: 1 });
    refuseImages = false;
    assert.equal(loadDraft('/campaigns')?.text, 'the save button is dead');
  } finally {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
