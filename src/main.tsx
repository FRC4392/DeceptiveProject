import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { ConvexReactClient } from "convex/react";
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react";
import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import App from "./App.tsx";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider attribute="class">
        <AuthKitProvider
          clientId={import.meta.env.VITE_WORKOS_CLIENT_ID as string}
          redirectUri={import.meta.env.VITE_WORKOS_REDIRECT_URI as string}
        >
          <ConvexProviderWithAuthKit client={convex} useAuth={useAuth}>
            <App />
          </ConvexProviderWithAuthKit>
        </AuthKitProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
