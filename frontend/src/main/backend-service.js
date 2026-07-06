/**
 * Backend Service Manager
 *
 * Manages the FastAPI backend server lifecycle:
 * - Auto-start on app launch
 * - Health check polling
 * - Graceful shutdown
 *
 * In development: Uses system Python with uvicorn
 * In production (packaged): Uses bundled PyInstaller executable
 */

const { spawn } = require('child_process');
const { app } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { t } = require('../i18n');

// Verbose backend logging is opt-in via ANSIKTEN_DEBUG=1 (off in production).
const DEBUG = process.env.ANSIKTEN_DEBUG === '1';

class BackendService {
  constructor() {
    this.process = null;
    this.port = parseInt(process.env.ANSIKTEN_PORT || '5001');
    this.host = '127.0.0.1';
    this.maxRetries = 30;
    this.retryDelay = 1000;
    this.onStatusUpdate = null;
    this.startupLogs = [];
    this.maxLogLines = 80;
    this.startTime = null;
    this.childExited = false;
  }

  _timestamp() {
    if (!this.startTime) return '0.000s';
    return `${((Date.now() - this.startTime) / 1000).toFixed(3)}s`;
  }

  _addLog(line) {
    this.startupLogs.push(`[${this._timestamp()}] ${line}`);
    if (this.startupLogs.length > this.maxLogLines) {
      this.startupLogs.shift();
    }
  }

  _updateStatus(message, progress = null) {
    if (typeof this.onStatusUpdate === 'function') {
      this.onStatusUpdate(message, progress);
    }
  }

