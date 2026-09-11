/**
 * Every icon the widget draws, as path data on a 24-unit grid.
 *
 * Inline SVG rather than an icon package: the widget ships into apps it knows
 * nothing about, and a font or a dependency for eleven outlines would be the
 * largest thing in the bundle.
 */
const PATHS = {
  bug: [
    'm8 2 1.9 1.9',
    'M14.1 3.9 16 2',
    'M9 7.1v-1a3 3 0 1 1 6 0v1',
    'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6',
    'M12 20v-9',
    'M6.5 9C4.6 8.8 3 7.1 3 5',
    'M6 13H2',
    'M3 21c0-2.1 1.7-3.9 3.8-4',
    'M21 5c0 2.1-1.6 3.8-3.5 4',
    'M22 13h-4',
    'M17.2 17c2.1.1 3.8 1.9 3.8 4',
  ],
  screen: [
    'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
    'M8 21h8',
    'M12 17v4',
  ],
  target: [
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
    'M22 12h-4',
    'M6 12H2',
    'M12 6V2',
    'M12 22v-4',
  ],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 8 5-5 5 5', 'M12 3v12'],
  image: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
    'M9 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    'm21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21',
  ],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  pen: ['M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'],
  square: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z'],
  arrow: ['M7 17 17 7', 'M7 7h10v10'],
  crop: ['M6 2v14a2 2 0 0 0 2 2h14', 'M18 22V8a2 2 0 0 0-2-2H2'],
  undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'],
  trash: [
    'M3 6h18',
    'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
    'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  ],
  check: ['M20 6 9 17l-5-5'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
