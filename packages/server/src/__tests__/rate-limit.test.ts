import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createRateLimiter } from '../rate-limit.js';

describe('createRateLimiter', () => {
  it('allows the budget and refuses the next one', () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => 0 });

    assert.equal(limiter.take('user-1'), true);
    assert.equal(limiter.take('user-1'), true);
    assert.equal(limiter.take('user-1'), false);
  });

  it('keeps one key out of another key budget', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => 0 });

    assert.equal(limiter.take('user-1'), true);
    assert.equal(limiter.take('user-2'), true);
  });

  it('slides: the oldest hit falls out of the window rather than resetting it', () => {
    let clock = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => clock });

    limiter.take('user-1');
    clock = 600;
    limiter.take('user-1');
    clock = 900;
    assert.equal(limiter.take('user-1'), false, 'both hits are still inside the window');

    clock = 1100;
    assert.equal(limiter.take('user-1'), true, 'the first hit has aged out');
    assert.equal(limiter.take('user-1'), false, 'the second one has not');
  });
});
