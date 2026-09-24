import type { Citizen } from '../entities/Citizen.js';
import type { App } from '../render/App.js';
import type { SpeedLevel } from '../simulation/constants.js';
import type { LogEntry } from '../simulation/EventLog.js';
import type { Weather } from '../simulation/WeatherSystem.js';

import { isClickable, tripFor } from './diary.js';
import type { Persistence } from './Persistence.js';
import {
  describeActivity,
  describeFamily,
  describeFriends,
  describeHome,
  nextWeather,
  weatherGlyph,
} from './phrases.js';
import './ui.css';

/**
 * The observation tools over the town (SPEC.md 2.9, DESIGN.md §15): one set
 * of components, laid out two ways by the stylesheet. On a wide screen the
 * weather sits top left, the town's status top right, the selected citizen
 * on the right and the time bar along the bottom. In portrait the status
 * and the diary live in a sheet at the bottom that opens in three steps,
 * and a capsule top left carries the day, the time and the weather.
 *
 * Nothing here decides anything about the town: the UI reads the world once
 * a frame and hands the viewer's choices to the App.
 */

const SPEEDS: SpeedLevel[] = [1, 5, 20, 100];
const WEATHERS: Weather[] = ['Sunny', 'Cloudy', 'Rain'];

/** A tap is a press that hardly moved and did not linger. */
const TAP_MOVE_PX = 8;
const TAP_MS = 500;

/** Hit radius around a citizen, on a mouse and on a finger. */
const PICK_RADIUS_MOUSE = 18;
const PICK_RADIUS_TOUCH = 36;

type SheetState = 'collapsed' | 'half' | 'full';

/** How long a note ("Tom has moved on.") stays up, and how long a reset waits for its second tap. */
const TOAST_MS = 3200;
const RESET_CONFIRM_MS = 4000;

export class Ui {
  readonly root: HTMLElement;

  private readonly weather: HTMLElement;
  private readonly weatherButtons = new Map<Weather, HTMLButtonElement>();
  private readonly rainbowButton: HTMLButtonElement;
  private readonly lanternButton: HTMLButtonElement;
  private readonly capsule: HTMLButtonElement;
  private readonly capsuleText: HTMLElement;
  private readonly capsuleGlyph: HTMLElement;
  private readonly status: HTMLElement;
  private readonly statusRows = new Map<string, HTMLElement>();
  private readonly statusSlot: HTMLElement;
  private readonly citizenPanel: HTMLElement;
  private readonly citizenSlot: HTMLElement;
  private readonly citizenFields = new Map<string, HTMLElement>();
  private readonly followButton: HTMLButtonElement;
  private readonly returnPill: HTMLButtonElement;
  private readonly timeBar: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly speedButtons = new Map<SpeedLevel, HTMLButtonElement>();
  private readonly sheet: HTMLElement;
  private readonly sheetBody: HTMLElement;
  private readonly ticker: HTMLElement;
  private readonly log: HTMLElement;
  private readonly logTitle: HTMLElement;
  private readonly diaryCard: HTMLElement;
  private readonly diaryToggle: HTMLButtonElement;
  private readonly corner: HTMLElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly settingsPanel: HTMLElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly toast: HTMLElement;
  private toastTimer: number | undefined;
  private resetTimer: number | undefined;

  private readonly portraitQuery = window.matchMedia('(orientation: portrait), (max-width: 700px)');
  private selectedId: string | undefined;
  private sheetState: SheetState = 'collapsed';
  private sheetBeforeSelection: SheetState = 'collapsed';
  private lastLogCount = -1;
  private lastStatus = '';

