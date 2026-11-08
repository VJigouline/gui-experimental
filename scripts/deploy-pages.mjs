// Builds the app and publishes it to the gh-pages branch, served by GitHub Pages at
// https://<owner>.github.io/gui-experimental/.
//
//   npm run deploy
//
// The branch holds only the built files. Each deploy adds one commit to it.
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BRANCH = 'gh-pages';
const BASE = '/gui-experimental/';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist', 'gui-experimental', 'browser');

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

if (git(['status', '--porcelain', '--untracked-files=no', '--', 'src', 'public', 'package.json'])) {
  console.warn('Note: src, public or package.json have uncommitted changes; they are included in this deploy.');
}
const source = git(['rev-parse', '--short', 'HEAD']);

// npx is a script on Windows, so the build runs through a shell.
execSync(`npx ng build --base-href ${BASE}`, { cwd: root, stdio: 'inherit' });
// Pages serves 404.html for unknown paths; the app's own router handles them.
copyFileSync(path.join(out, 'index.html'), path.join(out, '404.html'));
// Serve the files as they are, without Jekyll.
writeFileSync(path.join(out, '.nojekyll'), '');

const work = mkdtempSync(path.join(tmpdir(), 'gh-pages-'));
try {
  const remote = git(['remote', 'get-url', 'origin']);
  const exists = git(['ls-remote', '--heads', 'origin', BRANCH]) !== '';
  if (exists) {
    run('git', ['clone', '--quiet', '--depth', '1', '--branch', BRANCH, remote, work]);
  } else {
    run('git', ['init', '--quiet', '-b', BRANCH, work]);
    run('git', ['remote', 'add', 'origin', remote], work);
  }
  for (const name of readdirSync(work)) if (name !== '.git') rmSync(path.join(work, name), { recursive: true, force: true });
  cpSync(out, work, { recursive: true });
  run('git', ['add', '--all'], work);
  if (!git(['status', '--porcelain'], work)) {
    console.log('Nothing changed since the last deploy.');
  } else {
    run('git', ['commit', '--quiet', '-m', `Deploy ${source}`], work);
    run('git', ['push', '--quiet', 'origin', BRANCH], work);
    console.log(`Deployed ${source} to ${BRANCH}.`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
