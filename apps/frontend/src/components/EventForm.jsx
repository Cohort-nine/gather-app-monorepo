import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { createEvent, updateEvent, fetchCategories } from "../api/events.js";

const VISIBILITY = ["public", "unlisted", "invite_only"];
const STATUS = ["draft", "published", "cancelled", "completed"];

const emptyForm = {
  title: "",
  description: "",
  categoryId: "",
  visibility: "public",
  status: "draft",
  startsAt: "",
  endsAt: "",
  rsvpClosesAt: "",
  timezone: "",
  isOnline: false,
  onlineUrl: "",
  placeName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  countryCode: "",
  capacity: "",
  maxGuestsPerRsvp: "",
  allowWaitlist: false,
  waitlistReliabilityFloor: "",
  allowGuests: true,
  hideExactAddressUntilRsvp: false,
};

/**
 * Client-side mirror of apps/backend/server/lib/validateEvent.js so people
 * get instant feedback instead of a round trip. The backend re-checks
 * everything regardless, so this only ever needs to be "close enough" — it
 * is not the source of truth.
 */
function validate(form) {
  const errors = [];

  if (!form.title.trim()) errors.push("title is required");
  else if (form.title.trim().length < 3) errors.push("title must be at least 3 characters");

  if (!form.startsAt) errors.push("startsAt is required");

  const startsAt = form.startsAt ? new Date(form.startsAt) : null;
  const endsAt = form.endsAt ? new Date(form.endsAt) : null;
  if (form.endsAt && Number.isNaN(endsAt?.getTime())) errors.push("endsAt must be a valid date");
  if (startsAt && endsAt && endsAt <= startsAt) errors.push("endsAt must be after startsAt");

  if (form.rsvpClosesAt) {
    const closes = new Date(form.rsvpClosesAt);
    if (Number.isNaN(closes.getTime())) errors.push("rsvpClosesAt must be a valid date");
    else if (startsAt && closes > startsAt) errors.push("rsvpClosesAt cannot be after startsAt");
  }

  if (form.capacity !== "") {
    const capacity = Number(form.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      errors.push("capacity must be a positive whole number");
    }
  }

  if (form.isOnline && !form.onlineUrl.trim()) {
    errors.push("onlineUrl is required when isOnline is true");
  }
  if (form.onlineUrl) {
    try {
      new URL(form.onlineUrl);
    } catch {
      errors.push("onlineUrl must be a valid URL");
    }
  }

  if (form.categoryId !== "") {
    const categoryId = Number(form.categoryId);
    if (!Number.isInteger(categoryId) || categoryId < 1) {
      errors.push("categoryId must be a positive whole number");
    }
  }

  if (form.maxGuestsPerRsvp !== "") {
    const max = Number(form.maxGuestsPerRsvp);
    if (!Number.isInteger(max) || max < 0 || max > 20) {
      errors.push("maxGuestsPerRsvp must be between 0 and 20");
    }
  }

  if (form.allowWaitlist && form.waitlistReliabilityFloor !== "") {
    const floor = Number(form.waitlistReliabilityFloor);
    if (Number.isNaN(floor) || floor < 0 || floor > 1) {
      errors.push("waitlistReliabilityFloor must be between 0 and 1");
    }
  }

  if (form.countryCode && form.countryCode.length !== 2) {
    errors.push("countryCode must be a 2-letter ISO code");
  }

  return errors;
}

/** Strip the form's string state down to a real payload matching the API shape. */
function toPayload(form, hostId) {
  const payload = {
    title: form.title.trim(),
    hostId,
    startsAt: new Date(form.startsAt).toISOString(),
    visibility: form.visibility,
    status: form.status,
    isOnline: form.isOnline,
    allowWaitlist: form.allowWaitlist,
    allowGuests: form.allowGuests,
    hideExactAddressUntilRsvp: form.hideExactAddressUntilRsvp,
  };

  if (form.description) payload.description = form.description;
  if (form.endsAt) payload.endsAt = new Date(form.endsAt).toISOString();
  if (form.rsvpClosesAt) payload.rsvpClosesAt = new Date(form.rsvpClosesAt).toISOString();
  if (form.timezone) payload.timezone = form.timezone;
  if (form.categoryId !== "") payload.categoryId = Number(form.categoryId);
  if (form.capacity !== "") payload.capacity = Number(form.capacity);
  if (form.maxGuestsPerRsvp !== "") payload.maxGuestsPerRsvp = Number(form.maxGuestsPerRsvp);
  if (form.allowWaitlist && form.waitlistReliabilityFloor !== "") {
    payload.waitlistReliabilityFloor = Number(form.waitlistReliabilityFloor);
  }

  if (form.isOnline) {
    payload.onlineUrl = form.onlineUrl.trim();
  } else {
    if (form.placeName) payload.placeName = form.placeName;
    if (form.addressLine1) payload.addressLine1 = form.addressLine1;
    if (form.addressLine2) payload.addressLine2 = form.addressLine2;
    if (form.city) payload.city = form.city;
    if (form.region) payload.region = form.region;
    if (form.postalCode) payload.postalCode = form.postalCode;
    if (form.countryCode) payload.countryCode = form.countryCode.toUpperCase();
  }

  return payload;
}

