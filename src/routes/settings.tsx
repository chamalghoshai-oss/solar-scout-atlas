import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/device";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Sun } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — VertX Field" },
      { name: "description", content: "Edit the WhatsApp follow-up message and sender details." },
      { property: "og:title", content: "Settings — VertX Field" },
      { property: "og:description", content: "Edit the WhatsApp follow-up message and sender details." },
    ],
  }),
  component: SettingsPage,
});

const DEFAULT_TEMPLATE = "Hi {name}, this is {sender} from {company}. I am following up on our chat about the {kw}kW solar system for your site...";

function SettingsPage() {
  const [sender, setSender] = useState("Aureon");
  const [company, setCompany] = useState("VertX Energies");
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState<boolean>(
    typeof window !== "undefined" && localStorage.getItem("wa_business") === "1"
  );

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("settings").select("*").maybeSingle();
      if (data) {
        setSender(data.sender_name);
        setCompany(data.company_name);
        setTemplate(data.whatsapp_template);
      }
      setLoading(false);
    })();
  }, []);

  function toggleBusiness(v: boolean) {
    setBusiness(v);
    try { localStorage.setItem("wa_business", v ? "1" : "0"); } catch { /* ignore */ }
  }

  async function save() {
    setSaving(true);
    const device = getDeviceId();
    const uid = (await supabase.auth.getSession()).data.session?.user?.id ?? null;
    const { error } = await supabase.from("settings").upsert({
      device_id: device,
      user_id: uid,
      sender_name: sender.trim() || "Aureon",
      company_name: company.trim() || "VertX Energies",
      whatsapp_template: template.trim() || DEFAULT_TEMPLATE,
    }, { onConflict: "user_id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  }

  if (loading) {
    return <AppShell><div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div></AppShell>;
  }

  return (
    <AppShell>
      <header className="mb-4 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary"><Sun className="h-5 w-5" /></div>
        <div>
          <h1 className="text-xl font-bold">Settings</h1>
          <p className="text-xs text-muted-foreground">VertX Field · Solar Survey</p>
        </div>
      </header>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">WhatsApp follow-up</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Sender name</Label>
            <Input value={sender} maxLength={50} onChange={(e) => setSender(e.target.value)} />
          </div>
          <div>
            <Label>Company</Label>
            <Input value={company} maxLength={80} onChange={(e) => setCompany(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Message template</Label>
          <Textarea value={template} rows={5} maxLength={600} onChange={(e) => setTemplate(e.target.value)} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Placeholders: <code>{"{name}"}</code> <code>{"{kw}"}</code> <code>{"{sender}"}</code> <code>{"{company}"}</code>
          </p>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <div>
            <Label className="text-sm">Open in WhatsApp Business</Label>
            <p className="text-[11px] text-muted-foreground">Android opens com.whatsapp.w4b. iOS uses whichever WhatsApp is installed.</p>
          </div>
          <Switch checked={business} onCheckedChange={toggleBusiness} />
        </div>
        <Button className="w-full" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save</>}
        </Button>
      </section>

      <p className="mt-6 px-1 text-center text-[11px] text-muted-foreground">
        Owner-managed access · data synced to your field account.
      </p>
    </AppShell>
  );
}