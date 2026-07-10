import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.vertexscout',
  appName: 'VerteX Scout',
  webDir: 'dist',
  // This project is SSR (TanStack Start on Cloudflare). Capacitor needs a
  // static webDir OR a remote URL to load. We point the Android shell at
  // the published Lovable web app so features that depend on the server
  // (auth, server functions, Google Maps) keep working inside the APK.
  server: {
    url: 'https://solar-scout-atlas.lovable.app',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;