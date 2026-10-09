import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.luxury.cookie",
  appName: "Cookie",
  webDir: "../web/dist",
  android: { allowMixedContent: false },
};

export default config;
