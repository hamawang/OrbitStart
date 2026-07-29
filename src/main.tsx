import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./styles/motion-tokens.css";
import "./styles/motion-components.css";
import { installFrontendErrorReporting } from "./bootstrap/frontendErrorReporting";
import { initializeMotionRoot } from "./motion/policy";

installFrontendErrorReporting();
initializeMotionRoot();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
