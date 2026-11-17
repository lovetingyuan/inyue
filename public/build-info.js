(function () {
  const script = document.currentScript;
  if (!script) {
    return;
  }
  const search = new URLSearchParams(new URL(script.src).search);
  const time = Number(search.get("time"));
  const hash = search.get("hash") || "unknown";
  const validTime = Number.isFinite(time) && time > 0;
  const date = new Date(time);
  const buildTime = validTime ? date.toLocaleString() : "unknown";
  window.__INYUE_BUILD_INFO__ = Object.freeze({ time: validTime ? time : undefined, hash });
  window._buildDate = validTime ? date.toLocaleDateString() : "";
  console.log(
    `%c Build: ${buildTime} ${hash} `,
    "background-color: #4DBA87; color: #fff; padding: 2px; border-radius: 2px;",
  );
})();
