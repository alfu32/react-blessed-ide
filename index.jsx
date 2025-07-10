
import { render } from 'react-blessed';
import React from 'react';
import {App} from './App';
import blessed from 'blessed'

const screen = blessed.screen({
  smartCSR: true,
  title: 'React-Blessed IDE'
});

render(<App />, screen);