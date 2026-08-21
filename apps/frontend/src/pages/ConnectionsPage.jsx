import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  acceptConnection,
  declineConnection,
  fetchConnections,
  removeConnection,
  searchUsers,
  sendConnectionRequest
} from "../api/connections.js";
import { resolveMediaUrl } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import "./ConnectionsPage.css";

function PersonRow({ person, children }) {
  return (
    <li className="connections__row">
      {person.avatarUrl ? (
        <img className="connections__avatar" src={resolveMediaUrl(person.avatarUrl)} alt="" />
      ) : (
        <span className="connections__avatar connections__avatar--placeholder">
          {person.displayName?.[0]?.toUpperCase() ?? "?"}
        </span>
      )}
      <div className="connections__row-info">
        <p className="connections__name">{person.displayName}</p>
        <p className="connections__handle">@{person.handle}</p>
      </div>
      <div className="connections__row-actions">{children}</div>
    </li>
  );
}

export default function ConnectionsPage() {
  const { user, loading: authLoading } = useAuth();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [pendingActions, setPendingActions] = useState({});

  const [connections, setConnections] = useState(null);
  const [connectionsError, setConnectionsError] = useState("");

  function loadConnections() {
    fetchConnections()
      .then((res) => setConnections(res.data ?? []))
      .catch((err) => setConnectionsError(err.message));
  }

  useEffect(() => {
    if (user) loadConnections();
  }, [user]);

  if (authLoading) {
    return (
      <main className="page">
        <p className="status">Checking your session...</p>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  async function handleSearch(event) {
    event.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    setSearchError("");
    try {
      const res = await searchUsers(query.trim());
      setResults(res.data ?? []);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function withPendingAction(personId, action) {
    setPendingActions((current) => ({ ...current, [personId]: true }));
    try {
      await action();
      loadConnections();
      setResults((current) => current.filter((person) => person.id !== personId));
    } catch (err) {
      setConnectionsError(err.message);
    } finally {
      setPendingActions((current) => ({ ...current, [personId]: false }));
    }
  }

  const incoming = connections?.filter((c) => c.status === "pending" && c.direction === "incoming") ?? [];
  const outgoing = connections?.filter((c) => c.status === "pending" && c.direction === "outgoing") ?? [];
  const accepted = connections?.filter((c) => c.status === "accepted") ?? [];
  const connectedIds = new Set(connections?.map((c) => c.peer.id));

  return (
    <main className="page">
      <section className="panel page-header">
        <p className="eyebrow">Gather</p>
        <h1>Connections</h1>
        <p className="event-form__intro">
          Connect with people you know so you can see who's going before you RSVP.
        </p>

        <form className="connections__search" onSubmit={handleSearch}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by handle"
          />
          <button type="submit" disabled={searching}>
            {searching ? "Searching..." : "Search"}
          </button>
        </form>

        {searchError ? <p className="status status--error">{searchError}</p> : null}

        {results.length > 0 ? (
          <ul className="connections__list">
            {results.map((person) => (
              <PersonRow key={person.id} person={person}>
                {connectedIds.has(person.id) ? (
                  <span className="status">Already connected</span>
                ) : (
                  <button
                    type="button"
                    disabled={pendingActions[person.id]}
                    onClick={() => withPendingAction(person.id, () => sendConnectionRequest(person.id))}
                  >
                    Add
                  </button>
                )}
              </PersonRow>
            ))}
          </ul>
        ) : null}
      </section>

      {connectionsError ? (
        <p className="status status--error">{connectionsError}</p>
      ) : connections === null ? (
        <p className="status">Loading your connections...</p>
      ) : (
        <>
          {incoming.length > 0 ? (
            <section className="panel">
              <h2>Requests</h2>
              <ul className="connections__list">
                {incoming.map(({ peer: person }) => (
                  <PersonRow key={person.id} person={person}>
                    <button
                      type="button"
                      disabled={pendingActions[person.id]}
                      onClick={() => withPendingAction(person.id, () => acceptConnection(person.id))}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="connections__decline"
                      disabled={pendingActions[person.id]}
                      onClick={() => withPendingAction(person.id, () => declineConnection(person.id))}
                    >
                      Decline
                    </button>
                  </PersonRow>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="panel">
            <h2>Your connections</h2>
            {accepted.length === 0 ? (
              <p className="status">
                No connections yet — search for people you know above to get started.
              </p>
            ) : (
              <ul className="connections__list">
                {accepted.map(({ peer: person }) => (
                  <PersonRow key={person.id} person={person}>
                    <button
                      type="button"
                      className="connections__decline"
                      disabled={pendingActions[person.id]}
                      onClick={() => withPendingAction(person.id, () => removeConnection(person.id))}
                    >
                      Remove
                    </button>
                  </PersonRow>
                ))}
              </ul>
            )}
          </section>

          {outgoing.length > 0 ? (
            <section className="panel">
              <h2>Pending</h2>
              <ul className="connections__list">
                {outgoing.map(({ peer: person }) => (
                  <PersonRow key={person.id} person={person}>
                    <span className="status">Waiting on them</span>
                    <button
                      type="button"
                      className="connections__decline"
                      disabled={pendingActions[person.id]}
                      onClick={() => withPendingAction(person.id, () => removeConnection(person.id))}
                    >
                      Cancel
                    </button>
                  </PersonRow>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
