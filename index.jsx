#!/usr/bin/env node
import 'raf/polyfill';
import blessed from 'neo-blessed'
import { render } from 'react-blessed';
import {App} from './src/App';
import fs from 'fs'
import "neo-blessed/lib/widgets/node";       // literal path so tree-shaker keeps it
import "neo-blessed/lib/widgets/element";    // add others if your code reaches them
import "neo-blessed/lib/widgets/screen";       // literal path so tree-shaker keeps it
import "neo-blessed/lib/blessed";    // add others if your code reaches them
import version from './version.json'

const screen = blessed.screen({
  smartCSR: true,
  autoPadding: true,
  title: `EDY v${version.tag} (${version.branch}${version.commit.substring(0,8)}) t ${version.time}`,
  dump: 'terminal-dump.log'
});

// quit on Ctrl+C // 
screen.key(["C-q", 'f12'], () => process.exit(0));
screen.key(["C-s", "C-S-s", 'f8'], () => {
  // after you’ve created your screen…
  const dump = screen.screenshot();      // whole screen
// or limit to a region: screenshot(x1, x2, y1, y2)
  fs.writeFileSync('buffer.sgr', dump, 'utf8');
  console.log('Wrote SGR dump to buffer.sgr');
  // new Message().display('Buffer saved!', 1, () => screen.render());
});
screen.enableMouse()

render(<App />, screen);