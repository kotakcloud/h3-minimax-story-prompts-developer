import os from "node:os";
import type { NextConfig } from "next";

// Who may load the dev-only scripts and live-reload connection. Without it the page never starts and shows empty lists.
// Any private (Wi-Fi/LAN) address is allowed by pattern, so it keeps working when this PC gets a new address after
// the server started; this PC's current addresses are added as well.
function lanHosts() {
  const hosts = new Set(["localhost", "127.0.0.1", "192.168.*.*", "10.*.*.*", "172.*.*.*"]);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        hosts.add(addr.address);
      }
    }
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: lanHosts(),
};

export default nextConfig;
