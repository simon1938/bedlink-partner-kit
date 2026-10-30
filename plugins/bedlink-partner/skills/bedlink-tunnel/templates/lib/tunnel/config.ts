import type { Extra } from "@/components/tunnel/types";

// What the tunnel needs from YOUR site. Everything here is Logement Atypique
// data: replace each "À brancher" with a call to your own database or CMS.
// Server side only.

export type ListingContent = {
  listingId: string;
  slug: string;
  name: string;
  subtitle?: string; // "Cabane perchée · Marais de Brière"
  photoUrl?: string; // first photo, https
  url: string; // public page of the listing
  hostFirstName?: string;
  hostEmail: string; // where the host e-mail goes
  termsUrl: string; // your booking conditions (CGV) + the host's cancellation policy
  extras: Extra[]; // the extras of this listing (your catalogue), [] if none
};

/** Public URL of the site, for the payment return page and the e-mails. */
export function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
  if (!url) throw new Error("Set NEXT_PUBLIC_SITE_URL (https://logement-atypique.fr) to build return URLs.");
  return url.replace(/\/$/, "");
}

export async function getListing(listingId: string): Promise<ListingContent | null> {
  void listingId;
  throw new Error("À brancher : lire l'annonce (nom, photo, hôte, extras) dans votre base.");
}

export type Email = { from: string; to: string; subject: string; html: string; text: string; replyTo?: string };

/** Your e-mail provider (Resend, Postmark, SES…). Throw on failure: the send is retried. */
export async function sendEmail(email: Email): Promise<void> {
  void email;
  throw new Error("À brancher : envoyer l'e-mail avec votre fournisseur.");
}

/** Sender and identity used in the e-mails. Adresses à confirmer par Logement Atypique. */
export const EMAIL_FROM = "Logement Atypique <reservations@logement-atypique.fr>";
export const SUPPORT_EMAIL = "contact@logement-atypique.fr";
