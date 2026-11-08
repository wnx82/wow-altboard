"use client";

import { useState } from "react";

/** « 123456789#1 » : identifiant Battle.net et numéro de licence WoW, séparés au dernier « # ». */
export function splitReference(name: string): { id: string; tag: string | null } {
  const at = name.lastIndexOf("#");
  return at > 0 ? { id: name.slice(0, at), tag: name.slice(at) } : { id: name, tag: null };
}

/**
 * Badge de la référence complète d'un compte (nom du dossier WTF\Account), avec copie. Tant qu'aucun
 * agent 0.6.0 n'a envoyé le compte, seul le libellé masqué est connu : le badge le dit.
 */
export function AccountReference({ folderName, folderHint }: { folderName: string | null; folderHint: string | null }) {
  const [copied, setCopied] = useState(false);

  if (folderName === null) {
    return (
      <span className="account-ref" data-masked title="Référence complète au prochain envoi d'un agent 0.6.0 ou plus récent">
        <KeyIcon />
        <span className="account-ref-id">{folderHint ?? "inconnu"}</span>
        <span className="account-ref-note">masquée</span>
      </span>
    );
  }

  const { id, tag } = splitReference(folderName);
  return (
    <span className="account-ref">
      <KeyIcon />
      <span className="account-ref-id">
        {id}
        {tag && <span className="account-ref-tag">{tag}</span>}
      </span>
      <button
        type="button"
        className="account-ref-copy"
        aria-label={copied ? "Référence copiée" : `Copier la référence ${folderName}`}
        title={copied ? "Copiée" : "Copier"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(folderName);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            // Presse-papiers refusé (page non sécurisée, permission) : la référence reste lisible.
          }
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </span>
  );
}

const iconProps = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

function KeyIcon() {
  return (
    <svg {...iconProps} className="account-ref-icon">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 21 2M16 7l3 3M18.5 4.5 21 7" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg {...iconProps}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
