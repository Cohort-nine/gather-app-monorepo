import { useEffect, useState } from "react";
import { fetchEventRatings, rateHost } from "../api/events.js";
import "./HostRatingForm.css";

// ---------------------------------------------------------------------------
// Rate the host of an event you attended.
//
// The stars were readable long before they were writable — the API and its
// rules shipped, but nothing in the UI could produce a rating, so every score
// on the site came from the seed. This closes that.
//
// The backend owns the rules and enforces all of them (can't rate your own
// event, must have RSVP'd, must have happened, not cancelled, not a no-show).
// This component only decides whether it's plausibly worth showing the form —
// the server is still the authority, and its refusal message is surfaced as-is
// rather than being second-guessed here.
//
// Submitting again edits your existing rating: the backend upserts on
// (event, rater), so there's no separate update path to build.
// ---------------------------------------------------------------------------

const STARS = [1, 2, 3, 4, 5];

export default function HostRatingForm({ eventId, hostName, onRated }) {
  const [ratings, setRatings] = useState(null);
  const [mine, setMine] = useState(null);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // GET returns { ratings, summary } — not a bare array. Reaching straight for
  // res.data here would hand .map() an object.
  useEffect(() => {
    fetchEventRatings(eventId)
      .then((res) => setRatings(res.data?.ratings ?? []))
      .catch(() => setRatings([]));
  }, [eventId]);

  async function handleSubmit(e) {
    e.preventDefault();

    // Frontend validation, mirroring the backend's — a rating of 0 means
    // nothing was chosen, and the API would reject it anyway.
    if (rating < 1) {
      setError("Pick a rating from 1 to 5 first.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await rateHost(eventId, { rating, comment: comment.trim() || null });
      setMessage(res.message);
      // POST returns { rating, hostReputation } — the rating row plus the
      // host's freshly recomputed score.
      setMine(res.data?.rating ?? { rating, comment });
      const refreshed = await fetchEventRatings(eventId).catch(() => null);
      if (refreshed) setRatings(refreshed.data?.ratings ?? []);
      onRated?.();
    } catch (err) {
      // Every rule the server enforces arrives here as a plain sentence —
      // "You were marked as a no-show for this event, so you can't rate it."
      // Showing it verbatim beats inventing a vaguer one.
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const shown = hovered || rating;

  return (
    <section className="panel host-rating">
      <h2>How was it?</h2>
      <p className="host-rating__intro">
        Rate {hostName ? hostName : "the host"} so the next person knows what to
        expect. You can change this later.
      </p>

      <form className="host-rating__form" onSubmit={handleSubmit}>
        <fieldset className="host-rating__stars">
          <legend className="host-rating__legend">Your rating</legend>
          {STARS.map((n) => (
            <button
              key={n}
              type="button"
              className={`host-rating__star ${n <= shown ? "is-on" : ""}`}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(0)}
              onFocus={() => setHovered(n)}
              onBlur={() => setHovered(0)}
              aria-pressed={n === rating}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
            >
              ★
            </button>
          ))}
          <span className="host-rating__value" aria-live="polite">
            {shown ? `${shown} of 5` : "Not rated"}
          </span>
        </fieldset>

        <label className="host-rating__comment">
          Comment <small>optional</small>
          <textarea
            rows={3}
            value={comment}
            maxLength={500}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Was it well organised? Would you go again?"
          />
        </label>

        {error ? <p className="status status--error">{error}</p> : null}
        {message ? <p className="status host-rating__ok">{message}</p> : null}

        <button type="submit" className="host-rating__submit" disabled={saving}>
          {saving ? "Saving..." : mine ? "Update rating" : "Submit rating"}
        </button>
      </form>

      {ratings?.length ? (
        <ul className="host-rating__list">
          {ratings.map((r) => (
            <li key={r.id}>
              <div className="host-rating__list-head">
                <span className="host-rating__list-stars" aria-label={`${r.rating} of 5`}>
                  {"★".repeat(r.rating)}
                  <span className="host-rating__list-dim">{"★".repeat(5 - r.rating)}</span>
                </span>
                {/* Attributed, not anonymous. A rating you have to put your
                    name to is worth more than one you don't — same principle
                    the reliability score runs on. */}
                {r.rater ? (
                  <span className="host-rating__list-rater">
                    {r.rater.displayName}{" "}
                    <span className="host-rating__list-handle">@{r.rater.handle}</span>
                  </span>
                ) : null}
              </div>
              {r.comment ? <p className="host-rating__list-comment">{r.comment}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
