import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./mobile.css";
import App from "./App.tsx";
import { useServiceCategories } from "./store/useServiceCategories";
import { useStore } from "./store/useStore";
import { initializeDemoWorkspace } from "./demo/workspace";

initializeDemoWorkspace();
useServiceCategories.getState().initialize(useStore.getState().services);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
