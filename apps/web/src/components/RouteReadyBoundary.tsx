import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { getPendingPageLoadRequests, subscribePageLoadActivity } from "../lib/api";

const REQUEST_QUIET_WINDOW_MS = 90;
const MAXIMUM_WAIT_MS = 12_000;

export const RouteReadyBoundary = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let quietTimer: number | undefined;
    let finished = false;

    const reveal = () => {
      if (finished) return;
      finished = true;
      setReady(true);
    };

    const evaluate = (pendingRequests: number) => {
      window.clearTimeout(quietTimer);
      if (pendingRequests === 0) {
        quietTimer = window.setTimeout(() => {
          if (getPendingPageLoadRequests() === 0) reveal();
        }, REQUEST_QUIET_WINDOW_MS);
      }
    };

    const unsubscribe = subscribePageLoadActivity(evaluate);
    const maximumWaitTimer = window.setTimeout(reveal, MAXIMUM_WAIT_MS);

    // Effects inside the route may enqueue their first requests in this turn.
    // Checking in a microtask ensures those requests are included in the gate.
    queueMicrotask(() => evaluate(getPendingPageLoadRequests()));

    return () => {
      finished = true;
      unsubscribe();
      window.clearTimeout(quietTimer);
      window.clearTimeout(maximumWaitTimer);
    };
  }, []);

  return (
    <div className="route-ready-stage">
      <div className={`route-ready-content${ready ? " is-ready" : ""}`} aria-hidden={!ready}>
        <Outlet />
      </div>
      {!ready ? (
        <div className="route-wait-indicator" role="status" aria-live="polite">
          <span aria-hidden="true" />
          <small>Carregando página…</small>
        </div>
      ) : null}
    </div>
  );
};
