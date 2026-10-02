import { type ReactElement } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";

/**
 * Application shell. Owns the router and nothing else. There is exactly one
 * route today; the BrowserRouter is here from the start so adding a page is a
 * one-line change rather than a refactor.
 *
 * @returns {ReactElement} The routed application
 */
export default function App(): ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
}
