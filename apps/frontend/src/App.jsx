import { Route, Routes, useLocation } from "react-router-dom";
import Home from "./components/Home";
import NavBar from "./components/NavBar";
import EventFormPage from "./pages/EventFormPage";
import EventsPage from "./pages/EventsPage";
import LoginPage from "./pages/LoginPage";
import MyEventsPage from "./pages/MyEventsPage";
import SignupPage from "./pages/SignupPage";

export default function App() {
  const { pathname } = useLocation();

  // Home ships its own nav, built around the intro animation that flies the
  // logo into a reserved slot. A second bar on top would fight it.
  const showNav = pathname !== "/";

  return (
    <>
      {showNav ? <NavBar /> : null}

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/events" element={<EventsPage />} />

        {/* /events/new is declared before any /events/:id route so "new" can't
            be matched as an id. */}
        <Route path="/events/new" element={<EventFormPage />} />
        <Route path="/events/:id/edit" element={<EventFormPage />} />
        <Route path="/my-events" element={<MyEventsPage />} />

        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        {/* Anything unmatched. Without this, a bad URL renders a blank page and
            looks like the app crashed. */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

function NotFound() {
  return (
    <main className="page">
      <section className="panel">
        <p className="eyebrow">404</p>
        <h1>That page doesn't exist</h1>
        <p className="status">
          The link may be out of date, or the event may have been deleted.
        </p>
        <a href="/events">Browse gatherings</a>
      </section>
    </main>
  );
}