/**
 * Create or edit an event.
 * Pass `event` (with an `id`) to switch into edit mode — otherwise creates.
 */
export default function EventForm({ event, onSaved }) {
  const { user } = useAuth();
  const isEdit = Boolean(event?.id);

  const [form, setForm] = useState(() =>
    isEdit ? { ...emptyForm, ...event } : emptyForm
  );
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    fetchCategories()
      .then((res) => setCategories(res.data ?? []))
      .catch(() => setCategories([]));
  }, []);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);

    const clientErrors = validate(form);
    if (clientErrors.length) {
      setErrors(clientErrors);
      return;
    }

    setSubmitting(true);
    try {
      const payload = toPayload(form, user.id);
      const res = isEdit
        ? await updateEvent(event.id, payload)
        : await createEvent(payload);
      onSaved?.(res.data);
      if (!isEdit) setForm(emptyForm);
    } catch (err) {
      setErrors(err.errors?.length ? err.errors : [err.message]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="event-form" onSubmit={handleSubmit}>
      {errors.length > 0 && (
        <ul className="event-form-errors">
          {errors.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      )}

      <fieldset>
        <legend>Basics</legend>

        <label>
          Title
          <input
            type="text"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            required
          />
        </label>

        <label>
          Description
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            rows={4}
          />
        </label>

        <label>
          Category
          <select
            value={form.categoryId}
            onChange={(e) => update("categoryId", e.target.value)}
          >
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label>
          Visibility
          <select
            value={form.visibility}
            onChange={(e) => update("visibility", e.target.value)}
          >
            {VISIBILITY.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>

        <label>
          Status
          <select
            value={form.status}
            onChange={(e) => update("status", e.target.value)}
          >
            {STATUS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Timing</legend>

        <label>
          Starts at
          <input
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => update("startsAt", e.target.value)}
            required
          />
        </label>

        <label>
          Ends at
          <input
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => update("endsAt", e.target.value)}
          />
        </label>

        <label>
          RSVP closes at
          <input
            type="datetime-local"
            value={form.rsvpClosesAt}
            onChange={(e) => update("rsvpClosesAt", e.target.value)}
          />
        </label>

        <label>
          Timezone
          <input
            type="text"
            placeholder="America/New_York"
            value={form.timezone}
            onChange={(e) => update("timezone", e.target.value)}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Location</legend>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.isOnline}
            onChange={(e) => update("isOnline", e.target.checked)}
          />
          This is an online event
        </label>

        {form.isOnline ? (
          <label>
            Online URL
            <input
              type="url"
              value={form.onlineUrl}
              onChange={(e) => update("onlineUrl", e.target.value)}
              placeholder="https://..."
              required
            />
          </label>
        ) : (
          <>
            <label>
              Place name
              <input
                type="text"
                value={form.placeName}
                onChange={(e) => update("placeName", e.target.value)}
              />
            </label>
            <label>
              Address line 1
              <input
                type="text"
                value={form.addressLine1}
                onChange={(e) => update("addressLine1", e.target.value)}
              />
            </label>
            <label>
              Address line 2
              <input
                type="text"
                value={form.addressLine2}
                onChange={(e) => update("addressLine2", e.target.value)}
              />
            </label>
            <label>
              City
              <input
                type="text"
                value={form.city}
                onChange={(e) => update("city", e.target.value)}
              />
            </label>
            <label>
              Region / State
              <input
                type="text"
                value={form.region}
                onChange={(e) => update("region", e.target.value)}
              />
            </label>
            <label>
              Postal code
              <input
                type="text"
                value={form.postalCode}
                onChange={(e) => update("postalCode", e.target.value)}
              />
            </label>
            <label>
              Country code
              <input
                type="text"
                maxLength={2}
                placeholder="US"
                value={form.countryCode}
                onChange={(e) => update("countryCode", e.target.value.toUpperCase())}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.hideExactAddressUntilRsvp}
                onChange={(e) => update("hideExactAddressUntilRsvp", e.target.checked)}
              />
              Hide exact address until someone RSVPs
            </label>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Capacity &amp; RSVPs</legend>

        <label>
          Capacity
          <input
            type="number"
            min="1"
            value={form.capacity}
            onChange={(e) => update("capacity", e.target.value)}
          />
        </label>

        <label>
          Max guests per RSVP
          <input
            type="number"
            min="0"
            max="20"
            value={form.maxGuestsPerRsvp}
            onChange={(e) => update("maxGuestsPerRsvp", e.target.value)}
          />
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.allowGuests}
            onChange={(e) => update("allowGuests", e.target.checked)}
          />
          Allow guests
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.allowWaitlist}
            onChange={(e) => update("allowWaitlist", e.target.checked)}
          />
          Allow waitlist when full
        </label>

        {form.allowWaitlist && (
          <label>
            Waitlist reliability floor (0–1)
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={form.waitlistReliabilityFloor}
              onChange={(e) => update("waitlistReliabilityFloor", e.target.value)}
            />
          </label>
        )}
      </fieldset>

      <button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : isEdit ? "Save changes" : "Create event"}
      </button>
    </form>
  );
}
