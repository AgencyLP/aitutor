import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import CompatibilityCheck from "./pages/CompatibilityCheck";
import WhiteboardLesson from "./pages/WhiteboardLesson";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/check" element={<CompatibilityCheck />} />
      <Route path="/lesson" element={<WhiteboardLesson />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
