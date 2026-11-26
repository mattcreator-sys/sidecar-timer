const timerList = document.querySelector('#timer-list');
const timerForm = document.querySelector('#timer-form');
const timerNameInput = document.querySelector('#timer-name');
const timerMinutesInput = document.querySelector('#timer-minutes');
const timerCancel = document.querySelector('#timer-cancel');
const timerSubmitLabel = timerForm.querySelector('button[type="submit"] span');
const timeLabel = document.querySelector('#clock-time');
const clock = document.querySelector('#clock');
const clockMode = document.querySelector('#clock-mode');
const clockCaption = document.querySelector('#clock-caption');
const startButton = document.querySelector('#start-button');
const startLabel = startButton.querySelector('span:last-child');
const resetButton = document.querySelector('#reset-button');
const connectButton = document.querySelector('#connect-button');
const connectionState = document.querySelector('#connection-state');
const connectionLabel = document.querySelector('#connection-label');
const browserNote = document.querySelector('#browser-note');
const sessionCountLabel = document.querySelector('#session-count');
const deviceScreenTime = document.querySelector('#device-screen-time');
const deviceScreenLabel = document.querySelector('#device-screen-label');
const deviceProgressFill = document.querySelector('#device-progress-fill');
const deviceWeatherTemp = document.querySelector('#device-weather-temp');
const deviceWeatherSummary = document.querySelector('#device-weather-summary');
const deviceWeatherHighLow = document.querySelector('#device-weather-high-low');
const weatherIdleToggle = document.querySelector('#weather-idle-toggle');
const weatherCitySelect = document.querySelector('#weather-city');
const weatherOptions = document.querySelector('#weather-options');
const weatherNote = document.querySelector('#weather-note');
const announcement = document.querySelector('#announcement');
const mountLeft = document.querySelector('#mount-left');
const mountRight = document.querySelector('#mount-right');
const deviceScreen = document.querySelector('.device-screen');
let mountSide = localStorage.getItem('sidecar-mount-side') === 'left' ? 'left' : 'right';
const weatherLocations = {
  bothell: { name: 'Bothell, WA', latitude: 47.7623, longitude: -122.2054 },
  kenmore: { name: 'Kenmore, WA', latitude: 47.7573, longitude: -122.2440 },
  woodinville: { name: 'Woodinville, WA', latitude: 47.7543, longitude: -122.1635 },
};
const savedWeatherCity = localStorage.getItem('sidecar-weather-city');
weatherCitySelect.value = weatherLocations[savedWeatherCity] ? savedWeatherCity : 'bothell';
weatherIdleToggle.checked = localStorage.getItem('sidecar-weather-idle') !== 'false';
weatherOptions.hidden = !weatherIdleToggle.checked;

const MAX_TIMERS = 12;
const MAX_MINUTES = 180;
const DEFAULT_MINUTES = 25;

function clampMinutes(value) {
  return Math.min(MAX_MINUTES, Math.max(1, Math.round(Number(value) || 1)));
}

function cleanName(value) {
  return String(value ?? '').trim().slice(0, 32);
}

