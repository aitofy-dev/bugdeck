import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseContext, readSubmission } from '../submission.js';
import { defaultLimits } from '../limits.js';

describe('parseContext', () => {
  it('clamps every field, because all of it lands on a board someone reads', () => {
    const context = parseContext(
      JSON.stringify({
        url: 'u'.repeat(3000),
        viewport: { width: '1280.4', height: -5 },
        userAgent: 'a'.repeat(900),
        buildCommit: 'c'.repeat(200),
      }),
    );

    assert.equal(context.url.length, 2000);
    assert.equal(context.viewport.width, 1280);
    assert.equal(context.viewport.height, 0);
    assert.equal(context.userAgent.length, 500);
    assert.equal(context.buildCommit?.length, 60);
  });

  it('survives a malformed context rather than losing the report', () => {
    const context = parseContext('{not json');

    assert.deepEqual(context, { url: '', viewport: { width: 0, height: 0 }, userAgent: '' });
  });

  it('keeps the last api error the host app saw', () => {
    const context = parseContext(
      JSON.stringify({ lastApiError: { status: '500', path: '/api/export', message: 'boom' } }),
    );

    assert.deepEqual(context.lastApiError, { status: 500, path: '/api/export', message: 'boom' });
  });
});

describe('readSubmission', () => {
  it('ignores a file part that is not under the images key', async () => {
    const result = await readSubmission(
      {
        description: 'something broke',
        avatar: new File(['not an image'], 'avatar.png'),
      },
      defaultLimits,
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.images.length, 0);
  });

  it('takes the description from a repeated field rather than refusing', async () => {
    const result = await readSubmission(
      { description: ['first', 'second'] },
      defaultLimits,
    );

    assert.equal(result.ok && result.value.description, 'first');
  });
});
