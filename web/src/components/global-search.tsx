"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SearchResults } from "@/lib/dashboard/global-search";
import { fold } from "@/lib/dashboard/inventory-view";
import { NAV_GROUPS } from "@/lib/navigation";
import { classKey, formatInteger } from "@/lib/wow/format";
import { ItemThumb } from "./item-slots";
import { ClassAvatar } from "./ui";

// Recherche globale : Ctrl+K (⌘K sur Mac) ou la loupe de l'en-tête ouvrent une fenêtre qui cherche
// pages, personnages et objets. Les pages sont filtrées ici ; personnages et objets viennent de
// /api/search, une requête par pause de frappe.

const DEBOUNCE_MS = 180;

type Option = { id: string; href: string; group: "Pages" | "Personnages" | "Objets"; content: React.ReactNode; label: string };

const PAGES = NAV_GROUPS.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));

/** Assez long pour interroger le serveur : deux lettres, ou un identifiant d'objet. */
const searchable = (needle: string) => needle.length >= 2 || /^\d+$/.test(needle);

export function GlobalSearch({ basePath }: { basePath: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ needle: string; data: SearchResults } | null>(null);
  // L'échec vaut pour le texte qui l'a provoqué : une nouvelle frappe l'efface.
  const [error, setError] = useState<{ needle: string; message: string } | null>(null);
  const [active, setActive] = useState(0);

  const show = useCallback(() => {
    setOpen(true);
    dialog.current?.showModal();
    input.current?.select();
  }, []);
  const hide = useCallback(() => dialog.current?.close(), []);

  // Ctrl+K partout, même pendant une saisie : c'est l'usage de la plupart des sites.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (dialog.current?.open) hide();
      else show();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, hide]);

  const needle = fold(query.trim());
  const failed = error?.needle === needle ? error.message : null;
  useEffect(() => {
    if (!open || !searchable(needle)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${basePath}/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) return setError({ needle, message: "Session expirée : rechargez la page pour vous reconnecter." });
        if (!response.ok) return setError({ needle, message: "La recherche a échoué. Réessayez dans un instant." });
        setResults({ needle, data: (await response.json()) as SearchResults });
        setError(null);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError({ needle, message: "Serveur injoignable." });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, needle, query, basePath]);

  const options = useMemo<Option[]>(() => {
    const pages = PAGES.filter((page) => needle === "" || fold(page.label).includes(needle) || fold(page.group).includes(needle)).map<Option>((page) => ({
      id: `page-${page.href}`,
      href: page.href,
      group: "Pages",
      label: page.label,
      content: (
        <>
          <span className="font-medium text-text">{page.label}</span>
          <span className="ml-auto text-xs text-faint">{page.group}</span>
        </>
      ),
    }));
    // Résultats d'une frappe précédente : gardés tant que la nouvelle réponse n'est pas là, s'ils la
    // préfigurent, et réduits à ceux qui correspondent encore au texte. Un échec les retire.
    const stale = results !== null && results.needle !== needle;
    const data = results && searchable(needle) && needle.startsWith(results.needle) && !(stale && failed) ? results.data : null;
    const numeric = /^\d+$/.test(needle);
    const still = (name: string, itemKey?: string) =>
      !stale || (numeric && itemKey !== undefined ? itemKey === needle || itemKey.startsWith(`${needle}:`) : fold(name).includes(needle));
    const characters = (data?.characters ?? []).filter((character) => still(character.name)).map<Option>((character) => ({
      id: `character-${character.id}`,
      href: `/characters/${character.id}`,
      group: "Personnages",
      label: character.name,
      content: (
        <>
          <ClassAvatar name={character.name} classToken={character.class} size="sm" />
          <span className="min-w-0" data-class={classKey(character.class)}>
            <span className="class-text block truncate font-semibold">{character.name}</span>
            <span className="block truncate text-xs text-muted">
              {character.level === null ? "" : `Niveau ${character.level} · `}
              {character.realm}
            </span>
          </span>
        </>
      ),
    }));
    const items = (data?.items ?? []).filter((item) => still(item.name, item.itemKey)).map<Option>((item) => ({
      id: `item-${item.itemKey}`,
      href: item.href,
      group: "Objets",
      label: item.name,
      content: (
        <>
          <ItemThumb icon={item.icon} quality={item.quality} />
          <span className="min-w-0 truncate font-medium" data-quality={item.quality ?? undefined}>
            <span className={item.quality === null ? "" : "quality-text"}>{item.name}</span>
          </span>
          <span className="ml-auto whitespace-nowrap text-xs text-faint">{item.owned > 0 ? `× ${formatInteger(item.owned)} · Inventaires` : "Marché"}</span>
        </>
      ),
    }));
    return [...characters, ...items, ...pages.slice(0, needle === "" ? PAGES.length : 6)];
  }, [needle, results, failed]);

  const current = options[Math.min(active, options.length - 1)];
  const go = (option: Option | undefined) => {
    if (!option) return;
    hide();
    router.push(option.href);
  };
  const waiting = searchable(needle) && results?.needle !== needle && failed === null;

  return (
    <>
      <button type="button" className="button flex-none" aria-label="Rechercher (Ctrl+K)" aria-keyshortcuts="Control+K Meta+K" title="Rechercher (Ctrl+K)" onClick={show}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.6-3.6" />
        </svg>
        <span className="hidden xl:inline">Rechercher</span>
        <kbd className="search-kbd hidden xl:inline-grid">Ctrl K</kbd>
      </button>

      <dialog
        ref={dialog}
        className="search-dialog"
        aria-label="Recherche"
        onClose={() => {
          setOpen(false);
          setQuery("");
          setActive(0);
          setError(null);
        }}
        // Un clic sur le fond (hors du cadre) referme la fenêtre.
        onClick={(event) => {
          if (event.target === event.currentTarget) hide();
        }}
      >
        <div className="search-dialog-frame">
          <div className="search-dialog-input">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.6-3.6" />
            </svg>
            <input
              ref={input}
              type="text"
              role="combobox"
              aria-expanded={open && options.length > 0}
              aria-controls={listId}
              aria-activedescendant={current ? `${listId}-${current.id}` : undefined}
              aria-autocomplete="list"
              aria-label="Chercher une page, un personnage ou un objet"
              placeholder="Page, personnage ou objet…"
              maxLength={60}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setActive((index) => (options.length === 0 ? 0 : (Math.min(index, options.length - 1) + step + options.length) % options.length));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  go(current);
                }
              }}
            />
            <kbd className="search-kbd">Échap</kbd>
          </div>

          <ul id={listId} role="listbox" aria-label="Résultats" className="search-dialog-results">
            {options.map((option, index) => (
              <li key={option.id} role="presentation">
                {(index === 0 || options[index - 1].group !== option.group) && <p className="search-dialog-group">{option.group}</p>}
                <Link
                  id={`${listId}-${option.id}`}
                  role="option"
                  aria-selected={option === current}
                  href={option.href}
                  prefetch={false}
                  tabIndex={-1}
                  className="search-dialog-option"
                  onPointerMove={() => setActive(index)}
                  onClick={() => hide()}
                  ref={(node) => {
                    if (node && option === current) node.scrollIntoView({ block: "nearest" });
                  }}
                >
                  {option.content}
                </Link>
              </li>
            ))}
          </ul>
          <p className="search-dialog-status" role="status">
            {failed ??
              (waiting
                ? "Recherche…"
                : searchable(needle) && options.length === 0
                  ? "Aucun résultat."
                  : needle !== "" && !searchable(needle)
                    ? "Encore une lettre pour chercher personnages et objets."
                    : "↑ ↓ pour choisir, Entrée pour ouvrir.")}
          </p>
        </div>
      </dialog>
    </>
  );
}
