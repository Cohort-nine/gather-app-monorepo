import { Route, Routes } from "react-router-dom";
import Home from "./components/Home";
import EventFormPage from "./pages/EventFormPage";
import EventsPage from "./pages/EventsPage";
import LoginPage from "./pages/LoginPage";
import MyEventsPage from "./pages/MyEventsPage";
import SignupPage from "./pages/SignupPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/events" element={<EventsPage />} />

      {/* /events/new must come before any /events/:id route so "new" isn't
          matched as an id. */}
      <Route path="/events/new" element={<EventFormPage />} />
      <Route path="/events/:id/edit" element={<EventFormPage />} />
      <Route path="/my-events" element={<MyEventsPage />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
    </Routes>
  );
}
