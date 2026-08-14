import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  createEvent,
  deleteEvent,
  fetchCategories,
  fetchEvent,
  updateEvent
} from "../api/events.js";
import { useAuth } from "../context/AuthContext.jsx";
import "./EventFormPage.css";

// ---------------------------------------------------------------------------
// One component serves both /events/new and /events/:id/edit.
//
// They're the same form with the same rules — splitting them would mean keeping
// two field lists in sync, and they'd drift the first time someone adds a field
// to one and not the other.
//
// Validation is duplicated from the backend on purpose. server/lib/validateEvent.js
// stays the authority (anyone can POST with curl), but repeating the rules here
// means a typo is caught before a round trip instead of after one.
// ---------------------------------------------------------------------------

/**
 * <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in LOCAL time, but the
 * API speaks ISO/UTC. Converting through the timezone offset keeps a 7pm event
 * showing as 7pm rather than jumping by the offset on load.
 */
function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

const toIso = (value) => (value ? new Date(value).toISOString() : undefined);

const EMPTY = {
  title: "",
  description: "",
  categoryId: "",
  startsAt: "",
  endsAt: "",
  rsvpClosesAt: "",
  capacity: "",
  isOnline: false,
  onlineUrl: "",
  placeName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  hideExactAddressUntilRsvp: true,
  visibility: "public",
  allowWaitlist: true,
  allowGuests: false,
  maxGuestsPerRsvp: 0,
  tags: ""
};

/** Mirrors the rules in server/lib/validateEvent.js. */
function validate(form) {
  const errors = [];

  if (form.title.trim().length < 3) {
    errors.push("Title must be at least 3 characters");
  }
  if (!form.startsAt) {
    errors.push("Start date and time is required");
  }
  if (form.endsAt && form.startsAt && new Date(form.endsAt) <= new Date(form.startsAt)) {
    errors.push("End time must be after the start time");
  }
  if (form.rsvpClosesAt && form.startsAt && new Date(form.rsvpClosesAt) > new Date(form.startsAt)) {
    errors.push("RSVPs can't close after the event starts");
  }
  if (form.capacity !== "" && (!Number.isInteger(Number(form.capacity)) || Number(form.capacity) < 1)) {
    errors.push("Capacity must be a whole number of 1 or more");
  }
  if (form.isOnline && !form.onlineUrl.trim()) {
    errors.push("Online events need a link");
  }
  if (form.onlineUrl.trim()) {
    try {
      new URL(form.onlineUrl);
    } catch {
      errors.push("The online link must be a full URL, starting with https://");
    }
  }
  if (form.allowGuests) {
    const max = Number(form.maxGuestsPerRsvp);
    if (!Number.isInteger(max) || max < 1 || max > 20) {
      errors.push("Guests per RSVP must be between 1 and 20");
    }
  }

  return errors;
}

/** Only send what the host actually filled in. */
function buildPayload(form, status) {
  const payload = {
    title: form.title.trim(),
    description: form.description.trim() || null,
    startsAt: toIso(form.startsAt),
    endsAt: toIso(form.endsAt),
    rsvpClosesAt: toIso(form.rsvpClosesAt),
    isOnline: form.isOnline,
    visibility: form.visibility,
    allowWaitlist: form.allowWaitlist,
    allowGuests: form.allowGuests,
    // The browser reports the host's zone, which is the right default for a
    // gathering — the person creating it is almost always local to it.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
  };

  if (status) payload.status = status;
  if (form.categoryId) payload.categoryId = Number(form.categoryId);
  if (form.capacity !== "") payload.capacity = Number(form.capacity);
  if (form.allowGuests) payload.maxGuestsPerRsvp = Number(form.maxGuestsPerRsvp);

  if (form.isOnline) {
    payload.onlineUrl = form.onlineUrl.trim();
  } else {
    payload.placeName = form.placeName.trim() || null;
    payload.addressLine1 = form.addressLine1.trim() || null;
    payload.addressLine2 = form.addressLine2.trim() || null;
    payload.city = form.city.trim() || null;
    payload.region = form.region.trim() || null;
    payload.postalCode = form.postalCode.trim() || null;
    payload.hideExactAddressUntilRsvp = form.hideExactAddressUntilRsvp;
  }

  return payload;
}

