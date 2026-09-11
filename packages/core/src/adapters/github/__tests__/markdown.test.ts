/**
 * The body is Markdown and the marker is the idempotency key, so both are
 * pinned: a description that could write a heading, a link or an HTML comment
 * would be able to forge the header lines triage reads and the marker a retry
 * dedupes on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commentMarkdown,
  escapeMarkdown,
  githubBody,
  hasAnyMarker,
  hasMarker,
  markerFor,
  withMarker,
} from '../markdown.js';
import { bodyInput } from './fake-github.js';

test('a report renders as who, what, where, marker', () => {
  const body = githubBody(
    bodyInput({ teamName: 'Acme', buildCommit: 'a1b2c3', assetIds: ['asset-1'] }),
    'https://app.example',
  );

  assert.equal(
    body,
    [
      'user: ada@example.com · team: Acme',
      'The Send button does nothing',
      '![](https://app.example/assets/asset-1)',
      'url: https://app.example/checkout · viewport: 1440×900 @2x · commit: a1b2c3 · UA: Mozilla/5.0',
      '<!-- bugdeck:report:report-1 -->',
    ].join('\n\n'),
  );
});

test('blocks keep the order the user wrote them in', () => {
  const body = githubBody(
    bodyInput({
      assetIds: ['asset-1'],
      blocks: [
        { kind: 'text', text: 'before' },
        { kind: 'image', assetId: 'asset-1' },
        { kind: 'text', text: 'after' },
      ],
    }),
    'https://app.example/',
  );
  const lines = body.split('\n\n');
  assert.deepEqual(lines.slice(1, 4), [
    'before',
    '![](https://app.example/assets/asset-1)',
    'after',
  ]);
});

test('with no public url a screenshot is not mentioned rather than linked nowhere', () => {
  const body = githubBody(bodyInput({ assetIds: ['asset-1'] }));
  assert.ok(!body.includes('!['));
  assert.ok(body.includes('The Send button does nothing'));
});

test('a description cannot inject a heading, a link or our marker', () => {
  const body = githubBody(
    bodyInput({
      description: '# fake heading\n[click](https://evil.example)\n<!-- bugdeck:report:other -->',
    }),
  );
  assert.ok(body.includes('\\# fake heading'));
  assert.ok(body.includes('\\[click\\](https://evil.example)'));
  // The typed marker is escaped into text, so it names no report at all.
  assert.ok(body.includes('\\<!-- bugdeck:report:other'));
  assert.ok(!hasMarker(body, 'other'));
  assert.ok(body.trimEnd().endsWith(markerFor('report-1')));
});

test('escaping leaves ordinary words alone', () => {
  assert.equal(escapeMarkdown('the Send button does nothing'), 'the Send button does nothing');
  assert.equal(escapeMarkdown('1. first'), '1\\. first');
  assert.equal(escapeMarkdown('- item'), '\\- item');
});

test('the marker matches the whole comment, not a prefix of another id', () => {
  const body = githubBody(bodyInput({ reportId: 'report-12' }));
  assert.ok(hasMarker(body, 'report-12'));
  assert.ok(!hasMarker(body, 'report-1'));
  assert.ok(hasAnyMarker(body));
  assert.ok(!hasAnyMarker('an issue a human filed'));
});

test('a report id cannot close the marker comment early', () => {
  const marker = markerFor('a --> <script> x');
  assert.equal(marker.split('-->').length - 1, 1);
  assert.equal(marker.split('<').length - 1, 1);
});

test('withMarker adds one marker and never a second', () => {
  const once = withMarker('plain body', 'report-1');
  assert.equal(withMarker(once, 'report-1'), once);
});

test('a comment rendered as HTML for another tracker arrives as text', () => {
  assert.equal(
    commentMarkdown('<p><em>Reporter said:</em></p><p>still broken</p>'),
    'Reporter said:\n\nstill broken',
  );
  // Markdown written for GitHub is passed through untouched.
  assert.equal(commentMarkdown('@user fixed in 1.2.0'), '@user fixed in 1.2.0');
});
