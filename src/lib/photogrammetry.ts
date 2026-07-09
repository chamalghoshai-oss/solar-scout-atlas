// Photogrammetry provider adapter.
//
// Lovable can scaffold the app, storage, UI and workflow around the job —
// but the actual 3D reconstruction from photos/video needs a specialized
// service (RealityCapture, Luma AI, Meshroom, Polycam, Google Solar API,
// etc.). Swap `mockProvider` for a real implementation and everything
// else in the app keeps working.

export type SimJobInput = {
  jobId: string;
  uploadPaths: string[]; // paths inside the sim-uploads bucket
  lat?: number | null;
  lng?: number | null;
};

export type SimJobResult = {
  status: "ready" | "failed";
  meshUrl?: string | null;
  kwEstimate?: number | null;
  annualKwh?: number | null;
  notes?: string | null;
  error?: string | null;
};

export interface PhotogrammetryProvider {
  id: string;
  /** Kick off a processing job. Returns quickly; result is delivered later. */
  submit(input: SimJobInput): Promise<{ providerJobId: string }>;
  /** Optionally poll for status. Not required for the mock. */
  poll?(providerJobId: string): Promise<SimJobResult | null>;
}

/**
 * Mock provider: no external service.
 * It fakes a "processed" result after a short delay so the UI shows a
 * placeholder mesh and estimate immediately. Replace with a real provider
 * when integrating RealityCapture / Luma / Polycam / etc.
 */
export const mockProvider: PhotogrammetryProvider = {
  id: "mock",
  async submit({ uploadPaths }) {
    // Deterministic-ish estimate based on input count so the UI feels alive.
    return { providerJobId: `mock-${uploadPaths.length}-${Date.now()}` };
  },
  async poll(id) {
    // The mock is always "ready" once polled.
    const seed = Number(id.split("-")[1] ?? 6);
    const kw = Math.max(3, Math.min(12, seed * 0.8 + 3));
    return {
      status: "ready",
      meshUrl: null, // r3f viewer falls back to a placeholder roof mesh
      kwEstimate: Math.round(kw * 10) / 10,
      annualKwh: Math.round(kw * 1450), // rough India-average yield
      notes: "Mock reconstruction. Wire a real provider in src/lib/photogrammetry.ts.",
    };
  },
};

export const activeProvider: PhotogrammetryProvider = mockProvider;