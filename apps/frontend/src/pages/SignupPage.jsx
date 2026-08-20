import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const emptyForm = { handle: "", email: "", password: "", displayName: "" };

export default function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await signup(form);
      navigate("/events");
    } catch (err) {
      setError([err.message, ...(err.errors ?? [])].filter(Boolean).join(" "));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <p className="eyebrow">Gather</p>
        <h1>Create an account</h1>

        <form className="form" onSubmit={handleSubmit}>
          <label>
            Handle
            <input
              name="handle"
              value={form.handle}
              onChange={handleChange}
              placeholder="lowercase_letters_numbers"
              pattern="[a-z0-9_]{3,30}"
              minLength={3}
              maxLength={30}
              required
            />
            <small>3–30 characters: lowercase letters, numbers, and underscores only.</small>
          </label>

          <label>
            Display name
            <input name="displayName" value={form.displayName} onChange={handleChange} required />
          </label>

          <label>
            Email
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              minLength={10}
              required
            />
            <small>At least 10 characters, and not just numbers.</small>
          </label>

          {error ? <p className="status status--error">{error}</p> : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="status">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
