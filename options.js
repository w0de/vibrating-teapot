const reader = document.getElementById("readerMode");
const dark = document.getElementById("darkMode");

function applyTheme(on) {
  document.documentElement.dataset.theme = on ? "dark" : "light";
}

async function load() {
  const p = await browser.storage.local.get(["readerMode", "darkMode"]);
  reader.checked = p.readerMode !== false; // default on
  dark.checked = p.darkMode !== false;     // default on
  applyTheme(dark.checked);
}

reader.addEventListener("change", () => {
  browser.storage.local.set({ readerMode: reader.checked });
});

dark.addEventListener("change", () => {
  browser.storage.local.set({ darkMode: dark.checked });
  applyTheme(dark.checked);
});

load();
