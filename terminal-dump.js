const fs = require('fs');
const blessed = require('blessed');

const screen = blessed.screen({ smartCSR: true });
// … build your UI …
screen.render();

// extract plain characters from each cell:
const text = screen.lines
    .map(row => row.map(cell => cell[1]).join(''))
    .join('\n');

// write to disk:
fs.writeFileSync('./terminal-dump.txt', text, 'utf8');
console.log('Buffer saved to screen-text.txt');
