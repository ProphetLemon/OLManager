import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import "./App.css";
import AppV2 from "./ui-v2/AppV2";
import { getApiClient } from "./api/client";
import { installBackGuard } from "./lib/backGuard";

// Disable the native browser context menu in the Tauri app.
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

// Global fallback for broken images: if any <img> fails to load and isn't
// already the fallback, swap to the default player photo. Prevents the
// "broken image" placeholder in production when photos aren't available
// (e.g. before the first data import, or for missing photo files).
const FALLBACK_IMG = "/default/defaultplayer.webp";
document.addEventListener(
  "error",
  (event) => {
    const img = event.target;
    if (
      img instanceof HTMLImageElement &&
      !img.src.endsWith(FALLBACK_IMG) &&
      !img.src.endsWith("defaultstaff.webp")
    ) {
      img.src = FALLBACK_IMG;
    }
  },
  true, // capture phase — fires before the event bubbles to component handlers
);

// The system Back listener must be registered before the router's, which registers when the
// app first mounts: Chromium runs popstate listeners in registration order.
installBackGuard();

function Boot() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    getApiClient().then(() => setReady(true));
  }, []);
  if (!ready) return null;
  return <AppV2 />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Boot />
  </React.StrictMode>,
);
