import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import "./styles/transitions.css";
import "./styles/react-flow.css";
import "./styles/markdown.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("#root not found in index.html");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
