import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installMotionDevTools } from "./dev/motionDevTools";
import { AppMotionProvider } from "./shared/motion";
import { useStore } from "./store/sessionStore";
import "./index.css";
import "./styles/transitions.css";
import "./styles/react-flow.css";
import "./styles/markdown.css";

const root = document.getElementById("root");

if (import.meta.env.DEV) {
  installMotionDevTools();
}

if (!root) {
  throw new Error("#root not found in index.html");
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

function Root(): JSX.Element {
  const motionLevel = useStore((state) => state.motionLevel);
  return (
    <AppMotionProvider level={motionLevel}>
      <App />
    </AppMotionProvider>
  );
}
