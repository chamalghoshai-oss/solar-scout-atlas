import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.vertexscout',
  appName: 'VerteX Scout',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;