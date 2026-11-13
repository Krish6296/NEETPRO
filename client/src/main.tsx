import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const isProductionBuild = document.querySelector('script[src*="/assets/"]') !== null;
if (isProductionBuild && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("Could not register the offline app shell.", error);
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
