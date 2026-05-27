"use client";

import { cn } from "@repo/ui/lib/utils";
import { Activity, Home, Inbox, Ticket } from "lucide-react";
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
  { href: "/", icon: <Home aria-hidden />, label: "Início" },
  { href: "/approvals", icon: <Inbox aria-hidden />, label: "Aprovações" },
  { href: "/tickets", icon: <Ticket aria-hidden />, label: "Tickets" },
  { href: "/activity", icon: <Activity aria-hidden />, label: "Atividade" },
];

const isActive = (pathname: string, href: string): boolean => {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

const Sidebar = () => {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Navegação principal"
      className="hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card md:sticky md:top-0 md:flex"
    >
      <div className="flex h-14 items-center border-b border-border px-4">
        <Link
          className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground transition-opacity hover:opacity-80"
          href="/"
        >
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-md bg-foreground text-[10px] font-bold text-background"
          >
            Q
          </span>
          Qolmeia
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group/nav flex h-9 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  href={item.href}
                >
                  <span
                    className={cn(
                      "[&_svg]:size-4",
                      active ? "text-foreground" : "text-muted-foreground/70",
                    )}
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border p-3">
        <SignOutButton className="w-full justify-start" />
      </div>
    </aside>
  );
};

export { Sidebar };
