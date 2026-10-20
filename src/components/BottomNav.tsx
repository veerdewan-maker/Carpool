"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Rides", icon: CarIcon },
  { href: "/kids", label: "Kids", icon: KidsIcon },
  { href: "/connections", label: "Friends", icon: FriendsIcon },
  { href: "/places", label: "Places", icon: PinIcon },
  { href: "/profile", label: "Me", icon: UserIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white" aria-label="Main">
      <ul className="mx-auto flex w-full max-w-md">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" || pathname.startsWith("/rides") : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  active ? "text-brand-700" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <Icon />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const svgProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function CarIcon() {
  return (
    <svg {...svgProps}>
      <path d="M5 17h14M6 17l1.5-5h9L18 17M6 17v2M18 17v2M8 12l1-3h6l1 3" />
      <circle cx="8" cy="17" r="1" />
      <circle cx="16" cy="17" r="1" />
    </svg>
  );
}
function KidsIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c0-3 2.5-5 6-5s6 2 6 5M14 20c0-2 1.5-3.5 3.5-3.5S21 18 21 20" />
    </svg>
  );
}
function FriendsIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6M19 8h3M20.5 6.5v3" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 21s-6-5.5-6-11a6 6 0 1112 0c0 5.5-6 11-6 11z" />
      <circle cx="12" cy="10" r="2" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}
