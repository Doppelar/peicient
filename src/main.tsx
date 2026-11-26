import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { inject } from "@vercel/analytics";

// 閲覧数（Vercel Web Analytics。Cookie を使わない集計）
inject();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
