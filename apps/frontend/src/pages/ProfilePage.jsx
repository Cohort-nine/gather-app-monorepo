import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { changeEmail, changePassword, uploadAvatar } from "../api/auth.js";
import { resolveMediaUrl } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import "./ProfilePage.css";

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

function validateImageFile(file) {
  if (!IMAGE_MIME_TYPES.includes(file.type)) {
    return "Avatar must be a JPEG, PNG, or WebP image.";
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return "Avatar must be under 5MB.";
  }
  return null;
}

export default function ProfilePage() {
  const { user, loading, updateUser } = useAuth();

  const [avatarError, setAvatarError] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordStatus, setPasswordStatus] = useState({ saving: false, error: "", notice: "" });

  const [emailForm, setEmailForm] = useState({ currentPassword: "", newEmail: "" });
  const [emailStatus, setEmailStatus] = useState({ saving: false, error: "", notice: "" });

  if (loading) {
    return (
      <main className="page">
        <p className="status">Checking your session...</p>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  async function handleAvatarChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const validationError = validateImageFile(file);
    if (validationError) {
      setAvatarError(validationError);
      return;
    }

    setAvatarError("");
    setAvatarUploading(true);
    try {
      const res = await uploadAvatar(file);
      updateUser({ avatarUrl: res.data.avatarUrl });
    } catch (err) {
      setAvatarError(err.message);
    } finally {
      setAvatarUploading(false);
    }
  }

  function handlePasswordFieldChange(event) {
    const { name, value } = event.target;
    setPasswordForm((current) => ({ ...current, [name]: value }));
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setPasswordStatus({ saving: false, error: "", notice: "" });

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordStatus({ saving: false, error: "New passwords don't match.", notice: "" });
      return;
    }
    if (passwordForm.newPassword.length < 10) {
      setPasswordStatus({ saving: false, error: "New password must be at least 10 characters.", notice: "" });
      return;
    }
    if (/^\d+$/.test(passwordForm.newPassword)) {
      setPasswordStatus({ saving: false, error: "New password can't be all numbers.", notice: "" });
      return;
    }

    setPasswordStatus({ saving: true, error: "", notice: "" });
    try {
      await changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordStatus({ saving: false, error: "", notice: "Password updated." });
    } catch (err) {
      setPasswordStatus({ saving: false, error: err.message, notice: "" });
    }
  }

  function handleEmailFieldChange(event) {
    const { name, value } = event.target;
    setEmailForm((current) => ({ ...current, [name]: value }));
  }

  async function handleEmailSubmit(event) {
    event.preventDefault();
    setEmailStatus({ saving: true, error: "", notice: "" });
    try {
      const res = await changeEmail(emailForm);
      updateUser({ email: res.data.email });
      setEmailForm({ currentPassword: "", newEmail: "" });
      setEmailStatus({ saving: false, error: "", notice: "Login email updated." });
    } catch (err) {
      setEmailStatus({ saving: false, error: err.message, notice: "" });
    }
  }

  return (
    <main className="page">
      <section className="panel page-header">
        <p className="eyebrow">Gather</p>
        <h1>Your profile</h1>

        <div className="profile__avatar-row">
          {user.avatarUrl ? (
            <img className="profile__avatar" src={resolveMediaUrl(user.avatarUrl)} alt="" />
          ) : (
            <span className="profile__avatar profile__avatar--placeholder">
              {user.displayName?.[0]?.toUpperCase() ?? "?"}
            </span>
          )}

          <div>
            <p className="profile__handle">@{user.handle}</p>
            <label className="profile__avatar-button">
              {avatarUploading ? "Uploading..." : user.avatarUrl ? "Replace photo" : "Add a photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarChange}
                disabled={avatarUploading}
                className="profile__avatar-input"
              />
            </label>
            <small>JPEG, PNG, or WebP, up to 5MB.</small>
            {avatarError ? <p className="status status--error">{avatarError}</p> : null}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Change password</h2>
        <form className="form" onSubmit={handlePasswordSubmit}>
          <label>
            Current password
            <input
              type="password"
              name="currentPassword"
              value={passwordForm.currentPassword}
              onChange={handlePasswordFieldChange}
              required
            />
          </label>
          <label>
            New password
            <input
              type="password"
              name="newPassword"
              value={passwordForm.newPassword}
              onChange={handlePasswordFieldChange}
              minLength={10}
              required
            />
            <small>At least 10 characters, and not just numbers.</small>
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              name="confirmPassword"
              value={passwordForm.confirmPassword}
              onChange={handlePasswordFieldChange}
              minLength={8}
              required
            />
          </label>

          {passwordStatus.error ? <p className="status status--error">{passwordStatus.error}</p> : null}
          {passwordStatus.notice ? <p className="status">{passwordStatus.notice}</p> : null}

          <button type="submit" disabled={passwordStatus.saving}>
            {passwordStatus.saving ? "Saving..." : "Update password"}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Change login email</h2>
        <p className="event-form__intro">Currently {user.email}.</p>
        <form className="form" onSubmit={handleEmailSubmit}>
          <label>
            Current password
            <input
              type="password"
              name="currentPassword"
              value={emailForm.currentPassword}
              onChange={handleEmailFieldChange}
              required
            />
          </label>
          <label>
            New email
            <input
              type="email"
              name="newEmail"
              value={emailForm.newEmail}
              onChange={handleEmailFieldChange}
              required
            />
          </label>

          {emailStatus.error ? <p className="status status--error">{emailStatus.error}</p> : null}
          {emailStatus.notice ? <p className="status">{emailStatus.notice}</p> : null}

          <button type="submit" disabled={emailStatus.saving}>
            {emailStatus.saving ? "Saving..." : "Update email"}
          </button>
        </form>
      </section>

      <p className="status">
        Looking for people you know? <Link to="/connections">Manage connections</Link>
      </p>
    </main>
  );
}
