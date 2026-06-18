"use client";

import { Logo } from "@repo/ui/components/logo";
import { cn } from "@repo/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";

type NavItem = {
  href: string;
  icon: ReactNode;
  label: string;
};

// Icons reproduce the design's stroke set rather than lucide so the line
// weight and corner radii match the mockup exactly.
const HomeIcon = (
  <svg aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 18 18">
    <rect height="5.4" rx="1.2" width="5.4" x="2.2" y="2.2" />
    <rect height="5.4" rx="1.2" width="5.4" x="10.4" y="2.2" />
    <rect height="5.4" rx="1.2" width="5.4" x="2.2" y="10.4" />
    <rect height="5.4" rx="1.2" width="5.4" x="10.4" y="10.4" />
  </svg>
);

const ApprovalsIcon = (
  <svg aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 18 18">
    <circle cx="9" cy="9" r="6.6" />
    <path d="M5.8 9.1l2.1 2.1 4.3-4.6" />
  </svg>
);

const TicketsIcon = (
  <svg aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 18 18">
    <rect height="10" rx="2.2" width="13.4" x="2.3" y="4" />
    <line x1="2.3" x2="15.7" y1="8" y2="8" />
  </svg>
);

const TeamsIcon = (
  <svg aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 18 18">
    <circle cx="6.6" cy="6.8" r="2.9" />
    <circle cx="12.6" cy="8.2" r="2.2" />
    <path d="M2.6 15c.5-2.4 2-3.6 4-3.6s3.5 1.2 4 3.6" />
  </svg>
);

const ActivityIcon = (
  <svg
    aria-hidden
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.6}
    viewBox="0 0 18 18"
  >
    <path d="M2 9h2.8l2-5 3.4 10 2-5H16" />
  </svg>
);

const CoverageIcon = (
  <svg aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 18 18">
    <circle cx="9" cy="9" r="6.6" />
    <circle cx="9" cy="9" r="3.1" />
    <circle cx="9" cy="9" r="0.4" />
  </svg>
);

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/", icon: HomeIcon, label: "Início" },
  { href: "/approvals", icon: ApprovalsIcon, label: "Aprovações" },
  { href: "/tickets", icon: TicketsIcon, label: "Tickets" },
  { href: "/teams", icon: TeamsIcon, label: "Times" },
  { href: "/activity", icon: ActivityIcon, label: "Atividade" },
  { href: "/cobertura", icon: CoverageIcon, label: "Cobertura" },
];

const isActive = (pathname: string, href: string): boolean => {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

const initialsFrom = (name: string): string => {
  const parts = name.trim().split(/\s+/v).filter(Boolean);
  const first = parts.at(0);
  if (!first) {
    return "?";
  }
  if (parts.length === 1) {
    return first.slice(0, 2).toUpperCase();
  }
  return `${first[0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
};

type SidebarUser = {
  email: string;
  name: string;
  role: string;
};

type SidebarProps = {
  pendingCount?: number;
  user?: SidebarUser;
};

const Sidebar = ({ pendingCount = 0, user }: SidebarProps) => {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Navegação principal"
      className="hidden h-screen w-[238px] shrink-0 flex-col border-r border-border bg-card px-3.5 pt-5 pb-4 md:sticky md:top-0 md:flex"
    >
      <div className="px-1.5">
        <Link className="inline-flex transition-opacity hover:opacity-80" href="/">
          <Logo className="h-6 w-auto" />
        </Link>
      </div>

      <p className="px-2 pt-4 pb-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        Painel operador
      </p>

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const showBadge = item.href === "/approvals" && pendingCount > 0;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-[38px] items-center gap-[11px] rounded-lg px-2.5 text-sm transition-colors",
                "[&_svg]:size-[18px]",
                active
                  ? "bg-highlight-surface font-semibold text-primary"
                  : "font-medium text-muted-foreground hover:bg-highlight-surface/50 hover:text-foreground",
              )}
              href={item.href}
              key={item.href}
            >
              {item.icon}
              {item.label}
              {showBadge ? (
                <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 font-mono text-[11px] font-semibold text-white">
                  {pendingCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-border pt-3.5">
        {user ? (
          <div className="flex items-center gap-2.5 px-1.5">
            <span
              aria-hidden
              className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-foreground text-[13px] font-bold text-background"
            >
              {initialsFrom(user.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-foreground">{user.name}</p>
              <p className="truncate font-mono text-[10px] text-muted-foreground">{user.email}</p>
            </div>
            <span className="rounded-md bg-highlight-surface px-1.5 py-1 font-mono text-[9.5px] font-semibold text-highlight-surface-foreground">
              {user.role}
            </span>
          </div>
        ) : null}
        <SignOutButton className="mt-2 w-full justify-start" />
      </div>
    </aside>
  );
};

export { Sidebar };
