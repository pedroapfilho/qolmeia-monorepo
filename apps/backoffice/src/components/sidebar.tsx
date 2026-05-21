"use client";

import { cn } from "@repo/ui/lib/utils";
import { Activity, BookOpen, Home, Inbox, Play, Users } from "lucide-react";
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
  { href: "/activity", icon: <Activity aria-hidden />, label: "Atividade" },
  { href: "/agents", icon: <Users aria-hidden />, label: "Agentes" },
  { href: "/soul", icon: <BookOpen aria-hidden />, label: "Soul" },
  { href: "/runs", icon: <Play aria-hidden />, label: "Execuções" },
];

// Treat the home link as exact; every other link uses prefix-match so detail
// pages (/agents/123) keep their parent nav highlighted.
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
      <div className="flex h-14 items-center border-b border-border px-5">
        <Link className="text-base font-semibold tracking-tight" href="/">
          Qolmeia
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-0.5">
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

      <div className="border-t border-border p-3">
        <SignOutButton className="w-full justify-start" />
      </div>
    </aside>
  );
};

export { Sidebar };
