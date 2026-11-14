import Form from "next/form";
import Link from "next/link";
import type { AccountOption } from "@/lib/dashboard/roster-filter";

// Barre de filtres envoyée en GET : l'adresse garde les filtres, et la page se partage telle
// quelle. Form de Next : l'adresse suit le préfixe du site, et l'envoi reste une navigation interne.

export function FilterForm({ action, active, label = "Filtres", children }: { action: string; active: boolean; label?: string; children: React.ReactNode }) {
  return (
    <Form action={action} prefetch={false} scroll={false} aria-label={label} className="mt-6 flex flex-wrap items-end gap-3">
      {children}
      <button className="button" type="submit">
        Filtrer
      </button>
      {active && (
        <Link href={action} prefetch={false} scroll={false} className="pb-2 text-sm text-muted hover:text-gold hover:underline">
          Tout afficher
        </Link>
      )}
    </Form>
  );
}

export function SelectFilter({
  name,
  label,
  value,
  all,
  options,
}: {
  name: string;
  label: string;
  value: string;
  all: string;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <select className="field mt-1.5 block" name={name} defaultValue={value}>
        <option value="">{all}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AccountFilter({ accounts, value }: { accounts: readonly AccountOption[]; value: number | null }) {
  if (accounts.length < 2) return null;
  return (
    <SelectFilter
      name="account"
      label="Compte"
      value={value === null ? "" : String(value)}
      all="Tous les comptes"
      options={accounts.map((account) => ({ value: String(account.id), label: account.label }))}
    />
  );
}

export function TextFilterInput({ name, label, value, placeholder }: { name: string; label: string; value: string; placeholder: string }) {
  return (
    <label className="block min-w-[12rem] flex-1 sm:max-w-xs">
      <span className="eyebrow">{label}</span>
      <input className="field mt-1.5 block" type="search" name={name} defaultValue={value} placeholder={placeholder} maxLength={40} autoComplete="off" />
    </label>
  );
}