function newId() {
  return `timer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeTimer(name, minutes) {
  return { id: newId(), name: cleanName(name) || 'Timer', minutes: clampMinutes(minutes) };
}

function loadTimers() {
  try {
    const stored = JSON.parse(localStorage.getItem('sidecar-timers') || '[]');
    if (!Array.isArray(stored)) return [makeTimer('Focus', 25)];
    const cleaned = stored
      .filter(timer => timer && typeof timer === 'object')
      .map(timer => ({ id: String(timer.id || newId()), name: cleanName(timer.name) || 'Timer', minutes: clampMinutes(timer.minutes) }))
      .slice(0, MAX_TIMERS);
    return cleaned.length ? cleaned : [makeTimer('Focus', 25)];
  } catch {
    return [makeTimer('Focus', 25)];
  }
}

let timers = loadTimers();
let activeId = localStorage.getItem('sidecar-active-timer');
if (!timers.some(timer => timer.id === activeId)) activeId = timers[0].id;
let editingId = null;
let running = false;
let deadline = 0;
let remainingSeconds = activeTimer().minutes * 60;

function activeTimer() {
  return timers.find(timer => timer.id === activeId) ?? timers[0];
}

function saveTimers() {
  localStorage.setItem('sidecar-timers', JSON.stringify(timers));
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let sessionDay = localDateKey();
let sessionCount = Number(localStorage.getItem(`sidecar-sessions-${sessionDay}`) || 0);
let port = null;
let writer = null;
let writeQueue = Promise.resolve();
let lastSentState = '';
let deviceMode = 'timer';
let lastActivityAt = Date.now();
let weatherData = null;
let weatherFetchedAt = 0;
let weatherAttemptedAt = 0;
let weatherRequest = null;
const WEATHER_IDLE_DELAY_MS = 12000;

sessionCountLabel.textContent = String(sessionCount);

function refreshSessionCount() {
  const currentDay = localDateKey();
  if (currentDay === sessionDay) return;
  sessionDay = currentDay;
  sessionCount = Number(localStorage.getItem(`sidecar-sessions-${sessionDay}`) || 0);
  sessionCountLabel.textContent = String(sessionCount);
}

function durationFor() {
  return activeTimer().minutes * 60;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function weatherCodeFor(summary) {
  const value = String(summary || '').toLowerCase();
  if (/thunder|storm|lightning/.test(value)) return 'storm';
  if (/snow|sleet|ice|freezing/.test(value)) return 'snow';
  if (/rain|shower|drizzle/.test(value)) return 'rain';
  if (/fog|haze|smoke/.test(value)) return 'fog';
  if (/cloud|overcast/.test(value)) return /partly|mostly sunny|mostly clear/.test(value) ? 'partly' : 'cloud';
  return 'sun';
}

async function loadWeather(force = false) {
  if (weatherRequest) return weatherRequest;
  if (!force && weatherData && Date.now() - weatherFetchedAt < 30 * 60 * 1000) return weatherData;
  if (!force && !weatherData && weatherAttemptedAt && Date.now() - weatherAttemptedAt < 5 * 60 * 1000) return null;
  const locationKey = weatherCitySelect.value;
  const location = weatherLocations[locationKey] || weatherLocations.bothell;
  weatherAttemptedAt = Date.now();
  weatherRequest = (async () => {
    const headers = { Accept: 'application/geo+json' };
    const pointUrl = `https://api.weather.gov/points/${location.latitude},${location.longitude}`;
    const pointResponse = await fetch(pointUrl, { headers });
    if (!pointResponse.ok) throw new Error(`Weather lookup failed (${pointResponse.status})`);
    const point = await pointResponse.json();
    const forecastResponse = await fetch(point.properties.forecast, { headers });
    if (!forecastResponse.ok) throw new Error(`Forecast unavailable (${forecastResponse.status})`);
    const forecast = await forecastResponse.json();
    const periods = forecast.properties.periods || [];
    if (!periods.length) throw new Error('No forecast periods available');
    const current = periods[0];
    const next = periods[1] || current;
    const dayPeriod = current.isDaytime ? current : next;
    const nightPeriod = current.isDaytime ? next : current;
    if (weatherCitySelect.value !== locationKey) return null;
    weatherData = {
      city: location.name,
      temperature: Number.isFinite(Number(current.temperature)) ? Number(current.temperature) : 0,
      summary: String(current.shortForecast || 'Weather').slice(0, 24),
      high: Number.isFinite(Number(dayPeriod.temperature)) ? Number(dayPeriod.temperature) : 0,
      low: Number.isFinite(Number(nightPeriod.temperature)) ? Number(nightPeriod.temperature) : 0,
      icon: weatherCodeFor(current.shortForecast),
    };
    weatherFetchedAt = Date.now();
    renderDevicePreview();
    sendState(true);
    return weatherData;
  })().catch(error => {
    weatherNote.textContent = 'Weather unavailable. The timer still works.';
    weatherNote.classList.add('is-error');
    return null;
  }).finally(() => { weatherRequest = null; });
  return weatherRequest;
}

function renderDevicePreview() {
  const showingWeather = deviceMode === 'weather' && weatherData;
  deviceScreen.classList.toggle('is-weather', Boolean(showingWeather));
  deviceScreenLabel.textContent = showingWeather ? weatherData.city.toUpperCase() : activeTimer().name.toUpperCase().slice(0, 10);
  if (!showingWeather) return;
  deviceWeatherTemp.textContent = `${weatherData.temperature}°`;
  deviceWeatherSummary.textContent = weatherData.summary;
  deviceWeatherHighLow.textContent = `H ${weatherData.high}° · L ${weatherData.low}°`;
}

