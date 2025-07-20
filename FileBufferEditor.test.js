import { FileBufferEditor } from './services/FileBufferEditor.js';
import { getTokenizer } from './tokenizer.js'


// simple ANSI color map

const ANSI = {
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m',
};


/**
* Render a “window” of lines to the console.
*
* @param {Record<number, TokenizerToken[]>} tokensByLine
* e.g. { 38: [ ...tokens ], 39: [ ...tokens ] }
*/
function renderConsole(lines) {
  lines.forEach(({ lineNumber, tokens }) => {
      const lineText = tokens.map(tok => {
        const color = ANSI[tok.style.fg] || '';
        return color + tok.text + ANSI.reset;
      }).join('');
      console.log(`${String(lineNumber).padStart(3,'0')}| ${lineText}`);
    });
}


const myTokenizer = getTokenizer('jsx')

const editor = new FileBufferEditor('CodeEditor.jsx', { rows: 40, cols: 120 });
editor.moveCursorVertically(40);
console.log('moved cursor')

// “Which lines are we seeing?”
const { startLine, endLine } = editor.getWindowRange();
console.log(`Showing file lines ${startLine} through ${endLine}`);


// Or, if you want both tokens *and* numbers in one shot:
const lines = editor.renderWithLineNumbers(myTokenizer);
// lines.forEach(({ lineNumber, tokens }) => {
//   console.log(`${lineNumber}:`, tokens);
// });
console.log('tokenizer finished')

renderConsole(lines);