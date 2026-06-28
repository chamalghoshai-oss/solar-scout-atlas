export function buildWhatsAppLink(opts: {
  phone: string;
  name?: string | null;
  kw?: number | null;
  template: string;
  sender: string;
  company: string;
  business?: boolean;
}): string {
  const cleaned = (opts.phone || "").replace(/[^\d]/g, "");
  const msg = opts.template
    .replaceAll("{name}", opts.name?.trim() || "there")
    .replaceAll("{sender}", opts.sender)
    .replaceAll("{company}", opts.company)
    .replaceAll("{kw}", opts.kw ? String(opts.kw) : "");
  const text = encodeURIComponent(msg);
  const fallback = `https://wa.me/${cleaned}?text=${text}`;
  if (!opts.business) return fallback;
  // Android: open WhatsApp Business (com.whatsapp.w4b) explicitly via intent URI.
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isAndroid = /Android/i.test(ua);
  if (isAndroid) {
    return `intent://send/?phone=${cleaned}&text=${text}#Intent;scheme=smsto;package=com.whatsapp.w4b;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  }
  // iOS / desktop: wa.me opens whichever WhatsApp app is installed.
  return fallback;
}