function refreshDeviceMode() {
  const shouldShowWeather = weatherIdleToggle.checked && !running
    && Date.now() - lastActivityAt >= WEATHER_IDLE_DELAY_MS;
  const nextMode = shouldShowWeather ? 'weather' : 'timer';
  if (nextMode === deviceMode) return;
  deviceMode = nextMode;
  renderDevicePreview();
  if (deviceMode === 'weather') loadWeather();
  sendState(true);
}

function sendState(force = false) {
  if (!writer) return;
  const state = deviceMode === 'weather' && weatherData ? {
    type: 'weather',
    city: weatherData.city,
    temperature: weatherData.temperature,
    high: weatherData.high,
    low: weatherData.low,
    summary: weatherData.summary,
    icon: weatherData.icon,
    rotationDegrees: mountSide === 'left' ? 180 : 0,
  } : {
    type: 'timer',
    label: activeTimer().name,
    remainingSeconds,
    durationSeconds: durationFor(),
    running,
    rotationDegrees: mountSide === 'left' ? 180 : 0,
  };
  const message = JSON.stringify(state);
  if (!force && message === lastSentState) return;
  lastSentState = message;
  const bytes = new TextEncoder().encode(message + '\n');
  writeQueue = writeQueue.then(() => writer?.write(bytes)).catch(() => disconnect('Screen stopped responding. Reconnect to try again.'));
}

