const CHANNEL = "fleetpulse-session";
// A channel also delivers to other listeners in the same tab, which must not react to themselves.
const TAB_ID = Math.random().toString(36).slice(2);

/** Tells this browser's other tabs that the signed-in user or organisation has changed. */
function announce() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(TAB_ID);
  channel.close();
}

/** Calls `onChange` when another tab signs out or changes organisation. */
export function subscribeToSessionChanges(onChange: () => void) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<string>) => {
    if (event.data !== TAB_ID) onChange();
  };
  return () => channel.close();
}

/**
 * Use whenever the user or organisation changes. A full page load, not a client navigation: it
 * wipes the query cache and CSRF token from memory, so no screen can act on old data.
 */
export function changeSession(path: string) {
  announce();
  window.location.assign(path);
}