  /**
   * Get the path to the backend executable or Python
   * @returns {{ executable: string, args: string[], cwd: string, env: object }}
   */
  getBackendConfig() {
    const isPackaged = app.isPackaged;

    if (isPackaged) {
      // Production: Use bundled PyInstaller directory (--onedir mode for fast startup)
      const resourcesPath = process.resourcesPath;
      const execName = process.platform === 'win32' ? 'ansikten-backend.exe' : 'ansikten-backend';
      const backendDir = path.join(resourcesPath, 'backend');
      const backendPath = path.join(backendDir, execName);

      console.log('[BackendService] Running in packaged mode (onedir)');
      console.log('[BackendService] Backend dir:', backendDir);
      console.log('[BackendService] Backend executable:', backendPath);

      if (!fs.existsSync(backendPath)) {
        throw new Error(`Bundled backend not found at: ${backendPath}`);
      }

      return {
        executable: backendPath,
        args: [
          '--host', this.host,
          '--port', this.port.toString()
        ],
        cwd: backendDir,
        env: {
          ...process.env,
          ANSIKTEN_PORT: this.port.toString()
        }
      };
    } else {
      // Development: Use system Python with uvicorn
      const backendDir = path.join(__dirname, '../../../backend');

      // Try to find Python in common locations (convention-based)
      const venvPython = process.platform === 'win32'
        ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
        : path.join(backendDir, '.venv', 'bin', 'python3');

      const pythonPaths = [
        process.env.ANSIKTEN_PYTHON,  // Custom path via env var
        venvPython,                    // Project venv in backend/.venv
        'python3',                     // System Python
        'python',                      // Fallback
      ].filter(Boolean);

      const { execSync } = require('child_process');
      let pythonPath = null;
      
      for (const p of pythonPaths) {
        try {
          if (p.includes('/')) {
            if (fs.existsSync(p)) {
              pythonPath = p;
              break;
            }
          } else {
            execSync(`which ${p}`, { stdio: 'ignore' });
            pythonPath = p;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!pythonPath) {
        throw new Error('No Python interpreter found. Set ANSIKTEN_PYTHON env var or install python3.');
      }

      console.log('[BackendService] Running in development mode');
      console.log('[BackendService] Python path:', pythonPath);

      const logLevel = process.env.ANSIKTEN_LOG_LEVEL || 'info';
      return {
        executable: pythonPath,
        args: [
          '-m', 'uvicorn',
          'api.server:app',
          '--host', this.host,
          '--port', this.port.toString(),
          '--log-level', logLevel
        ],
        cwd: backendDir,
        env: {
          ...process.env,
          PYTHONPATH: backendDir,
          ANSIKTEN_PORT: this.port.toString(),
          ANSIKTEN_LOG_LEVEL: logLevel
        }
      };
    }
  }

  /**
   * Start the FastAPI backend server
   * @returns {Promise<void>}
   */
  async start() {
    if (this.process) {
      console.log('[BackendService] Server already running');
      return;
    }

    this.startTime = Date.now();
    this.childExited = false;
    this.startupLogs = [];
    
    console.log(`[BackendService] [${this._timestamp()}] Starting FastAPI backend...`);

    const config = this.getBackendConfig();
    this._addLog(`Spawning: ${config.executable} ${config.args.join(' ')}`);

    this.process = spawn(
      config.executable,
      config.args,
      {
        cwd: config.cwd,
        env: { ...config.env, PYTHONUNBUFFERED: '1' },
        stdio: 'pipe'
      }
    );

    this._addLog(`Process spawned with PID ${this.process.pid}`);

    this.process.stdout.on('data', (data) => {
      const output = data.toString().trim();
      this._addLog(`stdout: ${output}`);
      if (DEBUG) {
        if (output.includes('GET /api/statistics/summary') && output.includes('200')) {
          return;
        }
        console.log(`[Backend] ${output}`);
      }
    });

    this.process.stderr.on('data', (data) => {
      const output = data.toString().trim();
      this._addLog(`stderr: ${output}`);
      console.error(`[Backend] ${output}`);
    });

    this.process.on('error', (err) => {
      this._addLog(`Process error: ${err.message}`);
      console.error('[BackendService] Failed to start server:', err);
    });

    this.process.on('exit', (code, signal) => {
      this._addLog(`Process exited: code=${code}, signal=${signal}`);
      console.log(`[BackendService] [${this._timestamp()}] Server exited (code: ${code}, signal: ${signal})`);
      this.childExited = true;
      this.process = null;
    });

    await this.waitForReady();
    console.log(`[BackendService] [${this._timestamp()}] Backend server ready`);
  }

  /**
   * Wait for backend server to be ready by polling /health endpoint
   * @returns {Promise<void>}
   */
  async waitForReady() {
    console.log(`[BackendService] [${this._timestamp()}] Starting health check polling...`);
    this._updateStatus(t('dialogs.splash.initializingPython'), 10);

    // Poll immediately, then retry. The backend takes time to boot, so early
    // ECONNREFUSED is expected and swallowed quietly by checkHealth().
    for (let i = 0; i < this.maxRetries; i++) {
      if (this.childExited) {
        const logs = this.startupLogs.slice(-20).join('\n');
        throw new Error(`Backend process exited during startup.\n\nLast logs:\n${logs}`);
      }

      const isHealthy = await this.checkHealth();
      if (isHealthy) {
        console.log(`[BackendService] [${this._timestamp()}] Backend ready after ${i + 1} attempts`);
        this._updateStatus(t('dialogs.splash.serverReady'), 80);
        return;
      }

      const progress = Math.min(10 + (i / this.maxRetries) * 60, 70);
      if (i === 0) {
        this._updateStatus(t('dialogs.splash.loadingModules'), progress);
      } else if (i === 3) {
        this._updateStatus(t('dialogs.splash.startingApi'), progress);
      } else if (i === 6) {
        this._updateStatus(t('dialogs.splash.startingWebServer'), progress);
      } else if (i > 10) {
        this._updateStatus(t('dialogs.splash.waitingForBackend', { current: i, total: this.maxRetries }), progress);
      }

      if (DEBUG && i > 0 && i % 5 === 0) {
        console.log(`[BackendService] [${this._timestamp()}] Health check attempt ${i}/${this.maxRetries}`);
      }

      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
    }

    const logs = this.startupLogs.slice(-20).join('\n');
    throw new Error(`Backend server failed to start within ${this.maxRetries}s timeout.\n\nLast logs:\n${logs}`);
  }

  /**
   * Check if backend server is healthy
   * @returns {Promise<boolean>}
   */
  checkHealth() {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: this.host,
          port: this.port,
          path: '/health',
          method: 'GET',
          timeout: 2000,
          headers: {
            'Connection': 'close'
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const isHealthy = json.status === 'ok';
              resolve(isHealthy);
            } catch (err) {
              resolve(false);
            }
          });
        }
      );

      req.on('error', (err) => {
        if (DEBUG && err.code !== 'ECONNREFUSED') {
          console.log(`[BackendService] [${this._timestamp()}] Health check error: ${err.message}`);
        }
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * Stop the backend server gracefully
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.process) {
      console.log('[BackendService] Server not running');
      return;
    }

    console.log('[BackendService] Stopping backend server...');

    // Capture the handle now: start()'s exit handler nulls this.process, so the
    // force-kill closure below must not read this.process (it may be null by then).
    const proc = this.process;

    return new Promise((resolve) => {
      // Force kill after 5 seconds if graceful shutdown did not complete.
      const forceKillTimer = setTimeout(() => {
        console.warn('[BackendService] Force killing server');
        proc.kill('SIGKILL');
      }, 5000);
      // Don't let the pending timer keep the Electron main process alive on quit.
      forceKillTimer.unref();

      proc.on('exit', () => {
        clearTimeout(forceKillTimer);
        console.log('[BackendService] Server stopped');
        this.process = null;
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      proc.kill('SIGTERM');
    });
  }

  /**
   * Get backend server URL
   * @returns {string}
   */
  getUrl() {
    return `http://${this.host}:${this.port}`;
  }
}

module.exports = { BackendService };
