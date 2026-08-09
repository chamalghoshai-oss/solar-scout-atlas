import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import {
  billFromUnits,
  computeRoi,
  effectiveRate,
  inr,
  marginalRate,
  monthlyProduction,
  unitsFromBill,
  UNITS_PER_KW_DAY,
  type BillCycle,
} from "@/lib/solar-report";
import { rampCss } from "@/lib/cad-model";

export type ReportPhoto = { url: string; lat?: number | null; lng?: number | null; label?: string };

export type ReportData = {
  title: string;
  customer?: string | null;
  phone?: string | null;
  lat: number;
  lng: number;
  kw: number;
  panelCount: number;
  panelWatt: number;
  avgAccess: number;
  monthlyAccess: number[];
  shots: { top?: string | null; side?: string | null };
  photos: ReportPhoto[];
  company?: string;
};

export function SolarReportDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: ReportData;
}) {
  const [cycle, setCycle] = useState<BillCycle>("bimonthly");
  const [mode, setMode] = useState<"bill" | "units">("bill");
  const [amount, setAmount] = useState(3000);
  const [units, setUnits] = useState(400);
  const [costPerKw, setCostPerKw] = useState(55000);
  const [subsidy, setSubsidy] = useState(0);
  const [exportRate, setExportRate] = useState(3);

  const cycleUnits = mode === "units" ? units : unitsFromBill(amount, cycle);
  const monthlyUnits = cycle === "monthly" ? cycleUnits : cycleUnits / 2;
  const cycleBill = mode === "bill" ? amount : billFromUnits(units, cycle);

  const rows = useMemo(() => monthlyProduction(data.kw, data.monthlyAccess), [data.kw, data.monthlyAccess]);
  const annualUnits = rows.reduce((a, r) => a + r.units, 0);
  const roi = useMemo(
    () =>
      computeRoi({
        kw: data.kw,
        annualUnits,
        monthlyConsumption: monthlyUnits,
        costPerKw,
        subsidy,
        exportRate,
      }),
    [data.kw, annualUnits, monthlyUnits, costPerKw, subsidy, exportRate],
  );

  function generate() {
    if (data.kw <= 0) {
      toast.error("Place panels in the 3D design first");
      return;
    }
    const html = buildReportHtml({
      data,
      cycle,
      cycleUnits,
      cycleBill,
      monthlyUnits,
      rows,
      annualUnits,
      roi,
      costPerKw,
      subsidy,
      exportRate,
    });
    const w = window.open("", "_blank");
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } else {
      const blob = new Blob([html], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `solar-report-${Date.now()}.html`;
      a.click();
    }
    toast.success("Report generated");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" /> Generate solar report
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-[11px] text-muted-foreground">Billing cycle</Label>
            <div className="mt-1 flex overflow-hidden rounded-md border border-border text-xs">
              {(["monthly", "bimonthly"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCycle(c)}
                  className={`flex-1 px-3 py-1.5 ${cycle === c ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {c === "monthly" ? "Monthly" : "Bi-monthly"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-muted-foreground">Enter</Label>
            <div className="mt-1 flex overflow-hidden rounded-md border border-border text-xs">
              {(["bill", "units"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setMode(c)}
                  className={`flex-1 px-3 py-1.5 ${mode === c ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {c === "bill" ? "Bill amount (₹)" : "Units consumed"}
                </button>
              ))}
            </div>
          </div>

          {mode === "bill" ? (
            <Num label={`Bill amount per ${cycle === "monthly" ? "month" : "2 months"} (₹)`} value={amount} onChange={setAmount} />
          ) : (
            <Num label={`Units per ${cycle === "monthly" ? "month" : "2 months"}`} value={units} onChange={setUnits} />
          )}

          <div className="rounded-md border border-border bg-muted/40 p-2 text-[11px] leading-relaxed">
            Derived from KSEB domestic slabs (incl. 10% fixed charges):{" "}
            <b>{Math.round(cycleUnits)} units</b> / {cycle === "monthly" ? "month" : "2 months"} ·{" "}
            <b>{inr(cycleBill)}</b> · avg {effectiveRate(monthlyUnits).toFixed(2)} ₹/unit · marginal{" "}
            {marginalRate(monthlyUnits).toFixed(2)} ₹/unit
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Num label="System cost (₹/kW)" value={costPerKw} onChange={setCostPerKw} />
            <Num label="Subsidy (₹)" value={subsidy} onChange={setSubsidy} />
            <Num label="Export rate (₹/unit)" value={exportRate} onChange={setExportRate} />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <Cell label="System" value={`${data.kw.toFixed(2)} kW`} />
            <Cell label="Annual gen" value={`${annualUnits.toLocaleString("en-IN")} kWh`} />
            <Cell
              label="Break-even"
              value={roi.breakEvenYears ? `${roi.breakEvenYears} yrs` : "—"}
            />
          </div>

          <Button className="w-full" onClick={generate}>
            <FileText className="mr-2 h-4 w-4" /> Generate detailed report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        className="h-8"
        type="number"
        inputMode="decimal"
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs font-bold">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function buildReportHtml(o: {
  data: ReportData;
  cycle: BillCycle;
  cycleUnits: number;
  cycleBill: number;
  monthlyUnits: number;
  rows: ReturnType<typeof monthlyProduction>;
  annualUnits: number;
  roi: ReturnType<typeof computeRoi>;
  costPerKw: number;
  subsidy: number;
  exportRate: number;
}) {
  const { data, roi, rows } = o;
  const period = o.cycle === "monthly" ? "month" : "2 months";
  const monthNames = rows.map((r) => r.month);
  const shadeLoss = Math.round((1 - data.avgAccess) * 100);
  const idealAnnual = Math.round(data.kw * UNITS_PER_KW_DAY * 365);

  const shadeRows = rows
    .map(
      (r, i) => `<tr>
        <td>${monthNames[i]}</td>
        <td>${Math.round(r.access * 100)}%</td>
        <td><span class="bar" style="width:${Math.max(4, r.access * 100)}%;background:${rampCss(r.access)}"></span></td>
        <td>${Math.round((1 - r.access) * 100)}%</td>
      </tr>`,
    )
    .join("");

  const prodRows = rows
    .map(
      (r) => `<tr><td>${r.month}</td><td>${r.days}</td><td>${Math.round(r.access * 100)}%</td>
      <td>${Math.round(data.kw * UNITS_PER_KW_DAY * r.days)}</td><td><b>${r.units}</b></td></tr>`,
    )
    .join("");

  const roiRows = roi.rows
    .map(
      (r) =>
        `<tr><td>${r.year}</td><td>${r.units.toLocaleString("en-IN")}</td><td>${inr(r.savings)}</td><td class="${r.cumulative >= 0 ? "pos" : "neg"}">${inr(r.cumulative)}</td></tr>`,
    )
    .join("");

  const photoCards = data.photos
    .map(
      (p) => `<figure><img src="${p.url}" alt="Site photo"/><figcaption>${
        p.lat != null ? `${p.lat.toFixed(5)}, ${p.lng?.toFixed(5) ?? ""}` : esc(p.label ?? "Site photo")
      }</figcaption></figure>`,
    )
    .join("");

  const shot = (src: string | null | undefined, cap: string) =>
    src ? `<figure class="big"><img src="${src}" alt="${cap}"/><figcaption>${cap}</figcaption></figure>` : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Solar proposal — ${esc(data.title)}</title>
<style>
 :root{--o:#f97316;--ink:#101418;--mut:#667085;--line:#e5e7eb}
 *{box-sizing:border-box}
 body{margin:0;font:14px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#f6f7f9}
 .page{max-width:900px;margin:0 auto;background:#fff;padding:28px}
 h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:26px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--o)}
 .sub{color:var(--mut);font-size:12px}
 .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}
 .kpi{border:1px solid var(--line);border-radius:10px;padding:10px}
 .kpi span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
 .kpi b{font-size:17px}
 table{width:100%;border-collapse:collapse;font-size:12.5px}
 th,td{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left}
 th{background:#fafafa;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
 .bar{display:inline-block;height:9px;border-radius:5px}
 .pos{color:#127a3d;font-weight:600}.neg{color:#b42318}
 .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
 figure{margin:0}figure img{width:100%;border:1px solid var(--line);border-radius:8px;display:block}
 figure.big img{border-radius:10px}
 figcaption{font-size:11px;color:var(--mut);margin-top:4px}
 .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
 .note{font-size:11.5px;color:var(--mut);margin-top:8px}
 .btn{position:fixed;right:16px;bottom:16px;background:var(--o);color:#fff;border:0;border-radius:999px;padding:12px 20px;font-weight:600;box-shadow:0 6px 18px rgba(0,0,0,.2);cursor:pointer}
 @media print{.btn{display:none}body{background:#fff}.page{padding:0}}
</style></head><body><div class="page">

<h1>Solar proposal &amp; shadow analysis</h1>
<div class="sub">${esc(data.title)}${data.customer ? ` · ${esc(data.customer)}` : ""}${data.phone ? ` · ${esc(data.phone)}` : ""}<br/>
Site ${data.lat.toFixed(5)}, ${data.lng.toFixed(5)} · generated ${new Date().toLocaleString("en-IN")}${data.company ? ` · ${esc(data.company)}` : ""}</div>

<div class="kpis">
  <div class="kpi"><span>System size</span><b>${data.kw.toFixed(2)} kW</b></div>
  <div class="kpi"><span>Modules</span><b>${data.panelCount} × ${data.panelWatt} W</b></div>
  <div class="kpi"><span>Annual generation</span><b>${o.annualUnits.toLocaleString("en-IN")} kWh</b></div>
  <div class="kpi"><span>Break-even</span><b>${roi.breakEvenYears ? `${roi.breakEvenYears} years` : "—"}</b></div>
</div>

<h2>1. 3D design views</h2>
<div class="two">${shot(data.shots.top, "Top view — panel layout &amp; yearly irradiance heat map")}${shot(data.shots.side, "Side view — mounting, tilt 11° south, obstructions")}</div>
<p class="note">Colours on the roof deck show yearly sun access: green = full sun, yellow/orange = partial shade, magenta = heavily shaded.</p>

${photoCards ? `<h2>2. Geo-tagged site photos</h2><div class="grid">${photoCards}</div>` : ""}

<h2>${photoCards ? 3 : 2}. Shadow analysis</h2>
<p class="note">Average yearly sun access across the array is <b>${Math.round(data.avgAccess * 100)}%</b>, i.e. an estimated shading loss of <b>${shadeLoss}%</b> against an unshaded roof. Sun paths are sampled every 30 minutes from 6 am to 6 pm on the 15th of each month for this exact latitude/longitude, against every modelled building, storey, parapet, block and tree.</p>
<table><thead><tr><th>Month</th><th>Sun access</th><th></th><th>Shading loss</th></tr></thead><tbody>${shadeRows}</tbody></table>

<h2>${photoCards ? 4 : 3}. Production estimate</h2>
<p class="note">Baseline yield of <b>${UNITS_PER_KW_DAY} units per kW per day</b>, adjusted month by month with the measured shading factor above.</p>
<table><thead><tr><th>Month</th><th>Days</th><th>Sun access</th><th>Ideal (kWh)</th><th>Expected (kWh)</th></tr></thead><tbody>${prodRows}
<tr><td><b>Year</b></td><td>365</td><td>${Math.round(data.avgAccess * 100)}%</td><td>${idealAnnual.toLocaleString("en-IN")}</td><td><b>${o.annualUnits.toLocaleString("en-IN")}</b></td></tr></tbody></table>

<h2>${photoCards ? 5 : 4}. Consumption &amp; tariff (KSEB domestic)</h2>
<table><tbody>
<tr><th>Billing cycle</th><td>${o.cycle === "monthly" ? "Monthly" : "Bi-monthly"}</td></tr>
<tr><th>Bill per ${period}</th><td>${inr(o.cycleBill)}</td></tr>
<tr><th>Units per ${period}</th><td>${Math.round(o.cycleUnits)} kWh</td></tr>
<tr><th>Average consumption</th><td>${Math.round(o.monthlyUnits)} kWh / month · ${Math.round(o.monthlyUnits * 12)} kWh / year</td></tr>
<tr><th>Effective tariff</th><td>₹${effectiveRate(o.monthlyUnits).toFixed(2)} per unit (slab energy charge + 10% fixed charges)</td></tr>
<tr><th>Marginal tariff saved</th><td>₹${marginalRate(o.monthlyUnits).toFixed(2)} per unit offset by solar</td></tr>
<tr><th>Solar offset</th><td>${Math.min(100, Math.round((o.annualUnits / Math.max(1, o.monthlyUnits * 12)) * 100))}% of yearly consumption</td></tr>
</tbody></table>

<h2>${photoCards ? 6 : 5}. ROI projection</h2>
<table><tbody>
<tr><th>System cost</th><td>${inr(roi.capex)} (${inr(o.costPerKw)}/kW)</td></tr>
<tr><th>Subsidy</th><td>${inr(o.subsidy)}</td></tr>
<tr><th>Net investment</th><td><b>${inr(roi.netCapex)}</b></td></tr>
<tr><th>Self-consumed</th><td>${roi.selfUse.toLocaleString("en-IN")} kWh/yr · exported ${roi.exportUnits.toLocaleString("en-IN")} kWh/yr @ ₹${o.exportRate}/unit</td></tr>
<tr><th>First-year saving</th><td>${inr(roi.firstYearSavings)}</td></tr>
<tr><th>Break-even</th><td><b>${roi.breakEvenYears ? `${roi.breakEvenYears} years` : "beyond 25 years"}</b></td></tr>
<tr><th>25-year net gain</th><td class="pos">${inr(roi.lifetimeSavings)}</td></tr>
</tbody></table>
<table style="margin-top:10px"><thead><tr><th>Year</th><th>Generation (kWh)</th><th>Saving</th><th>Cumulative</th></tr></thead><tbody>${roiRows}</tbody></table>
<p class="note">Assumes 5% annual tariff escalation, 0.7% annual module degradation and current KSEB domestic slabs. Actual output varies with weather, soiling and maintenance.</p>

<button class="btn" onclick="window.print()">Print / Save PDF</button>
</div></body></html>`;
}