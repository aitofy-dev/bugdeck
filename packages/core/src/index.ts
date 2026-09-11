/**
 * The public surface of `@bugdeck/core`. Nothing is public unless it is here.
 *
 * Everything in this package is pure: no filesystem, no network, no clock, no
 * environment. Storage and trackers live in the packages that adapt it.
 */
export * from './contract.js';
export * from './blocks.js';
export * from './derive-title.js';
export * from './sanitize-image.js';
export * from './thread.js';
export * from './plane-state.js';
export * from './plane-html.js';
