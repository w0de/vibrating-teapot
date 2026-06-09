(async () => {
  const { darkMode } = await browser.storage.local.get("darkMode");
  document.documentElement.dataset.theme = darkMode !== false ? "dark" : "light";

  const target = new URLSearchParams(location.search).get("u");
  if (target && /^https?:\/\//i.test(target)) {
    const sub = document.getElementById("sub");
    sub.innerHTML = "No snapshot found for<br><b></b>";
    sub.querySelector("b").textContent = target;

    const brew = document.getElementById("brew");
    brew.href = "https://archive.ph/?url=" + encodeURIComponent(target);
    brew.hidden = false;
  }
})();
