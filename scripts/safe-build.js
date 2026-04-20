#!/usr/bin/env node
// Wraps osmosfeed. If a feed fails XML parsing (which crashes osmosfeed),
// strips the broken feed(s) from the config and retries once.
// The original osmosfeed.yaml is always restored afterward.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OSMOSFEED_BIN = path.resolve(__dirname, '../node_modules/@osmoscraft/osmosfeed/bin/main.js');
const YAML_PATH = path.resolve(__dirname, '../osmosfeed.yaml');

function runOsmosfeed() {
  return spawnSync('node', [OSMOSFEED_BIN], {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
}

const originalYaml = fs.readFileSync(YAML_PATH, 'utf8');
let exitCode = 0;

try {
  let result = runOsmosfeed();
  process.stdout.write(result.stdout || '');

  if (result.status !== 0) {
    const failPattern = /\[enrich\] Parse source failed (.+)/g;
    const failedFeeds = [];
    let match;
    while ((match = failPattern.exec(result.stdout || '')) !== null) {
      failedFeeds.push(match[1].trim());
    }

    if (failedFeeds.length > 0) {
      console.log(`\n[safe-build] ${failedFeeds.length} feed(s) crashed the XML parser. Retrying without them:`);
      failedFeeds.forEach(url => console.log(`  skipped: ${url}`));

      let patched = originalYaml;
      for (const url of failedFeeds) {
        const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        patched = patched
          .split('\n')
          .filter(line => !line.match(new RegExp(`^\\s*-\\s*href:\\s*${escaped}\\s*$`)))
          .join('\n');
      }
      fs.writeFileSync(YAML_PATH, patched);

      result = runOsmosfeed();
      process.stdout.write(result.stdout || '');
    }

    exitCode = result.status || 1;
  }
} finally {
  fs.writeFileSync(YAML_PATH, originalYaml);
}

process.exit(exitCode);
