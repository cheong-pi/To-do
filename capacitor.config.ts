import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dontforget.app",
  // Keep this ASCII because Capacitor's Windows config copy can corrupt Korean text.
  // The user-facing Android label remains "잊지 마" in res/values/strings.xml.
  appName: "Dont Forget",
  webDir: "dist",
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_dont_forget",
      iconColor: "#FFE680",
      presentationOptions: ["sound", "banner", "list"]
    }
  }
};

export default config;