  constructor(
    private readonly app: App,
    parent: HTMLElement,
    private readonly persistence?: Persistence,
  ) {
    this.root = element('div', 'tt-ui');

    // --- Weather (wide) and the capsule (portrait) ---
    this.weather = element('div', 'tt-weather tt-card');
    for (const weather of WEATHERS) {
      const button = element('button', 'tt-weather-button') as HTMLButtonElement;
      button.type = 'button';
      button.innerHTML = `<span class="tt-glyph">${weatherGlyph(weather)}</span><span>${weather}</span>`;
      button.setAttribute('aria-label', weather);
      button.addEventListener('click', () => this.app.setWeather(weather));
      this.weatherButtons.set(weather, button);
      this.weather.appendChild(button);
    }
    // The rainbow (SPEC.md 2.8): one press a rainbow, two a double, three none.
    this.rainbowButton = element('button', 'tt-weather-button tt-rainbow') as HTMLButtonElement;
    this.rainbowButton.type = 'button';
    this.rainbowButton.innerHTML =
      '<span class="tt-glyph">🌈<b class="tt-badge">2</b></span><span class="tt-rainbow-label">Rainbow</span>';
    this.rainbowButton.addEventListener('click', () => this.app.cycleRainbow());
    this.weather.appendChild(this.rainbowButton);
    // Mid-Autumn night (SPEC.md 2.15): a switch, set apart from the weather.
    this.weather.appendChild(element('span', 'tt-weather-divider'));
    this.lanternButton = element('button', 'tt-weather-button tt-lantern') as HTMLButtonElement;
    this.lanternButton.type = 'button';
    this.lanternButton.innerHTML = '<span class="tt-glyph">🏮</span><span>Mid-Autumn</span>';
    this.lanternButton.setAttribute('aria-label', 'Mid-Autumn night');
    this.lanternButton.addEventListener('click', () => {
      this.app.setMidAutumn(!this.app.midAutumn);
    });
    this.weather.appendChild(this.lanternButton);

    this.capsule = element('button', 'tt-capsule tt-card') as HTMLButtonElement;
    this.capsule.type = 'button';
    this.capsuleText = element('span', 'tt-capsule-text');
    this.capsuleGlyph = element('span', 'tt-glyph');
    this.capsule.append(this.capsuleText, this.capsuleGlyph);
    this.capsule.setAttribute('aria-label', 'Change the weather');
    this.capsule.addEventListener('click', () => {
      this.app.setWeather(nextWeather(this.app.world.weather.current));
    });

    // --- Town status ---
    this.status = element('section', 'tt-status');
    const title = element('h1', 'tt-title');
    title.textContent = 'Tiny Town';
    this.status.appendChild(title);
    for (const row of ['Day', 'Time', 'People', 'Outside', 'Cars on the road', 'Weather']) {
      const line = element('div', 'tt-row');
      const label = element('span', 'tt-label');
      label.textContent = row;
      const value = element('span', 'tt-value');
      line.append(label, value);
      this.status.appendChild(line);
      this.statusRows.set(row, value);
    }
    this.statusSlot = element('div', 'tt-status-slot tt-card');
    this.statusSlot.appendChild(this.status);

    // --- The selected citizen ---
    this.citizenPanel = element('section', 'tt-citizen');
    const head = element('div', 'tt-citizen-head');
    const name = element('h2', 'tt-citizen-name');
    const close = element('button', 'tt-close') as HTMLButtonElement;
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.select(undefined));
    head.append(name, close);
    this.citizenPanel.appendChild(head);
    this.citizenFields.set('name', name);
    const meta = element('p', 'tt-citizen-meta');
    this.citizenPanel.appendChild(meta);
    this.citizenFields.set('meta', meta);
    for (const row of ['Now', 'Home', 'Family', 'Friends']) {
      const line = element('div', 'tt-row tt-row-wrap');
      const label = element('span', 'tt-label');
      label.textContent = row;
      const value = element('span', 'tt-value');
      line.append(label, value);
      this.citizenPanel.appendChild(line);
      this.citizenFields.set(row, value);
    }
    this.followButton = element('button', 'tt-button tt-follow') as HTMLButtonElement;
    this.followButton.type = 'button';
    this.followButton.addEventListener('click', () => {
      if (!this.selectedId) {
        return;
      }
      if (this.app.following === this.selectedId) {
        this.app.stopFollowing();
      } else {
        this.app.follow(this.selectedId);
      }
      this.refreshFollowButton();
    });
    this.citizenPanel.appendChild(this.followButton);
    this.citizenSlot = element('aside', 'tt-citizen-slot tt-card');
    this.citizenSlot.appendChild(this.citizenPanel);
    this.citizenSlot.hidden = true;

