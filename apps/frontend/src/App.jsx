import { Route, Routes } from "react-router-dom";
import Home from "./components/Home";
import EventsPage from "./pages/EventsPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import CreateEventPage from "./pages/CreateEventPage.jsx";
import MyRsvpsPage from "./pages/MyRsvpsPage.jsx";
import EventDetailPage from "./pages/EventDetailPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/events" element={<EventsPage />} />
      <Route path="/events/new" element={<CreateEventPage />} />
      <Route path="/events/:id" element={<EventDetailPage />} />
      <Route path="/me/rsvps" element={<MyRsvpsPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
    </Routes>
  );
}
