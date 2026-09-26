import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icons = {
  plus: (
    <Svg>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  open: (
    <Svg>
      <path d="M4 20V8l6-4 6 4v12" />
      <path d="M4 11h12" />
    </Svg>
  ),
  external: (
    <Svg>
      <path d="M14 5h5v5" />
      <path d="M10 14 19 5" />
      <path d="M19 13v6H5V5h6" />
    </Svg>
  ),
  trash: (
    <Svg>
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M8 7l1 12h6l1-12" />
    </Svg>
  ),
  download: (
    <Svg>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </Svg>
  ),
  markdown: (
    <Svg>
      <path d="M5 6h14v12H5z" />
      <path d="m7 15 3-6 3 6" />
      <path d="M16 9v6l2-2" />
    </Svg>
  ),
  copy: (
    <Svg>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 16V5h11" />
    </Svg>
  ),
  check: (
    <Svg>
      <path d="m5 12 5 5 9-10" />
    </Svg>
  ),
  up: (
    <Svg>
      <path d="m6 14 6-6 6 6" />
    </Svg>
  ),
  down: (
    <Svg>
      <path d="m6 10 6 6 6-6" />
    </Svg>
  ),
  refresh: (
    <Svg>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </Svg>
  ),
};

const iconButtonClass =
  "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

export function IconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} className={className ?? iconButtonClass} {...props}>
      {children}
    </button>
  );
}

export function IconLink({
  href,
  label,
  children,
  target,
  className,
}: {
  href: string;
  label: string;
  children: ReactNode;
  target?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      target={target}
      rel={target === "_blank" ? "noreferrer" : undefined}
      title={label}
      aria-label={label}
      className={className ?? iconButtonClass}
    >
      {children}
    </Link>
  );
}