    // --- Back to town ---
    this.returnPill = element('button', 'tt-return tt-card') as HTMLButtonElement;
    this.returnPill.type = 'button';
    this.returnPill.textContent = '↩ Back to town';
    this.returnPill.hidden = true;
    this.returnPill.addEventListener('click', () => this.app.returnToTown());

    // --- Time bar ---
    this.timeBar = element('div', 'tt-timebar tt-card');
    this.playButton = element('button', 'tt-play') as HTMLButtonElement;
    this.playButton.type = 'button';
    this.playButton.addEventListener('click', () => this.app.togglePause());
    this.timeBar.appendChild(this.playButton);
    for (const speed of SPEEDS) {
      const button = element('button', 'tt-speed') as HTMLButtonElement;
      button.type = 'button';
      button.textContent = `${speed}×`;
      button.addEventListener('click', () => this.app.setSpeed(speed));
      this.speedButtons.set(speed, button);
      this.timeBar.appendChild(button);
    }

    // --- The sheet (portrait): ticker, then status and the diary ---
    this.sheet = element('div', 'tt-sheet tt-card');
    const handle = element('button', 'tt-handle') as HTMLButtonElement;
    handle.type = 'button';
    handle.setAttribute('aria-label', 'Open the town diary');
    this.ticker = element('div', 'tt-ticker');
    this.sheetBody = element('div', 'tt-sheet-body');
    this.logTitle = element('h3', 'tt-log-title');
    this.logTitle.textContent = 'Today in town';
    this.log = element('ol', 'tt-log');
    this.sheet.append(handle, this.ticker, this.sheetBody);
    this.wireSheet(handle);

    // --- The diary card (wide, decision 42): the latest lines, opened by its title ---
    this.diaryCard = element('section', 'tt-diary tt-card');
    this.diaryToggle = element('button', 'tt-diary-toggle') as HTMLButtonElement;
    this.diaryToggle.type = 'button';
    this.diaryToggle.innerHTML = '<span>Today in town</span><span class="tt-chevron">▴</span>';
    this.diaryToggle.setAttribute('aria-expanded', 'false');
    this.diaryToggle.addEventListener('click', () => {
      const open = !this.diaryCard.classList.contains('tt-open');
      this.diaryCard.classList.toggle('tt-open', open);
      this.diaryToggle.setAttribute('aria-expanded', String(open));
      this.log.scrollTop = this.log.scrollHeight;
    });

    // --- Sound and settings, in the corner (SPEC.md 2.12, 2.13) ---
    this.corner = element('div', 'tt-corner tt-card');
    this.soundButton = element('button', 'tt-corner-button') as HTMLButtonElement;
    this.soundButton.type = 'button';
    this.soundButton.addEventListener('click', () => {
      this.app.ambience.setMuted(!this.app.ambience.isMuted);
      this.refreshSoundButton();
    });
    this.settingsButton = element('button', 'tt-corner-button') as HTMLButtonElement;
    this.settingsButton.type = 'button';
    this.settingsButton.innerHTML = '<span class="tt-glyph">⚙</span>';
    this.settingsButton.setAttribute('aria-label', 'Settings');
    this.settingsButton.setAttribute('aria-expanded', 'false');
    this.settingsButton.addEventListener('click', () =>
      this.showSettings(this.settingsPanel.hidden === true),
    );
    this.corner.append(this.soundButton, this.settingsButton);
    this.refreshSoundButton();

    this.settingsPanel = element('section', 'tt-settings tt-card');
    this.settingsPanel.hidden = true;
    const settingsTitle = element('h3', 'tt-settings-title');
    settingsTitle.textContent = 'Settings';
    this.resetButton = element('button', 'tt-reset') as HTMLButtonElement;
    this.resetButton.type = 'button';
    this.resetButton.addEventListener('click', () => this.pressReset());
    const resetHint = element('p', 'tt-settings-hint');
    resetHint.textContent = 'Start again from Day 1 at 05:30.';
    this.settingsPanel.append(settingsTitle, this.resetButton, resetHint);
    this.refreshResetButton(false);

    this.toast = element('div', 'tt-toast tt-card');
    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;

    this.root.append(
      this.weather,
      this.capsule,
      this.statusSlot,
      this.citizenSlot,
      this.returnPill,
      this.timeBar,
      this.sheet,
      this.diaryCard,
      this.corner,
      this.settingsPanel,
      this.toast,
    );
    parent.appendChild(this.root);

