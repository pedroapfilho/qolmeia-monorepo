"use client";

import { Logo } from "@repo/ui/components/logo";
import { cn } from "@repo/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "@/components/sign-out-button";

type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/", label: "Chat" },
  { href: "/empresa", label: "Empresa" },
  { href: "/assets", label: "Assets" },
  { href: "/activity", label: "Atividade" },
];

const isActive = (pathname: string, href: string): boolean => {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

const getInitials = (name: string): string =>
  name
    .split(/\s+/v)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.at(0)?.toUpperCase() ?? "")
    .join("") || "Q";

type NavProps = {
  orgName: string | null;
};

// Top-bar layout (no sidebar) — the chat surface owns most of the
// vertical space, so a slim header is friendlier on mobile and laptop.
const Nav = ({ orgName }: NavProps) => {
  const pathname = usePathname();
  const org = orgName ?? "Qolmeia";

  return (
    <header
      aria-label="Navegação principal"
      className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-5"
    >
      <div className="flex min-w-0 items-center gap-5 sm:gap-7">
        <Link
          className="inline-flex shrink-0 items-center transition-opacity hover:opacity-80"
          href="/"
        >
          <Logo className="h-6 w-auto" />
        </Link>
        <nav>
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center rounded-lg px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-highlight-surface font-semibold text-primary"
                        : "font-medium text-muted-foreground hover:text-foreground",
                    )}
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="hidden truncate text-sm font-semibold text-foreground sm:inline">
            {org}
          </span>
          <span
            aria-hidden
            className="flex size-[30px] shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
            style={{ background: "var(--color-avatar-7)" }}
          >
            {getInitials(org)}
          </span>
        </div>
        <SignOutButton />
      </div>
    </header>
  );
};

export { Nav };
