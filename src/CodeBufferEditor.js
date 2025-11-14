import fs from 'fs';
import { getNamedTokenizer, TokenizerToken } from './tokenizer.js';
import { safeStringify } from './util';
import { copy as clipboardCopy, paste as clipboardPaste } from 'copy-paste';

// ────────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ────────────────────────────────────────────────────────────────────────────────
export class Rectangle {
  x = -1; y = -1; w = -1; h = -1;
  /** @param {number} x @param {number} y @param {number} w @param {number} h */
  constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; }
  /** @param {CodeBufferEditor} editor */
  static fromEditor(editor) {
    return new Rectangle(editor.viewportX, editor.viewportY, editor.viewportWidth, editor.viewportHeight);
  }
}

export class CursorPoint {
  x = -1; y = -1; char = '-'; style = {};
  constructor(x, y, char, style) {
    this.x = typeof x === 'number' ? x : -1;
    this.y = typeof y === 'number' ? y : -1;
    this.char = typeof char === 'string' ? char : '-';
    this.style = style || {};
  }
  /** @param {Rectangle} visibleArea */
  isVisible(visibleArea) {
    return (
        this.x >= visibleArea.x && this.x <= (visibleArea.x + visibleArea.w) &&
        this.y >= visibleArea.y && this.y <= (visibleArea.y + visibleArea.h)
    );
  }
  copy() {
    const cp = new CursorPoint();
    cp.x = this.x; cp.y = this.y; cp.char = this.char; cp.style = { ...this.style };
    return cp;
  }
}

export class CodeBufferEditorSelection {
  /** @type {CursorPoint} */ start = new CursorPoint();
  /** @type {CursorPoint} */ end = new CursorPoint();
  /** @param {CursorPoint} start */
  constructor(start) { this.start = start.copy(); }
  /** @param {Rectangle} visibleArea */
  isVisible(visibleArea) { return this.start.isVisible(visibleArea) || this.end.isVisible(visibleArea); }
  /** @param {CursorPoint} val */
  setEnd(val) { this.end = val; return this; }
  copy() { const cp = new CodeBufferEditorSelection(this.start.copy()); cp.setEnd(this.end); return cp; }
}

// ────────────────────────────────────────────────────────────────────────────────
// CodeBufferEditor
// ────────────────────────────────────────────────────────────────────────────────
export class CodeBufferEditor {
  /**
   * @param {string} filePath
   * @param {{rows:number, cols:number}} windowSize
   */
  constructor(filePath, windowSize) {
    this.filePath = filePath;
    this.viewportY = 0; this.viewportX = 0;
    this.viewportHeight = windowSize.rows; this.viewportWidth = windowSize.cols;
    this.lines = [];
    /** @type {{[line:number]:TokenizerToken[]}|TokenizerToken[][]} */
    this.tokens = [];
    this.tokenizer = function (line, lineNumber) { return line.split(' ').flatMap(n => [n, ' ']); };
    this._saveTimeout = 0;
    this._saved = '';

    /** @type {CursorPoint[]} */ this.cursors = [];
    /** @type {CodeBufferEditorSelection | null} */ this.selectStart = null;
    /** @type {CodeBufferEditorSelection[]} */ this.selections = [];

    this.setFilePath(filePath);
  }

  // ── file / tokens ────────────────────────────────────────────────────────────
  setFilePath(filePath) {
    this.filePath = filePath;
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    this.tokenizer = getNamedTokenizer(ext);
    this.lines = fs.readFileSync(filePath, { encoding: 'utf-8' }).split('\n');
    this.updateTokens();
  }

