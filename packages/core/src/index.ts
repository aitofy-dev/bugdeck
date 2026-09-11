/**
 * The public surface of `@bugdeck/core`. Nothing is public unless it is here.
 *
 * The root is pure: the contract, block parsing, derived titles, image
 * sanitisation, thread folding, and the `IssueTracker` seam. Adapters live
 * under `adapters/` and are the only things that touch a network.
 */
export * from './contract.js';
export * from './blocks.js';
export * from './derive-title.js';
export * from './sanitize-image.js';
export * from './thread.js';
export * from './tracker.js';
export * from './adapters/plane/index.js';
