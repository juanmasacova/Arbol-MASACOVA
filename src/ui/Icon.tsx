const PATHS = {
  tree: 'M12 21v-8M12 13c-4 0-7-3-7-6.5S8 2 12 2s7 1 7 4.5S16 13 12 13zM9 9l3 2 3-3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.5 2.8-6 6.5-6s6.5 2.5 6.5 6M17 11a3 3 0 1 0 0-6M18.5 14.3c2 .6 3.5 2.4 3.5 5.2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1.5-2-3.4-2.3.8a7 7 0 0 0-1.7-1L14.5 4h-4l-.5 2.9a7 7 0 0 0-1.7 1L6 7.1 4 10.5 6 12a7 7 0 0 0 0 2L4 15.5 6 19l2.3-.8a7 7 0 0 0 1.7 1l.5 2.8h4l.5-2.8a7 7 0 0 0 1.7-1l2.3.8 2-3.5-2-1.5a7 7 0 0 0 0-2z',
  plus: 'M12 5v14M5 12h14',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  me: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.3 6L12 16.5 6.6 19.4l1.3-6L3.4 9.3l6-.7z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  close: 'M6 6l12 12M18 6L6 18',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  cloud: 'M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 8.5 4 4 0 0 1 17.5 18z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  check: 'M5 13l4 4L19 7',
  alert: 'M12 4l9 16H3zM12 10v4M12 17.5v.5',
  tidy: 'M5 5h5v5H5zM14 5h5v5h-5zM9.5 14h5v5h-5z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
