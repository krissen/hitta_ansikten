/**
 * Backend Service Manager
 *
 * Manages the FastAPI backend server lifecycle:
 * - Auto-start on app launch
 * - Health check polling
 * - Graceful shutdown
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const DEBUG = true;

class BackendService {
  constructor() {
    this.process = null;
    this.port = 5000;
    this.host = '127.0.0.1';
    this.maxRetries = 30; // 30 seconds max wait
    this.retryDelay = 1000; // 1 second between retries
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

    console.log('[BackendService] Starting FastAPI backend...');

    // Get paths
    const backendDir = path.join(__dirname, '../../../backend/api');
    const pythonPath = '/Users/krisniem/.local/share/miniforge3/envs/hitta_ansikten/bin/python3';

    // Spawn uvicorn server
    this.process = spawn(
      pythonPath,
      [
        '-m', 'uvicorn',
        'api.server:app',
        '--host', this.host,
        '--port', this.port.toString(),
        '--log-level', 'info'
      ],
      {
        cwd: path.join(__dirname, '../../../backend'),
        env: {
          ...process.env,
          PYTHONPATH: path.join(__dirname, '../../../backend')
        },
        stdio: 'pipe'
      }
    );

    // Forward stdout/stderr to console
    this.process.stdout.on('data', (data) => {
      if (DEBUG) {
        console.log(`[Backend] ${data.toString().trim()}`);
      }
    });

    this.process.stderr.on('data', (data) => {
      console.error(`[Backend] ${data.toString().trim()}`);
    });

    this.process.on('error', (err) => {
      console.error('[BackendService] Failed to start server:', err);
    });

    this.process.on('exit', (code, signal) => {
      console.log(`[BackendService] Server exited (code: ${code}, signal: ${signal})`);
      this.process = null;
    });

    // Wait for server to be ready
    await this.waitForReady();
    console.log('[BackendService] Backend server ready');
  }

  /**
   * Wait for backend server to be ready by polling /health endpoint
   * @returns {Promise<void>}
   */
  async waitForReady() {
    console.log('[BackendService] Waiting for server to be ready...');

    for (let i = 0; i < this.maxRetries; i++) {
      const isHealthy = await this.checkHealth();
      if (isHealthy) {
        console.log(`[BackendService] Server ready after ${i + 1} attempts`);
        return;
      }

      if (DEBUG) {
        console.log(`[BackendService] Health check ${i + 1}/${this.maxRetries} failed, retrying...`);
      }

      // Wait before next retry
      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
    }

    throw new Error('Backend server failed to start within timeout');
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
          timeout: 2000, // Increased timeout
          headers: {
            'Connection': 'close' // Ensure connection closes
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
              if (DEBUG && isHealthy) {
                console.log('[BackendService] Health check successful');
              }
              resolve(isHealthy);
            } catch (err) {
              if (DEBUG) {
                console.log('[BackendService] Health check - invalid JSON:', data);
              }
              resolve(false);
            }
          });
        }
      );

      req.on('error', (err) => {
        if (DEBUG) {
          console.log('[BackendService] Health check error:', err.message);
        }
        resolve(false);
      });

      req.on('timeout', () => {
        if (DEBUG) {
          console.log('[BackendService] Health check timeout');
        }
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

    return new Promise((resolve) => {
      this.process.on('exit', () => {
        console.log('[BackendService] Server stopped');
        this.process = null;
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds if not stopped
      setTimeout(() => {
        if (this.process) {
          console.warn('[BackendService] Force killing server');
          this.process.kill('SIGKILL');
        }
      }, 5000);
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
