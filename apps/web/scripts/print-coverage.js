const fs = require('fs');

function print(dir, label) {
  const path = `${dir}/coverage-summary.json`;
  if (!fs.existsSync(path)) {
    console.log(`\n${label}: sem coverage (rode npm run test:e2e:coverage)`);
    return;
  }
  const t = JSON.parse(fs.readFileSync(path, 'utf8')).total;
  console.log(`\n${label}`);
  for (const k of ['lines', 'statements', 'functions', 'branches']) {
    console.log(`  ${k.padEnd(11)} ${String(t[k].pct).padStart(6)}%`);
  }
  console.log(`  relatório:   ${dir}/index.html`);
}

print('coverage', 'Coverage — Cypress E2E');
print('coverage-unit', 'Coverage — Vitest Unit');
