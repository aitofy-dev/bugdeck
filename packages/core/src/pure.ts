/**
 * `@aitofy/bugdeck-core/contract` — the half of core a browser may import.
 *
 * The root barrel reaches `sanitize-image`, which reaches `sharp`, which is a
 * native Node module. A bundler following the root entry drags all of it into
 * the browser graph for the sake of a few constants, so the widget imports this
 * instead: the wire contract and the pure functions over it, nothing that has
 * ever heard of a filesystem.
 */
export * from './contract.js';
export * from './blocks.js';
export * from './derive-title.js';
export * from './thread.js';
