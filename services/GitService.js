const util = require('util');
const cp = require('child_process');
const exec = util.promisify(cp.exec);

export async function getStatus(cwd) {
  const { stdout } = await exec('git status --porcelain', { cwd });
  return stdout.split('\n').filter(Boolean);
}