  save() {
    clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      fs.writeFileSync(this.filePath, this.lines.join('\n'));
      this._saved = `saved ${new Date().toISOString()}`;
    }, 1000);
  }

  /** @param {number} lineNumber */
  updateTokensLine(lineNumber) {
    if (lineNumber < 0 || lineNumber >= this.lines.length) return;
    this.tokens[lineNumber] = this.tokenizer(this.lines[lineNumber], lineNumber) || [];
  }

  updateTokens() {
    this.tokens = this.lines.map((line, i) => this.tokenizer(line, i) || []);
  }

  // ── viewport ────────────────────────────────────────────────────────────────
  scrollViewport(n) {
    const maxY = Math.max(0, this.lines.length - this.viewportHeight);
    this.viewportY = clamp(this.viewportY + n, 0, maxY);
  }

  _ensureCursorInView(cursor) {
    if (cursor.y < this.viewportY) this.viewportY = cursor.y;
    else if (cursor.y >= (this.viewportY + this.viewportHeight)) this.viewportY = cursor.y - this.viewportHeight + 1;

    if (cursor.x < this.viewportX) this.viewportX = cursor.x;
    else if (cursor.x >= this.viewportX + this.viewportWidth) this.viewportX = cursor.x - this.viewportWidth + 1;
  }

  _computePadLength() {
    // column with line numbers, similar to original implementation
    return Math.ceil(Math.log10(Math.max(1, this.viewportHeight + this.viewportY))) + 1;
  }

  _screenToCursor(screenEvent, viewportPosition) {
    const { xi, yi } = viewportPosition;
    const pad = this._computePadLength();
    const cx = (screenEvent.x - xi - pad - 3) + this.viewportX; // -3 matches original offsets
    const cy = (screenEvent.y - yi - 1) + this.viewportY;
    return this.getCursor({ x: cx, y: cy });
  }

  // ── token-aware cursor ──────────────────────────────────────────────────────
  /** @returns {CursorPoint} */
  getCursor({ x, y }) {
    const maxY = Math.max(0, this.lines.length - 1);
    y = clamp(parseInt(y ?? 0, 10), 0, maxY);
    const line = this.lines[y] ?? '';
    x = clamp(parseInt(x ?? 0, 10), 0, line.length);

    const crs = new CursorPoint(x, y, line[x] ?? ' ');
    const lineTokens = (this.tokens[y] || []);

    // try to locate token covering x
    const tk = lineTokens.find(t =>
        t && typeof t.start !== 'undefined' && typeof t.end !== 'undefined' && x >= +t.start && x <= +t.end
    );

    crs.style = tk && tk.style ? tk.style : { fg: '#ff0000', bg: '#ffff44' };
    return crs;
  }

  /** @returns {{[lineId:string]:TokenizerToken[]}} */
  renderViewport() {
    const out = {};
    const y0 = this.viewportY, y1 = this.viewportY + this.viewportHeight;
    for (let i = y0; i <= Math.min(y1, this.lines.length - 1); i++) out[i] = this.tokens[i];
    return out;
  }

  // ── mouse ──────────────────────────────────────────────────────────────────
  onMouse(screenEvent, viewportPosition) {
    let hasChanged = false;
    let mustRender = false;
    const clicks = Array.from(screenEvent.buf || []).filter(v => v === 77).length; // wheel granularity

    switch (screenEvent.action) {
      case 'mousedown': {
        const crs = this._screenToCursor(screenEvent, viewportPosition);
        this.selectStart = new CodeBufferEditorSelection(crs);
        this.selectStart.setEnd(crs);
        if (screenEvent.meta) this.cursors.push(crs); else this.cursors = [crs];
        hasChanged = true;
        break;
      }
      case 'mousemove': {
        if (this.selectStart) this.selectStart.setEnd(this._screenToCursor(screenEvent, viewportPosition));
        mustRender = true;
        break;
      }
      case 'mouseup': {
        if (this.selectStart) {
          if (screenEvent.meta) this.selections.push(this.selectStart.copy());
          else this.selections = [this.selectStart.copy()];
        }
        hasChanged = true;
        this.selectStart = null;
        break;
      }
      case 'wheelup': this.scrollViewport(-clicks); mustRender = true; break;
      case 'wheeldown': this.scrollViewport(+clicks); mustRender = true; break;
      default: throw new Error(safeStringify(screenEvent));
    }
    return [hasChanged, mustRender];
  }

  // ── keyboard ───────────────────────────────────────────────────────────────
  onKey(ch, key, onChange = () => { }) {
    let hasChanged = false;
    let mustRender = false;

    const moveAll = fn => { this.cursors = this.cursors.map(crs => fn(crs)); };

    switch (key.full) {
      case 'up': moveAll(crs => this.moveCursorUp(crs)); if (!key.meta) this.selectStart = null; mustRender = true; break;
      case 'down': moveAll(crs => this.moveCursorDown(crs)); if (!key.meta) this.selectStart = null; mustRender = true; break;
      case 'left':
        if (key.ctrl) moveAll(crs => this._wordLeft(crs)); else moveAll(crs => this.moveCursorLeft(crs));
        if (!key.meta) this.selectStart = null; mustRender = true; break;
      case 'right':
        if (key.ctrl) moveAll(crs => this._wordRight(crs)); else moveAll(crs => this.moveCursorRight(crs));
        if (!key.meta) this.selectStart = null; mustRender = true; break;
      case 'home': moveAll(crs => this.getCursor({ x: 0, y: crs.y })); mustRender = true; break;
      case 'end': moveAll(crs => this.getCursor({ x: this.lines[crs.y].length, y: crs.y })); mustRender = true; break;
      case 'pageup': this.scrollViewport(-this.viewportHeight); mustRender = true; break;
      case 'pagedown': this.scrollViewport(+this.viewportHeight); mustRender = true; break;

      case 'backspace': this.cursors.forEach(crs => this.backspace(crs)); hasChanged = true; break;
      case 'delete': this.cursors.forEach(crs => this.delete(crs)); hasChanged = true; break;

      case 'return':
        this._forEachSortedCursor((crs, i) => { crs.y += i; this.insert('\n', crs); crs.y += 1; crs.x = 0; });
        hasChanged = true; break;

      case 'tab':
        this._forEachSortedCursor(crs => { this.insert('\t', crs); });
        hasChanged = true; break;

      case 'C-c': { // copy selection(s)
        const text = this.selections.flatMap(s => {
          const lines = [];
          const y0 = Math.min(s.start.y, s.end.y), y1 = Math.max(s.start.y, s.end.y);
          const x0 = Math.min(s.start.x, s.end.x), x1 = Math.max(s.start.x, s.end.x);
          for (let y = y0; y <= y1; y++) {
            const line = this.lines[y] ?? '';
            const from = (y === y0) ? x0 : 0;
            const to = (y === y1) ? x1 + 1 : line.length;
            lines.push(line.substring(from, to));
          }
          return lines;
        }).join('\n');
        clipboardCopy(text, () => {});
        break;
      }
      case 'C-p': { throw new Error('paste operation not implemented'); }
      default: {
        const printable = (key.sequence && key.sequence.length === 1) ? key.sequence
            : (key.name && key.name.length === 1) ? key.name
                : (ch && ch.length ? ch : '');
        if (printable) { this.cursors.forEach(crs => this.insert(printable, crs)); hasChanged = true; }
      }
    }

    if (hasChanged) this.save();
    return [hasChanged, mustRender];
  }

  _forEachSortedCursor(fn) { this.cursors.toSorted((a, b) => a.y - b.y).forEach(fn); }

  // ── movement ────────────────────────────────────────────────────────────────
  /** @param {CursorPoint} cursor */ moveCursorUp(cursor) {
    if (cursor.y > 0) { cursor.y--; const line = this.lines[cursor.y] ?? ''; cursor.x = Math.min(cursor.x, line.length); this._ensureCursorInView(cursor); }
    return cursor;
  }
  /** @param {CursorPoint} cursor */ moveCursorDown(cursor) {
    if ((cursor.y + 1) < this.lines.length) { const next = this.lines[cursor.y + 1] ?? ''; cursor.x = Math.min(cursor.x, next.length); cursor.y++; this._ensureCursorInView(cursor); }
    return cursor;
  }
  /** @param {CursorPoint} cursor */ moveCursorLeft(cursor) {
    if (cursor.x > 0) { cursor.x--; this._ensureCursorInView(cursor); }
    return cursor;
  }
  /** @param {CursorPoint} cursor */ moveCursorRight(cursor) {
    const line = this.lines[cursor.y] ?? '';
    cursor.x = Math.min(cursor.x + 1, line.length);
    this._ensureCursorInView(cursor);
    return cursor;
  }

  _wordLeft(cursor) {
    const line = this.lines[cursor.y] ?? '';
    let x = cursor.x - 1;
    while (x > 0 && line[x] === ' ') x--;
    while (x > 0 && line[x - 1] && /\w/.test(line[x - 1])) x--;
    cursor.x = clamp(x, 0, line.length);
    this._ensureCursorInView(cursor);
    return cursor;
  }
  _wordRight(cursor) {
    const line = this.lines[cursor.y] ?? '';
    let x = cursor.x;
    while (x < line.length && line[x] === ' ') x++;
    while (x < line.length && /\w/.test(line[x])) x++;
    cursor.x = clamp(x, 0, line.length);
    this._ensureCursorInView(cursor);
    return cursor;
  }

  moveCursorVertically(n, cursor) {
    if (n === 0) return cursor;
    const dir = Math.sign(n);
    for (let i = 0; i < Math.abs(n); i++) {
      if (dir > 0) this.moveCursorDown(cursor); else this.moveCursorUp(cursor);
    }
    return cursor;
  }

  // ── edits ──────────────────────────────────────────────────────────────────
  /** @param {string} text @param {CursorPoint} cursor */
  insert(text, cursor) {
    const line = this.lines[cursor.y] ?? '';
    const before = line.substring(0, cursor.x);
    const after = line.substring(cursor.x);

    const parts = String(text).split('\n');
    if (parts.length === 1) {
      this.lines[cursor.y] = before + parts[0] + after;
      this.updateTokensLine(cursor.y);
      cursor.x += parts[0].length;
    } else {
      const first = before + parts[0];
      const middle = parts.slice(1, -1);
      const last = parts[parts.length - 1] + after;
      const newLines = [first, ...middle, last];
      this.lines.splice(cursor.y, 1, ...newLines);
      for (let i = 0; i < newLines.length; i++) this.updateTokensLine(cursor.y + i);
      cursor.y += (parts.length - 1);
      cursor.x = parts[parts.length - 1].length;
    }
    this._ensureCursorInView(cursor);
    return this;
  }

  /** delete char at cursor, or join with next line if at EOL */
  delete(cursor) {
    const line = this.lines[cursor.y] ?? '';
    if (cursor.x === line.length) {
      if (cursor.y >= this.lines.length - 1) return this; // nothing to join
      const nextLine = this.lines[cursor.y + 1] ?? '';
      this.lines.splice(cursor.y, 2, line + nextLine);
      this.updateTokensLine(cursor.y);
    } else {
      this.lines[cursor.y] = line.substring(0, cursor.x) + line.substring(cursor.x + 1);
      this.updateTokensLine(cursor.y);
      // cursor stays in place
    }
    this._ensureCursorInView(cursor);
    return this;
  }

  backspace(cursor) {
    if (cursor.x > 0) {
      cursor.x--; this.delete(cursor);
    } else if (cursor.y > 0) {
      const prevLen = (this.lines[cursor.y - 1] ?? '').length;
      cursor.y--; cursor.x = prevLen; this.delete(cursor); this.updateTokensLine(cursor.y);
    }
    this._ensureCursorInView(cursor);
    return this;
  }

  // ── clone ──────────────────────────────────────────────────────────────
  /** return a new instance with identical state */
  copy() {
    const clone = new CodeBufferEditor(this.filePath, { rows: this.viewportHeight, cols: this.viewportWidth });
    clone.filePath=this.filePath
    clone.viewportY=this.viewportY
    clone.viewportX=this.viewportX
    clone.lines=this.lines
    clone.cursors=this.cursors
    clone.tokens=this.tokens
    clone.tokenizer=this.tokenizer
    clone.selections=this.selections
    clone.selectStart=this.selectStart
    clone._saved=this._saved
    return clone;
  }

  getStatus() {
    const visible = Object.keys(this.renderViewport());
    const first = visible[0] ?? 0;
    const last = visible[visible.length - 1] ?? 0;
    const json = {
      cursor: this.cursors,
      v: { x: this.viewportX, y: this.viewportY, w: this.viewportWidth, h: this.viewportHeight },
      s: this._saved,
      l: `${first} ... ${last}`,
    };
    return JSON.stringify(json).replace(/"/gi, '');
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// utils
// ────────────────────────────────────────────────────────────────────────────────
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
