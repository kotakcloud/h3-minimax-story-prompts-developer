// Passive "what is this tab doing" signals (ported from the Themed Transformation pipeline's tab_status.js):
//   running(label, percent) -> tab title "⏳ 42% Video · <page title>" + a favicon progress ring
//   finished("done" | "failed", label) -> if the tab is in the background (or the window is not focused): the title
//       alternates slowly between "✅ Done: <label>" and the page title and the favicon turns green / red, until
//       you come back (visibility / focus). If you are looking at the page it just flashes the title for a few seconds.
//   idle() -> original title, original favicon. Nothing here makes a sound, opens a popup or asks for permission.

type Mode = "idle" | "running" | "attention" | "flash";
type Kind = "done" | "failed";

let baseTitle = "";
let mode: Mode = "idle";
let running: { label: string; percent: number | null } = { label: "", percent: null };
let attention: { kind: Kind; label: string } | null = null;
let blinkTimer: number | null = null;
let flashTimer: number | null = null;
let blinkOn = false;
let iconLink: HTMLLinkElement | null = null;
let lastIconKey = "";
let listening = false;

function inBackground() {
  return document.hidden || !document.hasFocus();
}

function drawIcon(kind: "idle" | "running" | Kind, percent?: number | null) {
  const key = `${kind}:${percent ?? ""}`;
  if (key === lastIconKey) return;
  lastIconKey = key;
  if (kind === "idle") {
    iconLink?.remove();
    iconLink = null;
    return;
  }
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return;
  const c = size / 2;
  if (kind === "running") {
    g.lineWidth = 9;
    g.strokeStyle = "rgba(160,160,160,0.45)";
    g.beginPath();
    g.arc(c, c, 24, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "#e23636";
    g.lineCap = "round";
    g.beginPath();
    const fraction = percent == null ? 0.25 : Math.max(0.04, Math.min(1, percent / 100));
    g.arc(c, c, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction);
    g.stroke();
  } else {
    g.fillStyle = kind === "done" ? "#3fb950" : "#f85149";
    g.beginPath();
    g.arc(c, c, 29, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#ffffff";
    g.lineWidth = 8;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    if (kind === "done") {
      g.moveTo(19, 33);
      g.lineTo(28, 42);
      g.lineTo(46, 22);
    } else {
      g.moveTo(c, 16);
      g.lineTo(c, 36);
      g.moveTo(c, 46);
      g.lineTo(c, 47);
    }
    g.stroke();
  }
  if (!iconLink) {
    iconLink = document.createElement("link");
    iconLink.rel = "icon";
    document.head.appendChild(iconLink);
  }
  iconLink.type = "image/png";
  iconLink.href = canvas.toDataURL("image/png");
}

function stopTimers() {
  if (blinkTimer !== null) window.clearInterval(blinkTimer);
  if (flashTimer !== null) window.clearTimeout(flashTimer);
  blinkTimer = flashTimer = null;
}

function attentionTitle() {
  return attention ? `${attention.kind === "done" ? "✅ Done: " : "⚠️ Failed: "}${attention.label}` : "";
}

function apply() {
  if (mode === "running") {
    document.title = `⏳ ${running.percent != null ? `${running.percent}% ` : ""}${running.label} · ${baseTitle}`;
    drawIcon("running", running.percent);
  } else if ((mode === "attention" || mode === "flash") && attention) {
    document.title = mode === "attention" && blinkOn ? baseTitle : `${attentionTitle()} · ${baseTitle}`;
    drawIcon(attention.kind);
  } else {
    document.title = baseTitle;
    drawIcon("idle");
  }
}

function clearAttention() {
  if (mode !== "attention") return;
  stopTimers();
  attention = null;
  mode = "idle";
  apply();
}

// The page title as the app set it (Next.js may rewrite it on navigation), without our own prefixes.
function setup() {
  if (mode === "idle") baseTitle = document.title;
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) clearAttention();
  });
  window.addEventListener("focus", clearAttention);
}

export const TabStatus = {
  running(label: string, percent: number | null) {
    setup();
    stopTimers();
    attention = null;
    mode = "running";
    running = {
      label: label || "Working",
      percent: percent == null ? null : Math.max(0, Math.min(99, Math.round(percent))),
    };
    apply();
  },
  finished(kind: Kind, label: string) {
    setup();
    stopTimers();
    attention = { kind, label: label || "Finished" };
    if (inBackground()) {
      mode = "attention";
      blinkOn = false;
      apply();
      blinkTimer = window.setInterval(() => {
        blinkOn = !blinkOn;
        apply();
      }, 2000);
    } else {
      mode = "flash";
      apply();
      flashTimer = window.setTimeout(() => {
        attention = null;
        mode = "idle";
        apply();
      }, 6000);
    }
  },
  idle() {
    if (mode === "attention" || mode === "flash") return; // keep the finished state until it is seen
    if (mode === "idle") return;
    stopTimers();
    mode = "idle";
    apply();
  },
};
