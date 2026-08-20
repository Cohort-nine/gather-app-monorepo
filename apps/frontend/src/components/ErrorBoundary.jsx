import { Component } from "react";

// ---------------------------------------------------------------------------
// The last line of defence.
//
// React unmounts the entire tree when a render throws, so a single bad
// assumption in one component takes down the nav, the page, everything — and
// what the user sees is a black rectangle with no explanation. That happened:
// a cold-start response with no `data` made `events.map()` throw and the whole
// app vanished.
//
// This can't be a hook. componentDidCatch has no hook equivalent, so a class
// component is the only way to do it in React.
// ---------------------------------------------------------------------------

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept so the stack is still discoverable in the console after the UI has
    // already swapped itself out for the friendly message below.
    console.error("[gather] render error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="page">
        <section className="panel">
          <p className="eyebrow">Something broke</p>
          <h1>This page didn't load</h1>
          <p className="status">
            {error.isWaking
              ? error.message
              : "Sorry — something went wrong on our end. Reloading usually fixes it."}
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </section>
      </main>
    );
  }
}
