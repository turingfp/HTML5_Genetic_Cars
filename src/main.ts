// The interface's typeface, self-hosted so the page needs no third party.
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './style.css';
import { App } from './app/app';

declare global {
  interface Window {
    __gcars?: { debug: () => unknown };
  }
}

/**
 * Put a failure on the screen.
 *
 * All of this exists because of one bug report: "doesn't run on iPhone". A
 * throw during start-up used to leave the page blank, and the console on a
 * phone is not somewhere most people can look, so there was nothing to go on.
 * Now whatever went wrong says so, in the page, with its message.
 */
function showFailure(title: string, detail: string): void {
  const existing = document.getElementById('fatal');
  const box = existing ?? document.createElement('div');
  if (!existing) {
    box.id = 'fatal';
    box.className = 'fatal';
    document.body.prepend(box);
  }

  const heading = document.createElement('strong');
  heading.textContent = title;
  const message = document.createElement('span');
  message.textContent = detail;
  const hint = document.createElement('small');
  hint.textContent = 'Reloading usually helps. If it does not, this text is the bug report.';

  box.replaceChildren(heading, message, hint);
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

window.addEventListener('error', (event) => {
  // Subresource load failures also fire an error event, but on the element
  // rather than the window, and they are not fatal: a preload for the 3D chunk
  // that never arrives ends in the flat mode, which is a working page. Only
  // uncaught script errors get the panel.
  if (event.target && event.target !== window) return;
  showFailure('Something went wrong.', describe(event.error ?? event.message));
});

window.addEventListener('unhandledrejection', (event) => {
  showFailure('Something went wrong.', describe(event.reason));
});

function boot(): void {
  try {
    const app = new App();
    // Exposed so end-to-end tests can assert on simulation state.
    window.__gcars = { debug: () => app.debug() };
  } catch (error) {
    console.error(error);
    showFailure('BoxCar3D could not start.', describe(error));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