export default function EventFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [form, setForm] = useState(EMPTY);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [notice, setNotice] = useState("");
  const [existingStatus, setExistingStatus] = useState(null);

  useEffect(() => {
    fetchCategories()
      .then((res) => setCategories(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isEdit) return;

    setLoading(true);
    fetchEvent(id)
      .then((res) => {
        const event = res.data;
        setExistingStatus(event.status);
        setForm({
          title: event.title ?? "",
          description: event.description ?? "",
          categoryId: event.category?.id ? String(event.category.id) : "",
          startsAt: toDateTimeLocal(event.startsAt),
          endsAt: toDateTimeLocal(event.endsAt),
          rsvpClosesAt: toDateTimeLocal(event.rsvpClosesAt),
          capacity: event.capacity ?? "",
          isOnline: Boolean(event.isOnline),
          onlineUrl: event.onlineUrl ?? "",
          placeName: event.placeName ?? "",
          addressLine1: event.addressLine1 ?? "",
          addressLine2: event.addressLine2 ?? "",
          city: event.city ?? "",
          region: event.region ?? "",
          postalCode: event.postalCode ?? "",
          hideExactAddressUntilRsvp: event.hideExactAddressUntilRsvp ?? true,
          visibility: event.visibility ?? "public",
          allowWaitlist: event.allowWaitlist ?? true,
          allowGuests: Boolean(event.allowGuests),
          maxGuestsPerRsvp: event.maxGuestsPerRsvp ?? 0,
          tags: Array.isArray(event.tags) ? event.tags.join(", ") : ""
        });
      })
      .catch((err) => setErrors([err.message]))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  function handleChange(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  async function submit(status) {
    setErrors([]);
    setNotice("");

    const clientErrors = validate(form);
    if (clientErrors.length) {
      setErrors(clientErrors);
      // Send them to the message rather than leaving it below the fold.
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload(form, status);
      const res = isEdit ? await updateEvent(id, payload) : await createEvent(payload);
      navigate(`/my-events?saved=${encodeURIComponent(res.data.title)}`);
    } catch (err) {
      // The API returns { message, errors? } — show the field-level list when
      // there is one, since "Validation failed" alone tells the host nothing.
      setErrors(err.errors?.length ? err.errors : [err.message]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    // Destructive and irreversible, so it asks first.
    const confirmed = window.confirm(
      `Delete "${form.title}"? This can't be undone, and anyone who RSVP'd will lose their spot.`
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteEvent(id);
      navigate("/my-events?deleted=1");
    } catch (err) {
      setErrors([err.message]);
      setDeleting(false);
    }
  }

  if (authLoading) {
    return (
      <main className="page">
        <p className="status">Checking your session...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="page">
        <section className="panel">
          <h1>Sign in to host</h1>
          <p className="status">You need an account to create an event.</p>
          <Link to="/login">Sign in</Link>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="page">
        <p className="status">Loading event...</p>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="panel">
        <p className="eyebrow">Gather</p>
        <h1>{isEdit ? "Edit event" : "Host a gathering"}</h1>
        <p className="event-form__intro">
          {isEdit
            ? "Changes go live as soon as you save."
            : "Save it as a draft while you figure out the details, or publish it now."}
        </p>

        {errors.length > 0 ? (
          <div className="status status--error" role="alert">
            <strong>{errors.length === 1 ? "Couldn't save this" : "Couldn't save this:"}</strong>
            <ul className="event-form__errors">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {notice ? <p className="status">{notice}</p> : null}

        <form className="form event-form" onSubmit={(e) => e.preventDefault()}>
          <h2>The basics</h2>

          <label>
            Title <span className="event-form__required">required</span>
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="Third Thursday Potluck"
              minLength={3}
              required
            />
          </label>

          <label>
            Description
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows="4"
              placeholder="What should people expect? Anything they should bring?"
            />
          </label>

          <label>
            Category
            <select name="categoryId" value={form.categoryId} onChange={handleChange}>
              <option value="">No category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <h2>When</h2>

          <div className="event-form__row">
            <label>
              Starts <span className="event-form__required">required</span>
              <input
                type="datetime-local"
                name="startsAt"
                value={form.startsAt}
                onChange={handleChange}
                required
              />
            </label>

            <label>
              Ends
              <input
                type="datetime-local"
                name="endsAt"
                value={form.endsAt}
                onChange={handleChange}
              />
            </label>
          </div>

          <label>
            RSVPs close
            <input
              type="datetime-local"
              name="rsvpClosesAt"
              value={form.rsvpClosesAt}
              onChange={handleChange}
            />
            <small>Leave blank to accept RSVPs right up to the start.</small>
          </label>

          <h2>Where</h2>

          <label className="event-form__check">
            <input
              type="checkbox"
              name="isOnline"
              checked={form.isOnline}
              onChange={handleChange}
            />
            This is an online event
          </label>

          {form.isOnline ? (
            <label>
              Link <span className="event-form__required">required</span>
              <input
                name="onlineUrl"
                value={form.onlineUrl}
                onChange={handleChange}
                placeholder="https://meet.example.com/potluck"
              />
            </label>
          ) : (
            <>
              <label>
                Place name
                <input
                  name="placeName"
                  value={form.placeName}
                  onChange={handleChange}
                  placeholder="Maya's place"
                />
              </label>

              <label>
                Street address
                <input name="addressLine1" value={form.addressLine1} onChange={handleChange} />
              </label>

              <label>
                Apartment, suite, etc.
                <input name="addressLine2" value={form.addressLine2} onChange={handleChange} />
              </label>

              <div className="event-form__row">
                <label>
                  City
                  <input name="city" value={form.city} onChange={handleChange} />
                </label>

                <label>
                  State / region
                  <input name="region" value={form.region} onChange={handleChange} />
                </label>

                <label>
                  Postal code
                  <input name="postalCode" value={form.postalCode} onChange={handleChange} />
                </label>
              </div>

              <label className="event-form__check">
                <input
                  type="checkbox"
                  name="hideExactAddressUntilRsvp"
                  checked={form.hideExactAddressUntilRsvp}
                  onChange={handleChange}
                />
                Hide the exact address until someone RSVPs
              </label>
              <small className="event-form__hint">
                Recommended for anything at your home. Browsers see the city; only confirmed
                guests see the street.
              </small>
            </>
          )}

          <h2>Who can come</h2>

          <label>
            Visibility
            <select name="visibility" value={form.visibility} onChange={handleChange}>
              <option value="public">Public — anyone can find it</option>
              <option value="unlisted">Unlisted — only people with the link</option>
              <option value="invite_only">Invite only</option>
            </select>
          </label>

          <label>
            Capacity
            <input
              type="number"
              name="capacity"
              value={form.capacity}
              onChange={handleChange}
              min="1"
              placeholder="Leave blank for unlimited"
            />
          </label>

          <label className="event-form__check">
            <input
              type="checkbox"
              name="allowWaitlist"
              checked={form.allowWaitlist}
              onChange={handleChange}
            />
            Start a waitlist once it's full
          </label>

          <label className="event-form__check">
            <input
              type="checkbox"
              name="allowGuests"
              checked={form.allowGuests}
              onChange={handleChange}
            />
            Let people bring guests
          </label>

          {form.allowGuests ? (
            <label>
              Guests per person
              <input
                type="number"
                name="maxGuestsPerRsvp"
                value={form.maxGuestsPerRsvp}
                onChange={handleChange}
                min="1"
                max="20"
              />
            </label>
          ) : null}

          <label>
            Tags
            <input
              name="tags"
              value={form.tags}
              onChange={handleChange}
              placeholder="potluck, vegetarian-friendly"
            />
            <small>Separate with commas.</small>
          </label>

          <div className="event-form__actions">
            {isEdit ? (
              <>
                <button type="button" onClick={() => submit()} disabled={saving || deleting}>
                  {saving ? "Saving..." : "Save changes"}
                </button>

                {existingStatus === "draft" ? (
                  <button
                    type="button"
                    onClick={() => submit("published")}
                    disabled={saving || deleting}
                  >
                    Publish
                  </button>
                ) : null}

                <button
                  type="button"
                  className="event-form__danger"
                  onClick={handleDelete}
                  disabled={saving || deleting}
                >
                  {deleting ? "Deleting..." : "Delete event"}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => submit("published")} disabled={saving}>
                  {saving ? "Saving..." : "Publish event"}
                </button>

                <button
                  type="button"
                  className="event-form__secondary"
                  onClick={() => submit("draft")}
                  disabled={saving}
                >
                  Save as draft
                </button>
              </>
            )}

            <Link to="/my-events" className="event-form__cancel">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
