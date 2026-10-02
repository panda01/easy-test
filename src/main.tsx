import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import App from "./App";
import "./index.css";

/**
 * Application MUI theme. Created inline here rather than in its own module so
 * there is exactly one place that owns the visual identity for as long as it
 * fits on a screen; split it out when it stops fitting.
 */
const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#58a6ff", contrastText: "#fff" },
    success: { main: "#3fb950", contrastText: "#0d1117" },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
