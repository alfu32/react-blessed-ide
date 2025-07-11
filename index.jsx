#!/usr/bin/env node
// index.js
// ─────────────────────────────────────────────────
// polyfill for react’s rAF/cAF needs in Node
import 'raf/polyfill';



import React from 'react';
import blessed from 'blessed'
import { render } from 'react-blessed';
import {App} from './App';

const screen = blessed.screen({
  smartCSR: true,
  autoPadding: true,
  title: 'React-Blessed IDE'
});

// quit on Ctrl+C
screen.key(["C-c", "C-q", 'f12'], () => process.exit(0));

render(<App />, screen);