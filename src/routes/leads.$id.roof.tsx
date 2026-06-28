import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { RoofPlanner, type RoofPlan } from "@/components/RoofPlanner";
import { toast } from "sonner";

export const Route = createFileRoute("/leads/$id/roof")({
  head: () => ({
    meta: [
      { title: "Plan roof — VertX Field" },
      { name: "description", content: "Draw the roof on satellite imagery and auto-fit solar panels." },
    ],
  }),
  component: RoofPlanPage,
});

type LeadLite = {
  id: string;
  lat: number;
  lng: number;
  required_kw: number | null;
  roof_plan: RoofPlan | null;
};

function RoofPlanPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState<LeadLite | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id,lat,lng,required_kw,roof_plan")
        .eq("id", id)
        .maybeSingle();
      if (error) {
        toast.error(error.message);
        navigate({ to: "/leads/$id", params: { id } });
        return;
      }
      if (!data) {
        navigate({ to: "/leads" });
        return;
      }
      setLead(data as unknown as LeadLite);
    })();
  }, [id, navigate]);

  function goBack() {
    navigate({ to: "/leads/$id", params: { id } });
  }

  async function onSave(plan: RoofPlan) {
    if (!lead) return;
    const active = plan.panels.length - (plan.disabled?.length ?? 0);
    const kwFromPlan = (active * plan.spec.watt) / 1000;
    const nextKw = lead.required_kw ?? Math.round(kwFromPlan * 100) / 100;
    const { error } = await supabase
      .from("leads")
      .update({ roof_plan: plan, required_kw: nextKw })
      .eq("id", lead.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Roof plan saved");
    goBack();
  }

  if (!lead) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <RoofPlanner
      open
      onOpenChange={(v) => {
        if (!v) goBack();
      }}
      center={{ lat: lead.lat, lng: lead.lng }}
      initial={lead.roof_plan}
      onSave={onSave}
    />
  );
}