/**
 * The public surface of `@bugdeck/core`. Nothing is public unless it is here.
 *
 * The root carries everything: the contract, block parsing, derived titles,
 * thread folding, issue rendering, image sanitisation and the `IssueTracker`
 * seam. Adapters live under `adapters/` and are the only things that touch a
 * network.
 *
 * A browser wants `@bugdeck/core/contract` instead (`pure.ts`): image
 * sanitisation reaches `sharp`, which no bundle should ever follow.
 */
export * from './contract.js';
export * from './blocks.js';
export * from './derive-title.js';
export * from './issue-body.js';
export * from './sanitize-image.js';
export * from './thread.js';
export * from './tracker.js';
export * from './adapters/plane/index.js';
