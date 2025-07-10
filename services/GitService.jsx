// services/GitService.js
import util from 'util';
import cp from 'child_process';


  const pExec = util.promisify(cp.exec);

  export async function getStatus(cwd) {
    const { stdout } = await pExec('git status --porcelain', { cwd });
    return stdout.split('\n').filter(Boolean);
  }
