const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const ENTRYPOINT_PATH = path.join(SERVER_ROOT, 'index.js');
const STARTED_AT_ISO = new Date().toISOString();

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function runGit(args) {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (_error) {
    return null;
  }
}

function getGitMetadata() {
  const commit = runGit(['rev-parse', '--short', 'HEAD']);
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirtyOutput = runGit(['status', '--short', '--untracked-files=no']);

  return {
    commit: commit || 'unknown',
    branch: branch || 'unknown',
    dirty: dirtyOutput ? 'yes' : 'no'
  };
}

function getRuntimeMetadata(config = {}) {
  const packageJson = readJson(path.join(SERVER_ROOT, 'package.json'));
  const git = getGitMetadata();

  return {
    serverName: config.SERVER_NAME || packageJson?.name || 'office-mcp',
    serverVersion: config.SERVER_VERSION || packageJson?.version || 'unknown',
    packageVersion: packageJson?.version || 'unknown',
    entrypoint: ENTRYPOINT_PATH,
    serverRoot: SERVER_ROOT,
    repoRoot: REPO_ROOT,
    pid: process.pid,
    nodeVersion: process.version,
    transportType: config.TRANSPORT_TYPE || process.env.TRANSPORT_TYPE || 'unknown',
    serviceMode: String(Boolean(config.SERVICE_MODE)),
    testMode: String(Boolean(config.USE_TEST_MODE)),
    startedAt: STARTED_AT_ISO,
    git
  };
}

function formatRuntimeMetadataText(metadata) {
  return [
    `Server: ${metadata.serverName}`,
    `Version: ${metadata.serverVersion}`,
    `Git commit: ${metadata.git.commit}`,
    `Git branch: ${metadata.git.branch}`,
    `Dirty worktree: ${metadata.git.dirty}`,
    `Started at: ${metadata.startedAt}`,
    `PID: ${metadata.pid}`,
    `Node: ${metadata.nodeVersion}`,
    `Transport: ${metadata.transportType}`,
    `Service mode: ${metadata.serviceMode}`,
    `Test mode: ${metadata.testMode}`,
    `Entrypoint: ${metadata.entrypoint}`,
    `Repo root: ${metadata.repoRoot}`
  ].join('\n');
}

module.exports = {
  ENTRYPOINT_PATH,
  REPO_ROOT,
  SERVER_ROOT,
  STARTED_AT_ISO,
  formatRuntimeMetadataText,
  getRuntimeMetadata
};
