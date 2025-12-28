// renderer.js

const DEBUG = true;
function dlog(...args) {
  if (DEBUG) console.log("[bildvisare:renderer]", ...args);
}
dlog("Renderer running. window.location.search:", window.location.search);

// Configuration constants
const ZOOM_FACTOR_STEP = 1.07; // Zoom in/out by 7% per step
const ZOOM_MAX = 10; // Maximum zoom level (10x)
const ZOOM_MIN = 0.1; // Minimum zoom level (0.1x = 10% of original)
const ZOOM_INTERVAL_MS = 120; // Continuous zoom every 120ms when key held
const FILE_RELOAD_CHECK_INTERVAL_MS = 1000; // Check for file changes every 1s
const SCROLL_DEBOUNCE_MS = 16; // Debounce scroll events (~60fps)
const RESIZE_DEBOUNCE_MS = 100; // Debounce resize events

// Utility: Simple debounce function for performance
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// SECURITY: No more direct require() - using secure preload bridge
const container = document.getElementById("bild-container");
const img = document.getElementById("bild");
const fallback = document.getElementById("fallback-message");

const params = new URLSearchParams(window.location.search);
const IS_SLAVE = params.get("slave") === "1";
let detached = false; // Slave's detachment mode

let zoomMode = "auto";
let zoomFactor = 1;
let zoomingIn = false;
let zoomingOut = false;
let zoomTimer = null;
let naturalWidth = 0;
let naturalHeight = 0;
let lastCursorInImg = false;
let lastCursorPos = { x: 0, y: 0 };
// BUG FIX: Declare these variables only once (was duplicated at line 185-186)
let lastMouseClientX = 0;
let lastMouseClientY = 0;
let suppressSync = false; // To avoid loops during syncing

function getBildPath() {
  const val = params.get("bild");
  return val ? decodeURIComponent(val) : null;
}
const bildPath = getBildPath();
let lastMtime = 0;

// Create overlay element in DOM
const waitOverlay = document.createElement("div");
waitOverlay.style.position = "fixed";
waitOverlay.style.left = "0";
waitOverlay.style.top = "0";
waitOverlay.style.width = "100vw";
waitOverlay.style.height = "100vh";
waitOverlay.style.background = "rgba(10,10,10,0.72)";
waitOverlay.style.display = "flex";
waitOverlay.style.flexDirection = "column";
waitOverlay.style.alignItems = "center";
waitOverlay.style.justifyContent = "center";
waitOverlay.style.zIndex = 10000;
waitOverlay.style.fontSize = "2.2em";
waitOverlay.style.color = "#fff";
waitOverlay.style.backdropFilter = "blur(2px)";
waitOverlay.innerHTML = "<div>Waiting for conversion of original…</div>";
waitOverlay.style.display = "none";
document.body.appendChild(waitOverlay);

window.bildvisareAPI.on("show-wait-overlay", (msg) => {
  waitOverlay.innerHTML = `<div>${msg || "Waiting for conversion of original…"}</div>`;
  waitOverlay.style.display = "flex";
});
window.bildvisareAPI.on("hide-wait-overlay", () => {
  waitOverlay.style.display = "none";
});

dlog("window.location.search:", window.location.search);
dlog("getBildPath():", getBildPath());
dlog("Starting renderer. bildPath:", bildPath);

