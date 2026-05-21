"use client";

import { cn } from "@repo/ui/lib/utils";
import { Activity, Image, MessageCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";

type NavItem = {
  href: string;
  icon: ReactNode;
  label: string;
};

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/", icon: <MessageCircle aria-hidden />, label: "Chat" },
  { href: "/assets", icon: <Image aria-hidden />, label: "Assets" },
  { href: "/activity", icon: <Activity aria-hidden />, label: "Atividade" },
];

const isActive = (pathname: string, href: string): boolean => {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

type NavProps = {
  orgName: string | null;
};

// Top-bar layout (no sidebar) — the chat surface owns most of the
// vertical space, so a slim header is friendlier on mobile and laptop.
const Nav = ({ orgName }: NavProps) => {
  const pathname = usePathname();

  return (
    <header
      aria-label="Navegação principal"
      className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4"
    >
      <div className="flex items-center gap-6">
        <Link className="text-base font-semibold tracking-tight" href="/">
          {orgName ?? "Qolmeia"}
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
                      "flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                      "hover:bg-muted hover:text-foreground",
                      active ? "bg-muted text-foreground" : "text-muted-foreground",
                    )}
                    href={item.href}
                  >
                    <span className="[&_svg]:size-4">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <SignOutButton />
    </header>
  );
};

export { Nav };