function renderTimers() {
  timerList.replaceChildren(...timers.map(timer => {
    const item = document.createElement('li');
    item.className = `timer-item${timer.id === activeId ? ' is-active' : ''}`;

    const pick = document.createElement('button');
    pick.className = 'timer-pick';
    pick.type = 'button';
    pick.dataset.action = 'select';
    pick.dataset.id = timer.id;
    pick.setAttribute('aria-pressed', String(timer.id === activeId));
    const name = document.createElement('span');
    name.className = 'timer-item-name';
    name.textContent = timer.name;
    const length = document.createElement('span');
    length.className = 'timer-item-length';
    length.textContent = `${timer.minutes} min`;
    pick.append(name, length);

    const edit = document.createElement('button');
    edit.className = 'timer-item-action';
    edit.type = 'button';
    edit.dataset.action = 'edit';
    edit.dataset.id = timer.id;
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit ${timer.name}`);

    const remove = document.createElement('button');
    remove.className = 'timer-item-action is-danger';
    remove.type = 'button';
    remove.dataset.action = 'delete';
    remove.dataset.id = timer.id;
    remove.textContent = '\u00d7';
    remove.setAttribute('aria-label', `Delete ${timer.name}`);
    remove.disabled = timers.length === 1;

    item.append(pick, edit, remove);
    return item;
  }));
}

function renderForm() {
  const editing = timers.find(timer => timer.id === editingId);
  timerSubmitLabel.textContent = editing ? 'Save timer' : 'Add timer';
  timerCancel.hidden = !editing;
  if (!editing) return;
  timerNameInput.value = editing.name;
  timerMinutesInput.value = editing.minutes;
}

function resetForm() {
  editingId = null;
  timerNameInput.value = '';
  timerMinutesInput.value = String(DEFAULT_MINUTES);
  renderForm();
}

function render() {
  const timer = activeTimer();
  const duration = durationFor();
  const progress = duration > 0 ? Math.max(0, Math.min(1, 1 - remainingSeconds / duration)) : 0;
  const formatted = formatTime(remainingSeconds);
  timeLabel.textContent = formatted;
  deviceScreenTime.textContent = formatted;
  deviceScreenLabel.textContent = timer.name.toUpperCase().slice(0, 10);
  deviceProgressFill.style.width = `${progress * 100}%`;
  mountLeft.setAttribute('aria-pressed', String(mountSide === 'left'));
  mountRight.setAttribute('aria-pressed', String(mountSide === 'right'));
  mountLeft.classList.toggle('is-selected', mountSide === 'left');
  mountRight.classList.toggle('is-selected', mountSide === 'right');
  deviceScreen.style.transform = `rotate(${mountSide === 'left' ? 180 : 0}deg)`;
  deviceScreen.classList.toggle('is-running', running);
  deviceScreen.classList.toggle('is-done', remainingSeconds === 0);
  clock.style.setProperty('--progress', `${progress * 360}deg`);
  clock.classList.toggle('is-running', running);
  clockMode.textContent = `${timer.name.toUpperCase()} \u00b7 ${timer.minutes} MIN`;
  clockCaption.textContent = remainingSeconds === 0
    ? 'Done. That one is finished.'
    : running ? 'In it. Nothing else right now.' : 'Start when you are ready.';
  clock.setAttribute('aria-label', `${formatted} remaining on ${timer.name}`);
  startLabel.textContent = running ? 'Pause timer' : remainingSeconds < duration ? 'Resume timer' : `Start ${timer.name}`;
  startButton.classList.toggle('is-running', running);
  startButton.setAttribute('aria-pressed', String(running));
  renderTimers();
  renderDevicePreview();
  sendState();
}

function selectTimer(id, { announce = true } = {}) {
  const timer = timers.find(candidate => candidate.id === id);
  if (!timer) return;
  running = false;
  deadline = 0;
  activeId = timer.id;
  localStorage.setItem('sidecar-active-timer', activeId);
  remainingSeconds = timer.minutes * 60;
  lastSentState = '';
  resetForm();
  render();
  if (announce) announcement.textContent = `${timer.name} timer selected.`;
}

function finishTimer() {
  running = false;
  refreshSessionCount();
  sessionCount += 1;
  sessionCountLabel.textContent = String(sessionCount);
  localStorage.setItem(`sidecar-sessions-${sessionDay}`, String(sessionCount));
  render();
  announcement.textContent = `${activeTimer().name} timer finished. Reset it to run it again.`;
}

function tick() {
  refreshSessionCount();
  refreshDeviceMode();
  if (deviceMode === 'weather' && (weatherFetchedAt
      ? Date.now() - weatherFetchedAt > 30 * 60 * 1000
      : weatherAttemptedAt && Date.now() - weatherAttemptedAt > 5 * 60 * 1000)) loadWeather(true);
  if (!running) return;
  remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  if (remainingSeconds === 0) {
    finishTimer();
    return;
  }
  render();
}

function markActivity() {
  lastActivityAt = Date.now();
  refreshDeviceMode();
}

document.addEventListener('pointerdown', markActivity, { passive: true });
document.addEventListener('keydown', markActivity);
weatherIdleToggle.addEventListener('change', () => {
  localStorage.setItem('sidecar-weather-idle', String(weatherIdleToggle.checked));
  weatherOptions.hidden = !weatherIdleToggle.checked;
  lastActivityAt = Date.now();
  refreshDeviceMode();
});
weatherCitySelect.addEventListener('change', () => {
  localStorage.setItem('sidecar-weather-city', weatherCitySelect.value);
  weatherData = null;
  weatherFetchedAt = 0;
  weatherAttemptedAt = 0;
  weatherNote.textContent = 'Forecast by the National Weather Service.';
  weatherNote.classList.remove('is-error');
  lastActivityAt = Date.now();
  renderDevicePreview();
  if (deviceMode === 'weather') loadWeather(true);
});

startButton.addEventListener('click', () => {
  if (remainingSeconds === 0) remainingSeconds = durationFor();
  running = !running;
  deadline = running ? Date.now() + remainingSeconds * 1000 : 0;
  render();
});

resetButton.addEventListener('click', () => {
  running = false;
  remainingSeconds = durationFor();
  deadline = 0;
  render();
  announcement.textContent = 'Timer reset.';
});

timerForm.addEventListener('submit', event => {
  event.preventDefault();
  const minutes = clampMinutes(timerMinutesInput.value);
  const name = cleanName(timerNameInput.value) || 'Timer';
  const editing = timers.find(timer => timer.id === editingId);

  if (editing) {
    editing.name = name;
    editing.minutes = minutes;
    saveTimers();
    if (editing.id === activeId) {
      running = false;
      deadline = 0;
      remainingSeconds = minutes * 60;
      lastSentState = '';
    }
    resetForm();
    render();
    announcement.textContent = `${name} updated.`;
    return;
  }

  if (timers.length >= MAX_TIMERS) {
    announcement.textContent = `You can keep up to ${MAX_TIMERS} timers. Delete one first.`;
    return;
  }

  const timer = makeTimer(name, minutes);
  timers.push(timer);
  saveTimers();
  selectTimer(timer.id, { announce: false });
  announcement.textContent = `${timer.name} added and selected.`;
});

timerCancel.addEventListener('click', resetForm);

timerList.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'select') {
    selectTimer(id);
    return;
  }
  if (action === 'edit') {
    editingId = id;
    renderForm();
    timerNameInput.focus();
    return;
  }
  if (action === 'delete') {
    const index = timers.findIndex(timer => timer.id === id);
    if (index === -1 || timers.length === 1) return;
    const wasActive = timers[index].id === activeId;
    const [removed] = timers.splice(index, 1);
    saveTimers();
    if (editingId === removed.id) resetForm();
    if (wasActive) {
      selectTimer(timers[Math.min(index, timers.length - 1)].id, { announce: false });
    } else {
      render();
    }
    announcement.textContent = `${removed.name} deleted.`;
  }
});

for (const [button, side] of [[mountLeft, 'left'], [mountRight, 'right']]) {
  button.addEventListener('click', () => {
    mountSide = side;
    localStorage.setItem('sidecar-mount-side', mountSide);
    lastSentState = '';
    render();
    announcement.textContent = `${side === 'left' ? 'Left' : 'Right'} mount selected.`;
  });
}

function disconnect(note = 'Screen not connected') {
  const closingPort = port;
  port = null;
  writer?.releaseLock();
  writer = null;
  connectionState.classList.remove('is-connected');
  connectionLabel.textContent = note === 'Screen not connected' ? note : 'Screen disconnected';
  browserNote.textContent = note;
  browserNote.classList.toggle('is-error', note !== 'Screen not connected');
  connectButton.querySelector('span:last-child').textContent = 'Connect screen';
  if (closingPort) closingPort.close().catch(() => {});
}

connectButton.addEventListener('click', async () => {
  if (port) {
    disconnect();
    return;
  }
  if (!('serial' in navigator)) {
    browserNote.textContent = 'Web Serial is unavailable here. Open this page in desktop Chrome or Edge over HTTPS.';
    browserNote.classList.add('is-error');
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    writer = port.writable.getWriter();
    connectionState.classList.add('is-connected');
    connectionLabel.textContent = 'Screen connected';
    browserNote.textContent = 'Connected at 115200 baud. Disconnect any time.';
    browserNote.classList.remove('is-error');
    connectButton.querySelector('span:last-child').textContent = 'Disconnect screen';
    lastSentState = '';
    sendState(true);
  } catch (error) {
    port = null;
    writer = null;
    browserNote.textContent = error.name === 'NotFoundError' ? 'No screen selected. Connect can be tried again any time.' : `Could not connect: ${error.message}`;
    browserNote.classList.add('is-error');
  }
});

navigator.serial?.addEventListener('disconnect', () => disconnect('Screen was unplugged.'));
let previewGaze = [[0, 0], [0, 0]];
function movePreviewEyes() {
  const pupils = [...document.querySelectorAll('.device-face-eye i')];
  if (pupils.length < 2) return;
  const direction = [-3, 0, 3];
  const targetX = direction[Math.floor(Math.random() * direction.length)];
  const targetY = direction[Math.floor(Math.random() * direction.length)];
  const from = previewGaze.map(([x, y]) => [x, y]);
  const to = [[targetX - 1, targetY], [targetX + 1, targetY]];
  const started = performance.now();
  const duration = 520 + Math.random() * 260;
  function animate(now) {
    const progress = Math.min(1, (now - started) / duration);
    const eased = progress * progress * (3 - 2 * progress);
    previewGaze = from.map((point, index) => point.map((value, axis) => value + (to[index][axis] - value) * eased));
    pupils.forEach((pupil, index) => {
      const [x, y] = previewGaze[index];
      pupil.style.transform = `translate(${x}px, ${y}px)`;
    });
    if (progress < 1) requestAnimationFrame(animate);
    else setTimeout(movePreviewEyes, 1000 + Math.random() * 1400);
  }
  requestAnimationFrame(animate);
}
setTimeout(movePreviewEyes, 700);
setInterval(tick, 200);
renderForm();
render();