if (!bildPath) {
  dlog("No image – showing fallback message");
  img.style.display = "none";
  fallback.style.display = "block";
} else {
  img.style.display = "block";
  fallback.style.display = "none";

  dlog("Loading image:", bildPath);

  // SECURITY FIX: Use file:// protocol for Electron v36+ with contextIsolation
  img.src = bildPath.startsWith('file://') ? bildPath : 'file://' + bildPath;

  function getFitZoomFactor() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    if (naturalWidth === 0 || naturalHeight === 0) return 1;
    return Math.min(winW / naturalWidth, winH / naturalHeight);
  }

  function getImageCenter() {
    return {
      x: img.naturalWidth ? img.naturalWidth / 2 : 0,
      y: img.naturalHeight ? img.naturalHeight / 2 : 0,
    };
  }

  function isZoomInKey(event) {
    return event.key === "+";
  }
  function isZoomOutKey(event) {
    return event.key === "-";
  }

  function updateImageDisplay(
    center = null,
    keepPointInView = false,
    skipSync = false,
  ) {
    if (zoomMode === "auto") {
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      img.style.transform = "";
      img.style.transformOrigin = "";
    } else {
      img.style.objectFit = "unset";
      img.style.transform = "";
      img.style.transformOrigin = "";
      img.style.width = naturalWidth * zoomFactor + "px";
      img.style.height = naturalHeight * zoomFactor + "px";
      if (!center) center = getImageCenter();
      if (keepPointInView) {
        const imgPoint = center;
        const containerRect = container.getBoundingClientRect();
        const screenPoint = lastCursorInImg
          ? {
              x: lastMouseClientX - containerRect.left,
              y: lastMouseClientY - containerRect.top,
            }
          : {
              x: container.clientWidth / 2,
              y: container.clientHeight / 2,
            };
        requestAnimationFrame(() => {
          container.scrollLeft = imgPoint.x * zoomFactor - screenPoint.x;
          container.scrollTop = imgPoint.y * zoomFactor - screenPoint.y;
        });
      }
    }
    // Send sync to other window
    if (!skipSync) syncViewToOther();
  }

  function syncViewToOther() {
    if (IS_SLAVE && detached) return; // Slave detached: no sync out
    if (suppressSync) return; // avoid loops
    // Proportional scroll (scrollLeft/total, scrollTop/total)
    window.bildvisareAPI.send("sync-view", {
      zoom: zoomFactor,
      x: (container.scrollLeft || 0) / Math.max(1, naturalWidth * zoomFactor),
      y: (container.scrollTop || 0) / Math.max(1, naturalHeight * zoomFactor),
      slave: IS_SLAVE ? 1 : 0,
    });
  }

  window.bildvisareAPI.on("apply-view", ({ zoom, x, y }) => {
    if (IS_SLAVE && detached) return; // ignore sync if detached slave
    suppressSync = true;
    zoomMode = "manual";
    zoomFactor = zoom;
    updateImageDisplay(null, false, true); // skipSync: true (avoid loop)
    // Adjust scroll proportionally
    requestAnimationFrame(() => {
      container.scrollLeft = x * (naturalWidth * zoomFactor);
      container.scrollTop = y * (naturalHeight * zoomFactor);
      suppressSync = false;
    });
  });

  function doZoom(dir) {
    let center =
      zoomMode !== "auto" && lastCursorInImg ? lastCursorPos : getImageCenter();
    if (zoomMode === "auto") {
      zoomFactor = getFitZoomFactor();
      zoomMode = "manual";
    }
    if (dir === "in") {
      zoomFactor = Math.min(zoomFactor * ZOOM_FACTOR_STEP, ZOOM_MAX);
    } else {
      zoomFactor = Math.max(zoomFactor / ZOOM_FACTOR_STEP, ZOOM_MIN);
    }
    updateImageDisplay(center, true);
  }

  // BUG FIX: Removed duplicate variable declaration (already declared at top)

  img.addEventListener("mousemove", (e) => {
    const rect = img.getBoundingClientRect();
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      lastCursorInImg = true;
      lastCursorPos = {
        x: ((e.clientX - rect.left) / rect.width) * img.naturalWidth,
        y: ((e.clientY - rect.top) / rect.height) * img.naturalHeight,
      };
    } else {
      lastCursorInImg = false;
    }
    lastMouseClientX = e.clientX;
    lastMouseClientY = e.clientY;
  });
  img.addEventListener("mouseleave", () => {
    lastCursorInImg = false;
  });
  img.addEventListener("mouseenter", () => {
    lastCursorInImg = true;
  });

  img.onload = function () {
    dlog("img.onload fired, size:", img.naturalWidth, img.naturalHeight);
    naturalWidth = img.naturalWidth;
    naturalHeight = img.naturalHeight;
    updateImageDisplay();
    window.bildvisareAPI.send("bild-visad");
  };

  // PERFORMANCE: Debounce scroll events to avoid excessive IPC
  container.addEventListener("scroll", debounce(() => {
    syncViewToOther();
  }, SCROLL_DEBOUNCE_MS));

  // PERFORMANCE: Debounce resize events
  window.addEventListener("resize", debounce(() => {
    if (zoomMode === "auto") updateImageDisplay();
  }, RESIZE_DEBOUNCE_MS));

  window.addEventListener("keydown", (event) => {
    dlog(
      "KEY:",
      event.key,
      "shift?",
      event.shiftKey,
      "code:",
      event.code,
      "keyCode:",
      event.keyCode,
    );

    if (isZoomInKey(event)) {
      if (!zoomingIn) {
        zoomingIn = true;
        if (zoomTimer) clearInterval(zoomTimer);
        zoomTimer = setInterval(() => {
          doZoom("in");
        }, ZOOM_INTERVAL_MS);
      }
      doZoom("in");
      event.preventDefault();
    } else if (isZoomOutKey(event)) {
      if (!zoomingOut) {
        zoomingOut = true;
        if (zoomTimer) clearInterval(zoomTimer);
        zoomTimer = setInterval(() => {
          doZoom("out");
        }, ZOOM_INTERVAL_MS);
      }
      doZoom("out");
      event.preventDefault();
    } else if (event.key === "=") {
      zoomingIn = false;
      zoomingOut = false;
      if (zoomTimer) clearInterval(zoomTimer);
      zoomTimer = null;
      zoomMode = "manual";
      zoomFactor = 1;
      updateImageDisplay(
        zoomMode !== "auto" && lastCursorInImg
          ? lastCursorPos
          : getImageCenter(),
        true,
      );
      event.preventDefault();
    } else if (event.key.toLowerCase() === "a") {
      zoomMode = "auto";
      updateImageDisplay();
      event.preventDefault();
    } else if (event.key.toLowerCase() === "x" && IS_SLAVE) {
      // Activate/deactivate detachment for slave
      detached = !detached;
      dlog("Slave detachment:", detached);
      // Simple overlay if you want:
      let overlay = document.getElementById("detach-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "detach-overlay";
        overlay.style.position = "fixed";
        overlay.style.top = "10px";
        overlay.style.right = "10px";
        overlay.style.zIndex = 1000;
        overlay.style.background = "rgba(255,0,0,0.75)";
        overlay.style.color = "#fff";
        overlay.style.padding = "6px 16px";
        overlay.style.fontSize = "18px";
        overlay.style.borderRadius = "8px";
        document.body.appendChild(overlay);
      }
      overlay.textContent = detached
        ? "Detached from master"
        : "Synchronized with master";
      overlay.style.display = "block";
      setTimeout(() => {
        if (overlay) overlay.style.display = "none";
      }, 2000);
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (isZoomInKey(event)) {
      zoomingIn = false;
      if (zoomTimer) clearInterval(zoomTimer);
      zoomTimer = null;
    }
    if (isZoomOutKey(event)) {
      zoomingOut = false;
      if (zoomTimer) clearInterval(zoomTimer);
      zoomTimer = null;
    }
  });

  // PERFORMANCE: Use fs.watch via IPC instead of polling
  window.bildvisareAPI.onFileChanged((changedPath) => {
    if (changedPath === bildPath) {
      dlog("Image file changed, reloading:", bildPath);
      img.onload = function () {
        dlog(
          "img.onload after reload, size:",
          img.naturalWidth,
          img.naturalHeight,
        );
        naturalWidth = img.naturalWidth;
        naturalHeight = img.naturalHeight;
        zoomMode = "auto";
        zoomFactor = 1;
        updateImageDisplay();
        window.bildvisareAPI.send("bild-visad");
      };
      // SECURITY FIX: Use file:// protocol for Electron v36+ with contextIsolation
      const fileUrl = bildPath.startsWith('file://') ? bildPath : 'file://' + bildPath;
      img.src = fileUrl + "?t=" + Date.now();
    }
  });

  // Start watching the file
  window.bildvisareAPI.watchFile(bildPath);

  zoomMode = "auto";
  zoomFactor = 1;
  updateImageDisplay();
}
