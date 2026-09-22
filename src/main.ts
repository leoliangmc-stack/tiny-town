import './style.css';

import { App } from './render/App.js';
import { World } from './simulation/World.js';

const container = document.getElementById('app');
if (!container) {
  throw new Error('Missing #app container');
}

const app = new App(container, new World());
app.start();

if (import.meta.env.DEV) {
  // Handle for poking at the running app from the dev console.
  (window as unknown as { tinyTown: App }).tinyTown = app;
}
