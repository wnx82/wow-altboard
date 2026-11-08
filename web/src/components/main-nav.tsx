"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { activeNav, isActiveLink, NAV_GROUPS, type NavGroup } from "@/lib/navigation";

/** Sur téléphone, un seul bouton ouvre tous les groupes. */
const ALL = "all";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function GroupLinks({ group, pathname, onNavigate }: { group: NavGroup; pathname: string; onNavigate: () => void }) {
  return group.items.map((item) => {
    const active = isActiveLink(item.href, pathname);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          onClick={onNavigate}
          className={`block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            active ? "bg-gold/15 text-gold" : "text-muted hover:bg-white/5 hover:text-text"
          }`}
        >
          {item.label}
        </Link>
      </li>
    );
  });
}

/**
 * Navigation principale en trois groupes déroulants. Une liste se ferme au choix d'une page, à un
 * clic ailleurs, avec Échap ou quand le focus quitte la navigation.
 */
export function MainNav() {
  const pathname = usePathname();
  // La liste ouverte est liée à la page où elle a été ouverte : changer de page la referme.
  const [opened, setOpened] = useState<{ id: string; pathname: string } | null>(null);
  const open = opened?.pathname === pathname ? opened.id : null;
  const root = useRef<HTMLElement>(null);
  const current = activeNav(pathname);

  const toggle = (id: string) => setOpened(open === id ? null : { id, pathname });
  const close = () => setOpened(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpened(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpened(null);
      root.current?.querySelector<HTMLButtonElement>(`[aria-controls="nav-${open}"]`)?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const button = (active: boolean) =>
    `flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "bg-gold/15 text-gold" : "text-muted hover:bg-white/5 hover:text-text"
    }`;

  return (
    <nav
      ref={root}
      aria-label="Navigation principale"
      className="flex min-w-0 flex-1 items-center"
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpened(null);
      }}
    >
      {/* Téléphone : un bouton, nommé d'après la page en cours. La liste prend toute la largeur de l'en-tête. */}
      <div className="md:hidden">
        <button type="button" className={button(false)} aria-expanded={open === ALL} aria-controls={`nav-${ALL}`} onClick={() => toggle(ALL)}>
          {current?.item.label ?? "Menu"}
          <Chevron open={open === ALL} />
        </button>
        {open === ALL && (
          <div id={`nav-${ALL}`} className="nav-panel absolute inset-x-0 top-full grid gap-4 px-4 py-4 sm:grid-cols-3 sm:px-6">
            {NAV_GROUPS.map((group) => (
              <section key={group.id} aria-label={group.label}>
                <p className="eyebrow px-3 pb-1">{group.label}</p>
                <ul className="grid grid-cols-2 gap-1 sm:grid-cols-1">
                  <GroupLinks group={group} pathname={pathname} onNavigate={close} />
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Écran large : un bouton par groupe, celui de la page en cours en or. */}
      <ul className="hidden items-center gap-1 md:flex">
        {NAV_GROUPS.map((group) => (
          <li key={group.id} className="relative">
            <button
              type="button"
              className={button(current?.group.id === group.id)}
              aria-expanded={open === group.id}
              aria-controls={`nav-${group.id}`}
              onClick={() => toggle(group.id)}
            >
              {group.label}
              {current?.group.id === group.id && current.item.label !== group.label && (
                <span className="hidden text-text/80 lg:inline">· {current.item.label}</span>
              )}
              <Chevron open={open === group.id} />
            </button>
            {open === group.id && (
              <ul id={`nav-${group.id}`} className="nav-panel absolute left-0 top-full mt-2 min-w-48 rounded-xl p-1.5">
                <GroupLinks group={group} pathname={pathname} onNavigate={close} />
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
