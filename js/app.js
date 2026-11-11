import {init} from "./ui.js";
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
