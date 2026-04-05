// Auto-restart wrapper — respawns the bot process if it crashes
import { spawn } from 'child_process';

const MAX_RESTARTS = 100;
const RESTART_DELAY_MS = 5000;

let restarts = 0;

function start() {
  console.log(`[Keepalive] Starting bot (attempt ${restarts + 1})...`);

  const proc = spawn('node', ['--experimental-sqlite', 'src/index.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });

  proc.on('exit', (code, signal) => {
    if (code === 0) {
      console.log('[Keepalive] Bot exited cleanly. Not restarting.');
      process.exit(0);
    }

    restarts++;
    if (restarts >= MAX_RESTARTS) {
      console.error('[Keepalive] Too many restarts. Giving up.');
      process.exit(1);
    }

    const delay = Math.min(RESTART_DELAY_MS * restarts, 60000);
    console.log(`[Keepalive] Bot crashed (code=${code}, signal=${signal}). Restarting in ${delay / 1000}s...`);
    setTimeout(start, delay);
  });

  proc.on('error', (err) => {
    console.error('[Keepalive] Failed to spawn bot:', err.message);
    setTimeout(start, RESTART_DELAY_MS);
  });
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

start();
