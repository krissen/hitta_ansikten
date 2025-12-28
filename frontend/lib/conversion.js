// lib/conversion.js
// NEF to JPG conversion module

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// Configuration
const MIN_JPG_SIZE = 50 * 1024; // 50KB minimum for converted JPG
const JPG_READY_CHECK_INTERVAL_MS = 100; // Check every 100ms if JPG is ready
const JPG_READY_MAX_RETRIES = 20; // Max 20 retries (2 seconds total)

// Default Python interpreter path (can be overridden)
let pythonPath = "/Users/krisniem/.local/share/miniforge3/envs/hitta_ansikten/bin/python3";

/**
 * Sets the Python interpreter path for NEF conversion.
 * @param {string} newPath - Path to Python interpreter
 */
function setPythonPath(newPath) {
  pythonPath = newPath;
}

/**
 * Converts a Nikon NEF (RAW) file to JPEG format.
 * Uses external Python script (nef2jpg.py) for conversion.
 *
 * @param {string} nefPath - Path to input NEF file
 * @param {string} outJpg - Path to output JPEG file
 * @param {Function} cb - Callback(error, outputPath)
 * @param {Object} logger - Logger object with error/warn/debug methods
 */
function convertNEFtoJPG(nefPath, outJpg, cb, logger = console) {
  // Check if JPG already exists and is newer than NEF
  if (fs.existsSync(outJpg)) {
    const nefTime = fs.statSync(nefPath).mtimeMs;
    const jpgTime = fs.statSync(outJpg).mtimeMs;
    if (jpgTime > nefTime) {
      return cb(null, outJpg); // Already exists, return file path!
    }
  }

  // Start conversion
  const scriptPath = path.join(__dirname, "..", "scripts", "nef2jpg.py");

  // ERROR HANDLING: Check if conversion script exists
  if (!fs.existsSync(scriptPath)) {
    logger.error("Conversion script not found:", scriptPath);
    return cb(new Error("Conversion script not found: " + scriptPath), null);
  }

  // ERROR HANDLING: Check if Python interpreter exists
  if (!fs.existsSync(pythonPath)) {
    logger.error("Python interpreter not found:", pythonPath);
    return cb(new Error("Python interpreter not found: " + pythonPath), null);
  }

  const child = spawn(pythonPath, [scriptPath, nefPath, outJpg], {
    stdio: "ignore",
  });

  // ERROR HANDLING: Handle spawn errors
  child.on("error", (err) => {
    logger.error("Failed to spawn conversion process:", err);
    cb(new Error("Failed to start conversion: " + err.message), null);
  });

  child.on("exit", (code) => {
    if (code === 0) {
      cb(null, outJpg); // Success: return output file!
    } else {
      logger.error("Conversion failed with exit code:", code);
      cb(new Error("Conversion failed with exit code " + code), null);
    }
  });
}

/**
 * Waits for JPG file to be ready after conversion.
 * Checks file size until it exceeds minimum threshold.
 *
 * @param {string} outJpg - Path to output JPG file
 * @param {Function} onReady - Callback when file is ready
 * @param {Function} onError - Callback on timeout/error
 * @param {Object} logger - Logger object
 * @param {number} retries - Current retry count (internal)
 */
function waitForJPGReady(outJpg, onReady, onError, logger = console, retries = 0) {
  fs.stat(outJpg, (err, stats) => {
    if (!err && stats.size > MIN_JPG_SIZE) {
      onReady();
    } else if (retries < JPG_READY_MAX_RETRIES) {
      setTimeout(() => waitForJPGReady(outJpg, onReady, onError, logger, retries + 1), JPG_READY_CHECK_INTERVAL_MS);
    } else {
      logger.debug("JPG file never became ready to open.");
      onError("JPG file never became ready to open.");
    }
  });
}

/**
 * Ensures JPG exists (converts from NEF if needed) and launches slave viewer.
 * Shows wait overlay during conversion.
 *
 * @param {Object} status - Status object with source_nef and exported_jpg
 * @param {Object} mainWindow - Main BrowserWindow instance
 * @param {Function} launchSlaveViewer - Function to launch slave viewer
 * @param {Object} logger - Logger object
 */
function ensureJPGAndLaunchSlave(status, mainWindow, launchSlaveViewer, logger = console) {
  let nef = status.source_nef;
  let jpg = status.exported_jpg;

  if (!nef) {
    logger.debug("No source_nef in status.json!");
    return;
  }

  if (!jpg) {
    const nefBase = path.basename(nef, path.extname(nef));
    jpg = `/tmp/${nefBase}_converted.jpg`;
  }

  if (
    fs.existsSync(jpg) &&
    fs.statSync(jpg).mtimeMs > fs.statSync(nef).mtimeMs
  ) {
    launchSlaveViewer(jpg);
    return;
  }

  // Show wait overlay
  if (mainWindow) mainWindow.webContents.send("show-wait-overlay");

  logger.debug("Converting NEF to JPG:", nef, "→", jpg);

  convertNEFtoJPG(nef, jpg, (err, outJpg) => {
    if (err || !outJpg) {
      // Hide wait overlay
      if (mainWindow) mainWindow.webContents.send("hide-wait-overlay");
      logger.debug("Could not convert NEF:", err);
      if (mainWindow) {
        mainWindow.webContents.send("show-wait-overlay", "Error during export!");
      }
      return;
    }

    waitForJPGReady(
      outJpg,
      () => {
        // Success callback
        if (mainWindow) mainWindow.webContents.send("hide-wait-overlay");
        launchSlaveViewer(outJpg);
      },
      (errorMsg) => {
        // Error callback
        if (mainWindow) mainWindow.webContents.send("hide-wait-overlay");
        if (mainWindow) {
          mainWindow.webContents.send("show-wait-overlay", "Error: could not open export!");
        }
      },
      logger
    );
  }, logger);
}

module.exports = {
  convertNEFtoJPG,
  ensureJPGAndLaunchSlave,
  setPythonPath,
};
