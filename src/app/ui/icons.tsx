// Small line icons, drawn for this UI at 20px on a 20-unit grid.

interface IconProps {
  name: IconName;
}

export type IconName =
  | 'draw' | 'move' | 'undo' | 'redo' | 'camera' | 'help' | 'menu'
  | 'rotateL' | 'rotateR' | 'duplicate' | 'trash' | 'close' | 'feed' | 'rain' | 'breeze';

const paths: Record<IconName, string> = {
  draw: 'M4 15.5c2.5-.2 3.6-2.8 5.6-6.2C11.2 6.6 13 4.6 15.6 4.5M13.4 4.4l2.4.1-.2 2.3',
  move: 'M10 3v14M3 10h14M10 3l-2 2M10 3l2 2M10 17l-2-2M10 17l2-2M3 10l2-2M3 10l2 2M17 10l-2-2M17 10l-2 2',
  undo: 'M7.5 6.5 4 10l3.5 3.5M4.5 10H12a4 4 0 0 1 0 8h-1',
  redo: 'M12.5 6.5 16 10l-3.5 3.5M15.5 10H8a4 4 0 0 0 0 8h1',
  camera: 'M3.5 7.5h3l1.3-2h4.4l1.3 2h3v8h-13zM10 13.6a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6',
  help: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15M7.9 7.8a2.2 2.2 0 1 1 3 2c-.6.3-.9.8-.9 1.4v.5M10 14.2v.1',
  menu: 'M4.5 10h.1M10 10h.1M15.5 10h.1',
  rotateL: 'M5 8.5A6 6 0 1 1 4.6 12M5 4.5v4h4',
  rotateR: 'M15 8.5a6 6 0 1 0 .4 3.5M15 4.5v4h-4',
  duplicate: 'M7 7h9v9H7zM4 13V4h9',
  trash: 'M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6',
  close: 'M5 5l10 10M15 5 5 15',
  feed: 'M6 6.5h.1M10 5h.1M14 7h.1M8 10h.1M12.5 11h.1M4.5 15.5c3.5 1.6 7.5 1.6 11 0',
  rain: 'M5.5 11.5a3.5 3.5 0 0 1 .4-7 4.5 4.5 0 0 1 8.4 1.2 3 3 0 0 1-.3 5.8M7 14l-1 2.5M10.5 14l-1 2.5M14 14l-1 2.5',
  breeze: 'M3.5 8h9a2.3 2.3 0 1 0-2.3-2.3M3.5 12h11.5a2.3 2.3 0 1 1-2.3 2.3M3.5 10h6',
};

export function Icon({ name }: IconProps) {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d={paths[name]} fill="none" stroke="currentColor" strokeWidth={name === 'menu' ? 2.6 : 1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