    this.placeByLayout();
    this.portraitQuery.addEventListener('change', () => this.placeByLayout());
    this.wireCanvasTaps();
    this.app.addFrameListener(() => this.refresh());
    this.refresh();
  }

  /** Puts the shared components where this layout wants them. */
  private placeByLayout(): void {
    const portrait = this.portraitQuery.matches;
    this.root.classList.toggle('tt-portrait', portrait);
    if (portrait) {
      this.sheetBody.replaceChildren(this.citizenPanel, this.status, this.logTitle, this.log);
      this.diaryCard.replaceChildren();
      this.citizenSlot.hidden = true;
    } else {
      this.statusSlot.appendChild(this.status);
      this.citizenSlot.appendChild(this.citizenPanel);
      this.sheetBody.replaceChildren();
      this.diaryCard.replaceChildren(this.diaryToggle, this.log);
      this.citizenSlot.hidden = this.selectedId === undefined;
    }
    this.citizenPanel.hidden = this.selectedId === undefined;
    this.setSheet(this.sheetState);
  }

  /** A tap on the canvas picks a citizen, or clears the pick. */
  private wireCanvasTaps(): void {
    const canvas = this.app.canvas;
    let down: { x: number; y: number; at: number; touch: boolean } | undefined;
    canvas.addEventListener('pointerdown', (event) => {
      down = {
        x: event.clientX,
        y: event.clientY,
        at: performance.now(),
        touch: event.pointerType !== 'mouse',
      };
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!down) {
        return;
      }
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      const held = performance.now() - down.at;
      const { touch } = down;
      down = undefined;
      if (moved > TAP_MOVE_PX || held > TAP_MS) {
        return;
      }
      const id = this.app.pickCitizen(
        event.clientX,
        event.clientY,
        touch ? PICK_RADIUS_TOUCH : PICK_RADIUS_MOUSE,
      );
      // On Mid-Autumn night a tap on the palace in the moon flies out to it.
      if (id === undefined && this.app.pickPalace(event.clientX, event.clientY)) {
        this.select(undefined);
        this.app.visitPalace();
        return;
      }
      this.select(id);
    });
    canvas.addEventListener('pointercancel', () => {
      down = undefined;
    });
  }

  /** Selects a citizen for the panel, or nobody. */
  select(id: string | undefined): void {
    if (id === this.selectedId) {
      return;
    }
    const had = this.selectedId !== undefined;
    this.selectedId = id;
    if (this.app.following && this.app.following !== id) {
      this.app.stopFollowing();
    }
    this.citizenPanel.hidden = id === undefined;
    if (this.portraitQuery.matches) {
      if (id !== undefined && !had) {
        this.sheetBeforeSelection = this.sheetState;
        this.setSheet('half');
      } else if (id === undefined && had) {
        this.setSheet(this.sheetBeforeSelection);
      }
      this.status.hidden = id !== undefined;
      this.logTitle.hidden = id !== undefined;
      this.log.hidden = id !== undefined;
    } else {
      this.citizenSlot.hidden = id === undefined;
    }
    this.refreshCitizen();
  }

  get selected(): string | undefined {
    return this.selectedId;
  }

  // --- The sheet ------------------------------------------------------------

  private wireSheet(handle: HTMLButtonElement): void {
    const order: SheetState[] = ['collapsed', 'half', 'full'];
    handle.addEventListener('click', () => {
      const next = order[(order.indexOf(this.sheetState) + 1) % order.length];
      this.setSheet(next);
    });
    // A drag on the handle opens or closes it by direction.
    let startY: number | undefined;
    handle.addEventListener('pointerdown', (event) => {
      startY = event.clientY;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointerup', (event) => {
      if (startY === undefined) {
        return;
      }
      const dy = event.clientY - startY;
      startY = undefined;
      if (Math.abs(dy) < 24) {
        return;
      }
      const index = order.indexOf(this.sheetState);
      const next = order[Math.min(order.length - 1, Math.max(0, index + (dy < 0 ? 1 : -1)))];
      this.setSheet(next);
      // The click that follows the drag must not cycle it again.
      const swallow = (click: Event): void => {
        click.stopImmediatePropagation();
        click.preventDefault();
      };
      handle.addEventListener('click', swallow, { capture: true, once: true });
    });
  }

  setSheet(state: SheetState): void {
    this.sheetState = state;
    this.sheet.dataset.state = state;
  }

  get sheetPosition(): SheetState {
    return this.sheetState;
  }

  // --- Refresh from the world, once a frame ---------------------------------

  private refresh(): void {
    const world = this.app.world;
    const { time } = world;
    const weather = world.weather.current;
    const clock = clockOf(time.minuteOfDay);

    const driving = world.vehicles.filter((vehicle) => vehicle.state === 'driving').length;
    const festival = this.app.midAutumn;
    const rainbow = this.app.rainbowMode;
    const status = [
      festival,
      rainbow,
      time.day,
      clock,
      world.citizens.length,
      world.citizenSystem.outsideCount,
      driving,
      weather,
    ].join('|');
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.statusRows.get('Day')!.textContent = String(time.day);
      this.statusRows.get('Time')!.textContent = clock;
      this.statusRows.get('People')!.textContent = String(world.citizens.length);
      this.statusRows.get('Outside')!.textContent = String(world.citizenSystem.outsideCount);
      this.statusRows.get('Cars on the road')!.textContent = String(driving);
      this.statusRows.get('Weather')!.textContent =
        `${weatherGlyph(weather)} ${weather}` +
        (rainbow !== 'none' ? ' · 🌈' : '') +
        (festival ? ' · 🏮' : '');
      this.capsuleText.textContent = `Day ${time.day} · ${clock} · `;
      this.capsuleGlyph.textContent =
        weatherGlyph(weather) + (rainbow !== 'none' ? ' 🌈' : '') + (festival ? ' 🏮' : '');
      this.rainbowButton.classList.toggle('tt-active', rainbow !== 'none');
      this.rainbowButton.classList.toggle('tt-double', rainbow === 'double');
      this.rainbowButton.setAttribute('aria-pressed', String(rainbow !== 'none'));
      this.rainbowButton.setAttribute(
        'aria-label',
        rainbow === 'none' ? 'Rainbow' : rainbow === 'single' ? 'Double rainbow' : 'No rainbow',
      );
      this.rainbowButton.title =
        rainbow === 'none'
          ? 'Rainbow'
          : rainbow === 'single'
            ? 'Make it double'
            : 'Clear the rainbow';
      setText(
        this.rainbowButton.querySelector<HTMLElement>('.tt-rainbow-label') ?? undefined,
        rainbow === 'double' ? 'Double' : 'Rainbow',
      );
      this.lanternButton.classList.toggle('tt-active', festival);
      this.lanternButton.setAttribute('aria-pressed', String(festival));
      for (const [which, button] of this.weatherButtons) {
        button.classList.toggle('tt-active', which === weather);
      }
    }

    const speed = this.app.getSpeed();
    this.playButton.textContent = speed === 0 ? '▶' : '⏸';
    this.playButton.setAttribute('aria-label', speed === 0 ? 'Play' : 'Pause');
    for (const [level, button] of this.speedButtons) {
      button.classList.toggle('tt-active', level === speed);
    }

    this.returnPill.hidden = !this.app.cameraTaken;

    const entries = world.log.entries;
    if (entries.length !== this.lastLogCount) {
      this.lastLogCount = entries.length;
      this.refreshLog();
    }

    this.refreshCitizen();
  }

  private refreshLog(): void {
    const world = this.app.world;
    const today = world.time.day;
    const recent = world.log.entries.filter((entry) => entry.day >= today - 1);
    this.log.replaceChildren(
      ...recent.map((entry) => {
        const item = element('li', 'tt-log-entry');
        if (isClickable(entry)) {
          // A click takes the camera to what happened (SPEC.md 2.10).
          item.classList.add('tt-log-link');
          item.tabIndex = 0;
          item.setAttribute('role', 'button');
          item.addEventListener('click', () => this.openEntry(entry));
          item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              this.openEntry(entry);
            }
          });
        }
        const when = element('span', 'tt-log-when');
        const hour = String(Math.floor(entry.minute / 60)).padStart(2, '0');
        const minute = String(Math.floor(entry.minute) % 60).padStart(2, '0');
        when.textContent =
          entry.day === today ? `${hour}:${minute}` : `Day ${entry.day} ${hour}:${minute}`;
        const text = element('span', 'tt-log-text');
        text.textContent = entry.text;
        item.append(when, text);
        return item;
      }),
    );
    this.log.scrollTop = this.log.scrollHeight;
    const latest = recent[recent.length - 1];
    this.ticker.textContent = latest ? latest.text : 'The town is waking up.';
  }

  /**
   * Flies to where a diary entry happened (SPEC.md 2.10): the person is
   * selected if they are still there, or a short note says they have gone.
   */
  openEntry(entry: LogEntry): void {
    const trip = tripFor(entry, this.app.world);
    if (!trip) {
      return;
    }
    if (this.portraitQuery.matches) {
      // Out of the way, so the flight can be seen.
      this.setSheet('collapsed');
    }
    this.select(undefined);
    this.app.lookAtPlace(trip.point);
    if (trip.select) {
      this.select(trip.select);
    } else if (trip.note) {
      this.showToast(trip.note);
    }
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
    }, TOAST_MS);
  }

  // --- Sound and settings -----------------------------------------------------

  private refreshSoundButton(): void {
    const muted = this.app.ambience.isMuted;
    this.soundButton.innerHTML = `<span class="tt-glyph">${muted ? '🔇' : '🔊'}</span>`;
    this.soundButton.setAttribute('aria-label', muted ? 'Turn the sound on' : 'Turn the sound off');
    this.soundButton.classList.toggle('tt-active', !muted);
  }

  private showSettings(open: boolean): void {
    this.settingsPanel.hidden = !open;
    this.settingsButton.classList.toggle('tt-active', open);
    this.settingsButton.setAttribute('aria-expanded', String(open));
    if (!open) {
      this.refreshResetButton(false);
    }
  }

  /** The first press asks, the second resets; the question lapses after a few seconds. */
  private pressReset(): void {
    if (this.resetButton.dataset.confirm === 'true') {
      window.clearTimeout(this.resetTimer);
      this.persistence?.reset();
      return;
    }
    this.refreshResetButton(true);
    window.clearTimeout(this.resetTimer);
    this.resetTimer = window.setTimeout(() => this.refreshResetButton(false), RESET_CONFIRM_MS);
  }

  private refreshResetButton(confirming: boolean): void {
    this.resetButton.dataset.confirm = String(confirming);
    this.resetButton.textContent = confirming ? 'Tap again to reset' : 'Reset town';
    this.resetButton.classList.toggle('tt-confirm', confirming);
  }

  private refreshCitizen(): void {
    if (!this.selectedId) {
      return;
    }
    const citizen = this.app.world.citizenSystem.find(this.selectedId);
    if (!citizen) {
      this.select(undefined);
      return;
    }
    const find = (id: string): Citizen | undefined => this.app.world.citizenSystem.find(id);
    setText(this.citizenFields.get('name'), citizen.name);
    setText(this.citizenFields.get('meta'), `${citizen.age} · ${citizen.job}`);
    setText(this.citizenFields.get('Now'), describeActivity(citizen));
    setText(this.citizenFields.get('Home'), describeHome(citizen));
    setText(this.citizenFields.get('Family'), describeFamily(citizen, find));
    setText(this.citizenFields.get('Friends'), describeFriends(citizen, find));
    this.refreshFollowButton();
  }

  private refreshFollowButton(): void {
    const following = this.selectedId !== undefined && this.app.following === this.selectedId;
    this.followButton.textContent = following ? 'Stop following' : 'Follow';
    this.followButton.classList.toggle('tt-active', following);
  }
}

/** "08:42" from a minute of the day. */
function clockOf(minuteOfDay: number): string {
  const hour = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const minute = String(Math.floor(minuteOfDay) % 60).padStart(2, '0');
  return `${hour}:${minute}`;
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** Writes text only when it changed, so the DOM stays quiet between frames. */
function setText(node: HTMLElement | undefined, text: string): void {
  if (node && node.textContent !== text) {
    node.textContent = text;
  }
}
