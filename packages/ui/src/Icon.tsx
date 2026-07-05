interface IconProps {
  name: IconName;
  className?: string;
}

export type IconName =
  | 'grid'
  | 'box'
  | 'truck'
  | 'calendar'
  | 'clipboard'
  | 'rotate'
  | 'cart'
  | 'coins'
  | 'camera'
  | 'scan'
  | 'alert'
  | 'check'
  | 'x'
  | 'plus'
  | 'search'
  | 'menu'
  | 'chevron'
  | 'logout'
  | 'trend'
  | 'info'
  | 'bell'
  | 'transfer'
  | 'download'
  | 'history'
  | 'list'
  | 'dots'
  | 'pin'
  | 'tag'
  | 'building'
  | 'arrowRight'
  | 'sun'
  | 'moon'
  | 'lock'
  | 'minus'
  | 'edit'
  | 'signature';

const PATHS: Record<IconName, string> = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  truck: 'M3 6h11v9H3zM14 9h4l3 3v3h-7zM7 18a2 2 0 100-4 2 2 0 000 4zM17 18a2 2 0 100-4 2 2 0 000 4z',
  calendar: 'M7 3v3M17 3v3M4 8h16M5 6h14v14H5z',
  clipboard: 'M9 4h6v3H9zM7 5H5v15h14V5h-2M9 12h6M9 16h6',
  rotate: 'M3 12a9 9 0 1015-6.7M3 4v4h4',
  cart: 'M3 4h2l2.5 12h10l2-8H6M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z',
  coins: 'M8 8a5 3 0 1010 0 5 3 0 10-10 0zM8 8v5a5 3 0 0010 0V8M4 11a5 3 0 0010 0M4 11v5a5 3 0 008.5 2.1',
  camera: 'M4 8h3l2-2h6l2 2h3v11H4zM12 16a3 3 0 100-6 3 3 0 000 6z',
  scan: 'M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M4 12h16',
  alert: 'M12 3l9 16H3zM12 10v4M12 17h.01',
  check: 'M5 13l4 4L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-3.5-3.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  chevron: 'M9 6l6 6-6 6',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h9',
  trend: 'M3 17l6-6 4 4 7-7M14 8h6v6',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 7.5h.01',
  bell: 'M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 004 0',
  transfer: 'M4 8h13l-3-3M20 16H7l3 3',
  download: 'M12 4v11M8 11l4 4 4-4M5 20h14',
  history: 'M12 8v4l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  pin: 'M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  tag: 'M3 12l9-9 9 9-9 9zM12 8h.01',
  building: 'M4 21V5l8-3 8 3v16M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 21v-4h6v4',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 109.8 9.8z',
  lock: 'M6 11V8a6 6 0 1112 0v3M5 11h14v10H5zM12 15v3',
  minus: 'M5 12h14',
  edit: 'M4 20h4l10-10-4-4L4 16v4zM14 6l4 4',
  signature: 'M3 17c3 0 3-6 6-6s3 6 6 6 3-4 6-4M4 20h16',
};

export function Icon({ name, className = 'h-5 w-5' }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
