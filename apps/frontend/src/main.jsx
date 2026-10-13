import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import "./styles.css";

// Wake the free-tier API as soon as the site opens, so it is ready by the time
// someone submits the login form. Failures are ignored on purpose.
const apiBase = import.meta.env.VITE_API_BASE_URL;
if (apiBase) {
  fetch(`${apiBase}/health`, { method: "GET", cache: "no-store" }).catch(() => {});
}

// The boundary sits inside BrowserRouter so its fallback can still use router
// context, and outside App so it catches a throw from any route.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
