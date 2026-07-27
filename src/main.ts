import './style.css';
import { App } from './app/app';

declare global {
  interface Window {
    __gcars?: { debug: () => unknown };
  }
}

function boot(): void {
  const app = new App();
  // Exposed so end-to-end tests can assert on simulation state.
  window.__gcars = { debug: () => app.debug() };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
