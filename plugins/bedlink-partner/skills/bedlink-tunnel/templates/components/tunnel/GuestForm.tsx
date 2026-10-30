"use client";

import type { ReactNode } from "react";
import type { GuestDetails } from "./types";

// Guest details (Villa Yenna, Alexian): two columns when wide, label above the
// field, 16 px text so iOS does not zoom, browser autofill names.

export const EMPTY_GUEST: GuestDetails = { firstName: "", lastName: "", email: "", phone: "", message: "" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** null = valid, otherwise the field in error and the message. */
export function validateGuest(g: GuestDetails): { field: keyof GuestDetails; message: string } | null {
  if (!g.firstName.trim()) return { field: "firstName", message: "Indiquez votre prénom." };
  if (!g.lastName.trim()) return { field: "lastName", message: "Indiquez votre nom." };
  if (!EMAIL_RE.test(g.email.trim())) return { field: "email", message: "Cette adresse e-mail ne semble pas valide." };
  if (g.phone.replace(/\D/g, "").length < 9) return { field: "phone", message: "Indiquez un numéro de téléphone joignable." };
  if (g.message.length > 1500) return { field: "message", message: "Message trop long (1 500 caractères au plus)." };
  return null;
}

export function GuestForm(props: {
  value: GuestDetails;
  onChange: (value: GuestDetails) => void;
  hostFirstName?: string;
  error?: { field: keyof GuestDetails; message: string } | null;
}) {
  const v = props.value;
  const set = (k: keyof GuestDetails) => (e: { target: { value: string } }) => props.onChange({ ...v, [k]: e.target.value });
  const err = (k: keyof GuestDetails) => (props.error?.field === k ? props.error.message : null);

  return (
    <div className="bt-fields">
      <Field id="bt-first" label="Prénom" required error={err("firstName")}>
        <input id="bt-first" autoComplete="given-name" value={v.firstName} onChange={set("firstName")} aria-invalid={!!err("firstName")} />
      </Field>
      <Field id="bt-last" label="Nom" required error={err("lastName")}>
        <input id="bt-last" autoComplete="family-name" value={v.lastName} onChange={set("lastName")} aria-invalid={!!err("lastName")} />
      </Field>
      <Field id="bt-email" label="E-mail" required hint="La confirmation arrive à cette adresse." error={err("email")}>
        <input id="bt-email" type="email" inputMode="email" autoComplete="email" value={v.email} onChange={set("email")} aria-invalid={!!err("email")} />
      </Field>
      <Field id="bt-phone" label="Téléphone" required hint="Pour que l’hôte puisse vous joindre le jour J." error={err("phone")}>
        <input id="bt-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+33 6 12 34 56 78" value={v.phone} onChange={set("phone")} aria-invalid={!!err("phone")} />
      </Field>
      <Field id="bt-msg" label={props.hostFirstName ? `Un mot pour ${props.hostFirstName}` : "Un mot pour l’hôte"} full error={err("message")}>
        <textarea id="bt-msg" value={v.message} onChange={set("message")} placeholder="Heure d’arrivée prévue, occasion spéciale, question…" />
      </Field>
    </div>
  );
}

function Field(props: { id: string; label: string; required?: boolean; full?: boolean; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className={props.full ? "bt-field bt-full" : "bt-field"}>
      <label htmlFor={props.id}>
        {props.label}
        {props.required ? <em aria-hidden="true">*</em> : null}
      </label>
      {props.children}
      {props.error ? (
        <p className="bt-field-error" role="alert">
          {props.error}
        </p>
      ) : props.hint ? (
        <p className="bt-hint">{props.hint}</p>
      ) : null}
    </div>
  );
}
