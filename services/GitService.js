const util = require('util');
const cp = require('child_process');
const exec = util.promisify(cp.exec);

export async function getStatus(cwd) {
  const { stdout } = await exec(`git status --porcelain`, { cwd });
  return stdout.split('\n').filter(Boolean);
}
export async function getCommits(cwd) {
  const { stdout } = await exec(`git log --pretty=format:"%h %s" --abbrev=40 | tee`, { cwd });
  const lines = stdout.split('\n').filter(Boolean)
  return await Promise.all(lines.map(async v => {
    const tk=v.split(/\s/gi)
    const id = v.substring(0,40)
    const message = v.substring(41)
    const { stdout:tags } = await exec(`git tag --points-at ${id}`, { cwd });
    return `${id.substring(0,8)}│${(tags?tags.trim("\n"):"").padEnd(9,' ')}│${message.trim("\n")}`
    // return `${id.substring(0,8)} ${message}`
  }));
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
export async function getTags(cwd) {
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