import { BrowserRouter, Routes, Route } from "react-router-dom";
import RedirectPage from "./pages/RedirectPage";
import HomePage from "./pages/HomePage";
import NotFoundPage from "./pages/NotFoundPage";
import ExpiredPage from "./pages/ExpiredPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/not-found" element={<NotFoundPage />} />
        <Route path="/expired" element={<ExpiredPage />} />
        <Route path="/:slug" element={<RedirectPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
