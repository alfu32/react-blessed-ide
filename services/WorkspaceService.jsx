// services/WorkspaceService.js
import {promises as fs} from 'fs';
import path from 'path';


export async function getTree(dir) {
  const name = path.basename(dir);
  const children = await Promise.all(
    (await fs.readdir(dir, { withFileTypes: true })).map(async d => {
      const fullPath = path.join(dir, d.name);
      if (d.isDirectory()) {
        return { name: d.name, children: (await getTree(fullPath)).children, fullPath };
      } else {
        return { name: d.name, fullPath };
      }
    })
  );
  return { name, extended: true, children };
}

export async function readFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

