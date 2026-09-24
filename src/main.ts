import './style.css';

import { App } from './render/App.js';
import { World } from './simulation/World.js';
import { loadSavedTown, Persistence } from './ui/Persistence.js';
import { Ui } from './ui/Ui.js';

const container = document.getElementById('app');
if (!container) {
  throw new Error('Missing #app container');
}

// A returning viewer comes back to the town as they left it (SPEC.md 2.13);
// a first visit opens on Day 1 at 05:30.
const saved = loadSavedTown();
const app = new App(container, saved ? World.restore(saved) : new World());
if (saved) {
  app.setSpeed(saved.speed);
}
const persistence = new Persistence(app);
const ui = new Ui(app, document.body, persistence);
app.start();

if (import.meta.env.DEV) {
  // Handle for poking at the running app from the dev console.
  (window as unknown as { tinyTown: App; tinyTownUi: Ui }).tinyTown = app;
  (window as unknown as { tinyTown: App; tinyTownUi: Ui }).tinyTownUi = ui;
}
