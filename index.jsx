#!/usr/bin/env node
// index.js
// ─────────────────────────────────────────────────
// polyfill for react’s rAF/cAF needs in Node
import 'raf/polyfill';



import React from 'react';
import blessed from 'blessed'
import { render } from 'react-blessed';
import {App} from './App';
import fs from 'fs'
import msg from "blessed/lib/widgets/message";
import Message from "blessed/lib/widgets/message";

const screen = blessed.screen({
  smartCSR: true,
  autoPadding: true,
  title: 'React-Blessed IDE',
  dump: 'terminal-dump.log'
});

// quit on Ctrl+C
screen.key(["C-c", "C-q", 'f12'], () => process.exit(0));
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