export function buildWhatsAppLink(opts: {
  phone: string;
  name?: string | null;
  kw?: number | null;
  template: string;
  sender: string;
  company: string;
}): string {
  const cleaned = (opts.phone || "").replace(/[^\d]/g, "");
  const msg = opts.template
    .replaceAll("{name}", opts.name?.trim() || "there")
    .replaceAll("{sender}", opts.sender)
    .replaceAll("{company}", opts.company)
    .replaceAll("{kw}", opts.kw ? String(opts.kw) : "");
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(msg)}`;
}