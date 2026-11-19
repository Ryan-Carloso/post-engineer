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
