const SENSOR = Object.freeze({
  OLED: "OLED",
  TOF: "TOF",
});

let nextBuildId = 1;

function buildFirmware(selectedSensors = []) {
  const id = nextBuildId++;
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

  return new Promise((resolve, reject) => {
    worker.addEventListener("message", (event) => {
      const { ok, result, error } = event.data;
      worker.terminate();

      if (ok) {
        resolve(result);
      } else {
        reject(Object.assign(new Error(error.message), { stack: error.stack }));
      }
    }, { once: true });

    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(new Error(event.message || "Firmware worker failed"));
    }, { once: true });

    worker.postMessage({ id, sensors: selectedSensors });
  });
}

window.SENSOR = SENSOR;
window.buildFirmware = buildFirmware;

const form = document.querySelector("[data-build-form]");
const statusEl = document.querySelector("[data-status]");
const resultEl = document.querySelector("[data-result]");
const timingsEl = document.querySelector("[data-timings]");
const outputEl = document.querySelector("[data-output]");
const downloadEl = document.querySelector("[data-download]");
const buttons = [...document.querySelectorAll("[data-build]")];

let lastDownloadUrl = "";

function currentSensors() {
  return [...form.querySelectorAll("input[name='sensor']:checked")].map((input) => input.value);
}

function setSelectedSensors(sensors) {
  const selected = new Set(sensors);
  for (const input of form.querySelectorAll("input[name='sensor']")) {
    input.checked = selected.has(input.value);
  }
}

function setBusy(isBusy) {
  for (const button of buttons) {
    button.disabled = isBusy;
  }
  for (const input of form.querySelectorAll("input")) {
    input.disabled = isBusy;
  }
}

function formatMs(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${value.toFixed(0)}ms`;
}

function renderTimings(timings) {
  const preferredOrder = [
    "totalMs",
    "cc1plus:totalMs",
    "headersFsMs",
    "avr-as:totalMs",
    "avr-ld:totalMs",
    "linkInputsFsMs",
    "avr-objcopy:totalMs",
  ];
  const entries = Object.entries(timings);
  const ordered = [
    ...preferredOrder.filter((key) => key in timings).map((key) => [key, timings[key]]),
    ...entries.filter(([key]) => !preferredOrder.includes(key)).sort(([a], [b]) => a.localeCompare(b)),
  ];

  timingsEl.innerHTML = ordered.map(([key, value]) => `
    <div class="metric">
      <span>${key}</span>
      <strong>${formatMs(value)}</strong>
    </div>
  `).join("");
}

function setDownload(hex) {
  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);

  const blob = new Blob([hex], { type: "text/plain;charset=utf-8" });
  lastDownloadUrl = URL.createObjectURL(blob);
  downloadEl.href = lastDownloadUrl;
  downloadEl.hidden = false;
}

async function runBuild(sensors) {
  const label = sensors.length ? sensors.join(", ") : "base";
  const startedAt = performance.now();

  setBusy(true);
  statusEl.textContent = `Building ${label} firmware...`;
  resultEl.textContent = "";
  timingsEl.innerHTML = "";
  outputEl.textContent = "";
  downloadEl.hidden = true;

  try {
    const result = await buildFirmware(sensors);
    const elapsed = performance.now() - startedAt;

    statusEl.textContent = "Build completed";
    resultEl.textContent = [
      `Sensors: ${result.sensors.length ? result.sensors.join(", ") : "base"}`,
      `Flash data: ${result.flashBytes.toLocaleString()} / ${result.target.appFlashBytes.toLocaleString()} bytes`,
      `Fits ${result.target.board}: ${result.fitsTarget ? "yes" : "no"}`,
      `HEX text: ${result.hexBytes.toLocaleString()} bytes`,
      `Linked objects: ${result.objectCount}`,
      `Wall time: ${formatMs(elapsed)}`,
      `Compiler log lines: ${result.stderr.length}`,
    ].join("\n");
    renderTimings(result.timings);
    outputEl.textContent = result.hex.split("\n").slice(0, 24).join("\n");
    setDownload(result.hex);
    return result;
  } catch (error) {
    statusEl.textContent = "Build failed";
    resultEl.textContent = error.stack || error.message;
    throw error;
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runBuild(currentSensors()).catch(() => {});
});

for (const button of buttons) {
  button.addEventListener("click", () => {
    const sensors = (button.dataset.build || "").split(",").filter(Boolean);
    setSelectedSensors(sensors);
    runBuild(sensors).catch(() => {});
  });
}
