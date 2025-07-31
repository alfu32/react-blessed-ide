const util = require('util');
const cp = require('child_process');
const exec = util.promisify(cp.exec);

export async function getStatus(cwd) {
  const { stdout } = await exec(`git status --porcelain`, { cwd });
  return stdout.split('\n').filter(Boolean);
}
export async function getCommits(cwd) {
  const { stdout } = await exec(`git log --pretty=format:"%h %s" --abbrev=8 | tee`, { cwd });
  return stdout.split('\n').filter(Boolean);
}
export async function getBranch(cwd) {
  const { stdout } = await exec(`git branch --show-current`, { cwd });
  return stdout.split('\n').filter(Boolean);
}
export async function getCurrentTag(cwd) {
  const { stdout } = await exec(`git describe --tags --exact-match 2>/dev/null || echo "none"`, { cwd });
  return stdout.split('\n').filter(Boolean);
}
export async function getRemotes(cwd) {
  const { stdout } = await exec(`git remote -v`, { cwd });
  return stdout.split('\n').filter(Boolean);
}
export async function gitStage(cwd, filePath) {
  const { stdout } = await exec(`git add -f "${filePath}"`, { cwd });
  return stdout.split('\n').filter(Boolean);
}
export async function gitUnstage(cwd, filePath) {
  const { stdout } = await exec(`git restore --staged "${filePath}"`, { cwd });
  return stdout.split('\n').filter(Boolean);
}
export async function gitCommit(cwd,commitMessage) {
  const { stdout } = await exec(`git commit -m "${commitMessage}"`, { cwd });
  return stdout.split('\n').filter(Boolean);
}
export async function gitPush(cwd,remote,branch) {
  const { stdout } = await exec(`git push ${remote} ${branch}`, { cwd });
  return stdout.split('\n').filter(Boolean);
}