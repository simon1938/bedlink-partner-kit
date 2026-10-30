// E-mail frame in the Logement Atypique style (the croquis validated on
// 30/10/2026). E-mail clients ignore CSS variables and most <style> blocks:
// colours are plain values here, styles are inline, layout is tables.
// Replace THEME with your colours; keep the structure.

export const THEME = {
  primary: "#590B00", // bordeaux LA
  onPrimary: "#FFFFFF",
  page: "#F4F1EC",
  card: "#FFFFFF",
  cream: "#F6F1EA",
  ink: "#1A1412",
  ink2: "#6B625E",
  line: "#ECE8E2",
  fontDisplay: "'Bodoni Moda', Georgia, 'Times New Roman', serif",
  fontLabel: "'Syncopate', 'Manrope', Arial, sans-serif",
  fontBody: "'Manrope', -apple-system, 'Segoe UI', Arial, sans-serif",
  wordmark: "LOGEMENT ATYPIQUE",
};

export function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function kicker(text: string) {
  return `<p style="margin:0 0 8px;font-family:${THEME.fontLabel};font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:${THEME.primary}">${esc(text)}</p>`;
}

export function title(text: string) {
  return `<h1 style="margin:0 0 12px;font-family:${THEME.fontDisplay};font-weight:400;font-size:26px;line-height:1.15;color:${THEME.ink}">${esc(text)}</h1>`;
}

export function paragraph(html: string) {
  return `<p style="margin:0 0 12px;font-size:14.5px;line-height:1.55;color:${THEME.ink}">${html}</p>`;
}

/** Two-column table. Values are HTML (escape them before). `total` = bold last row. */
export function table(rows: [string, string][], total?: [string, string]) {
  const cell = "padding:8px 0;border-bottom:1px solid " + THEME.line + ";vertical-align:top;font-size:13.5px;";
  const body = rows
    .map(([k, v]) => `<tr><td style="${cell}color:${THEME.ink2}">${k}</td><td style="${cell}text-align:right;color:${THEME.ink}">${v}</td></tr>`)
    .join("");
  const tot = total
    ? `<tr><td style="padding:12px 0 0;font-weight:700;font-size:15px">${total[0]}</td><td style="padding:12px 0 0;text-align:right;font-weight:700;font-size:15px">${total[1]}</td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">${body}${tot}</table>`;
}

export function box(html: string) {
  return `<div style="background:${THEME.cream};padding:14px 16px;font-size:13px;line-height:1.5;margin:16px 0;color:${THEME.ink}">${html}</div>`;
}

export function button(label: string, href: string) {
  return `<p style="text-align:center;margin:22px 0 6px"><a href="${esc(href)}" style="display:inline-block;background:${THEME.primary};color:${THEME.onPrimary};text-decoration:none;font-family:${THEME.fontLabel};font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;padding:14px 22px">${esc(label)}</a></p>`;
}

export function layout(opts: { preheader: string; band: string; heroUrl?: string; body: string; footer: string }) {
  const hero = opts.heroUrl
    ? `<tr><td><img src="${esc(opts.heroUrl)}" width="600" alt="" style="display:block;width:100%;height:auto;max-height:240px;object-fit:cover;border:0"></td></tr>`
    : "";
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(opts.preheader)}</title></head>
<body style="margin:0;padding:0;background:${THEME.page}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${THEME.page}"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${THEME.card};font-family:${THEME.fontBody};color:${THEME.ink}">
<tr><td style="background:${THEME.primary};padding:18px 24px;text-align:center">
<span style="font-family:${THEME.fontLabel};font-weight:700;font-size:11px;letter-spacing:.22em;color:${THEME.onPrimary}">${esc(THEME.wordmark)}</span><br>
<span style="font-family:${THEME.fontLabel};font-size:8px;letter-spacing:.3em;color:rgba(255,255,255,.65)">${esc(opts.band)}</span>
</td></tr>
${hero}
<tr><td style="padding:24px">${opts.body}</td></tr>
<tr><td style="padding:16px 24px 22px;font-size:11.5px;line-height:1.5;color:${THEME.ink2};border-top:1px solid ${THEME.line};text-align:center">${opts.footer}</td></tr>
</table></td></tr></table></body></html>`;
}
