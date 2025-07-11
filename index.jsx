#!/usr/bin/env node
// index.js
// ─────────────────────────────────────────────────
// polyfill for react’s rAF/cAF needs in Node
import 'raf/polyfill';



import { render } from 'react-blessed';
import React from 'react';
import {App} from './App';
import blessed from 'blessed'

const screen = blessed.screen({
  smartCSR: true,
  title: 'React-Blessed IDE'
});

// quit on Ctrl+C
screen.key(['C-c'], () => process.exit(0));

render(<App />, screen);