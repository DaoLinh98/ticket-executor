"use client";

/**
 * Put text on the clipboard, or say honestly that it could not be done.
 *
 * `navigator.clipboard` does not exist outside a secure context, and the phone
 * reaches this app over plain HTTP on the LAN — which is the device the report
 * is pasted from. So the async API is the preferred path, not the only one: the
 * hidden-textarea + `execCommand` route still works there, and when even that
 * fails the caller has to tell the user to copy by hand rather than claim a
 * success that did not happen.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path — a rejection here is exactly the
       insecure-context case it exists for */
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const el = document.createElement("textarea");
  el.value = text;
  // Off-screen rather than hidden: a `display: none` textarea has no selection
  // for `execCommand` to copy, and iOS needs it focusable and non-readonly.
  el.style.position = "fixed";
  el.style.top = "-1000px";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  try {
    el.focus();
    el.setSelectionRange(0, el.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    el.remove();
  }
}
