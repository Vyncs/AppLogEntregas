/** Ícones de traço do app (24×24, cor do texto). Decorativos: o nome da ação vai no botão. */

const svg = {
  'aria-hidden': true,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.25,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

interface IconProps {
  className?: string;
}

export function CheckIcon({ className = 'size-6' }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function AlertIcon({ className = 'size-6' }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M12 3.5 2.5 20h19L12 3.5zM12 10v4.5M12 17.5v.01" />
    </svg>
  );
}

export function PencilIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
    </svg>
  );
}

export function XIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function UndoIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

export function PinIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

export function CameraIcon({ className = 'size-6' }: IconProps) {
  return (
    <svg {...svg} strokeWidth={2} className={className}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export function PlusIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...svg} strokeWidth={2.5} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function RefreshIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...svg} strokeWidth={2} className={className}>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />
    </svg>
  );
}

export function MapIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...svg} strokeWidth={2} className={className}>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
    </svg>
  );
}

export function FolderIcon({ className = 'size-8' }: IconProps) {
  return (
    <svg {...svg} strokeWidth={2} className={className}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
    </svg>
  );
}

export function ChevronLeftIcon({ className = 'size-6' }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function ChevronRightIcon({ className = 'size-6' }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

/** "Pular para depois": seta para a frente até uma barra */
export function SkipIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M5 6l8 6-8 6V6zM18 6v12" />
    </svg>
  );
}
