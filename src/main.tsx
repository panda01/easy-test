import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import App from "./App";
import { nocturneTheme } from "./theme/nocturneTheme";
import "./index.css";

// index.html always ships `<div id="root">`, so a missing element means that
// file was broken - fail with a message that says so rather than with React's
// generic "Target container is not a DOM element".
const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error('index.html is missing the <div id="root"> mount point');
}

// The visual identity lives in `theme/nocturneTheme.ts` (the Nocturne design
// system's tokens and the MUI overrides built from them).
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider theme={nocturneTheme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
