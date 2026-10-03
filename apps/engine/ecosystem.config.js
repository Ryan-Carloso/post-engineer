/**
 * PM2 process definition for the Post Engineer API.
 *
 * The automatic fill schedule runs IN-PROCESS inside the engine (thread
 * "fill-schedule-scheduler", started with the app when the Supabase env
 * vars are present) — there is no external cron/scheduler anymore.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 logs mpt-api
 */
module.exports = {
  apps: [
    {
      name: "mpt-api",
      interpreter: process.env.MPT_PYTHON || "uv",
      interpreter_args: "run python",
      script: "main.py",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {},
    },
  ],
};
