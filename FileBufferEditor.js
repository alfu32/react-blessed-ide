import fs from 'fs';
import { getTokenizer } from './tokenizer.js';

export class FileBufferEditor {
  /**
   * @param {string} filePath
   * @param {{rows:number, cols:number}} windowSize
   */
  constructor(filePath, windowSize) {
    this.filePath        = filePath;
    this.windowRows      = windowSize.rows;
    this.windowCols      = windowSize.cols;
    this.row             = 0;
    this.col             = 0;
    this.windowStartRow  = 0;
    this.windowStartCol  = 0;
    this.cursorStyle     = {};
    this.cursorChar      = '#';
  }

  // ── private ────────────────────────────────────────────────────────────

  _ensureCursorInView() {
    if (this.row < this.windowStartRow) {
      this.windowStartRow = this.row;
    } else if (this.row >= this.windowStartRow + this.windowRows) {
      this.windowStartRow = this.row - this.windowRows + 1;
    }
    if (this.col < this.windowStartCol) {
      this.windowStartCol = this.col;
    } else if (this.col >= this.windowStartCol + this.windowCols) {
      this.windowStartCol = this.col - this.windowCols + 1;
    }
  }

  // compute byte‐offset in file for (row, col)
  _offsetFor(row, col) {
    const content = fs.readFileSync(this.filePath, 'utf8');
    const lines = content.split('\n');
    const head = lines.slice(0, row).join('\n');
    // +1 for the newline if not first line
    const base = head.length + (row > 0 ? 1 : 0);
    // but length is in chars—need bytes
    const headBytes = Buffer.byteLength(head + (row > 0 ? '\n' : ''), 'utf8');
    const colBytes  = Buffer.byteLength(lines[row].slice(0, col), 'utf8');
    return headBytes + colBytes;
  }

  /**
   * @returns {{ rowInWindow: number, colInWindow: number }}
   *   0-based coords of the cursor inside the viewport
   */
  getCursorWindowCoords() {
    return {
      rowInWindow: this.row - this.windowStartRow,
      colInWindow: this.col - this.windowStartCol
    };
  }
  /**
  * @param {(code:string)=>TokenizerToken[]} tokenizer
  * @returns {{[lineNumber:string]:TokenizerToken[]}}
  *
  * */
  render() {
    const ps = this.filePath.split('.')
    const tokenizer = getTokenizer(ps[ps.length-1])
    const fd    = fs.openSync(this.filePath, 'r');
    const stats = fs.statSync(this.filePath);
    const fileSize = stats.size;
  
    // 1) find the byte‐offset at the start of windowStartRow
    let linesFound = 0;
    let offset     = 0;
    const BUF_SZ = 4096;
    const buf    = Buffer.alloc(BUF_SZ);
  
    while (linesFound < this.windowStartRow && offset < fileSize) {
      // console.log({linesFound})
      const bytesRead = fs.readSync(fd, buf, 0, BUF_SZ, offset);
      if (bytesRead === 0) break;       // EOF
      // console.log({bytesRead});
      for (let i = 0; i < bytesRead && linesFound < this.windowStartRow; i++) {
        if (buf[i] === 0x0A) linesFound++;
        offset++;
      }
    }
  
    // 2) now read just enough bytes to cover the onscreen window
    const toRead = this.windowRows * (this.windowCols + 1);
    const winBuf = Buffer.alloc(toRead);
    fs.readSync(fd, winBuf, 0, toRead, offset);
    fs.closeSync(fd);
  
    // 3) split into lines, crop to exactly windowRows,
    //    then apply your tokenizer to the windowCols slice
    const textLines = winBuf
      .toString('utf8')
      .split('\n')
      .slice(0, this.windowRows);
  
    return textLines.reduce((r,line,i) => {
      const lineNumber=i+this.windowStartRow
      // const seg = line.substring(this.windowStartCol, this.windowCols);
      const tokens = tokenizer(line,lineNumber)
        .filter(tk =>{
          return tk.end > this.windowStartCol && tk.start <= (this.windowStartCol + this.windowCols)
        });
      const { rowInWindow:cy, colInWindow:cx } = this.getCursorWindowCoords();

      // 2) if cursor isn’t in view, bail
      // if (
      //   tokens && (
      //     rowInWindow < 0 ||
      //     rowInWindow >= tokens.length ||
      //     colInWindow < 0 ||
      //     colInWindow >= this.windowCols
      //   )
      // ) {
      //   this.cursorStyle=null;
      // }
      // let ln=this.windowStartRow

      // 3) scan tokens to find which one covers colInWindow
      let col = 0;
      for (const tok of tokens) {
        if (cy == lineNumber && cx >= tok.start && cx < tok.end) {
          this.cursorStyle = tok.style;
          this.cursorChar = tok.text[col - cx]
          break
        }
        col += tok.text.length;
      }

      // 4) fallback to last token’s style (e.g. past EOL)
      if(this.cursorStyle==null){
        const last = tokens.slice(-1)[0];
        this.cursorStyle = last ? last.style : {};
        this.cursorChar = last && last.text.length ? last.text[last.text.length-1] : '#';
      }

      r[lineNumber]=tokens
      return r
    },{});
  }

  // full‐buffer rewrite for any edit
  _rewriteAt(offset, removeBytes, insertText) {
    const buf = fs.readFileSync(this.filePath);
    const before = buf.slice(0, offset);
    const after  = buf.slice(offset + removeBytes);
    const inserted = Buffer.from(insertText, 'utf8');
    const out = Buffer.concat([before, inserted, after]);
    fs.writeFileSync(this.filePath, out);
  }

  // ── cursor moves ───────────────────────────────────────────────────────

  moveCursorUp()    { if (this.row>0) { this.row--; this._ensureCursorInView(); } }
  moveCursorDown()  { this.row++; this._ensureCursorInView(); }
  moveCursorLeft()  { if (this.col>0) this.col--; else if(this.row>0){this.row--;this.col=0;} this._ensureCursorInView(); }
  moveCursorRight() { this.col++; this._ensureCursorInView(); }
  moveCursorVertically(n){
    if(n>0){
        for(let i=0;i<n;i++){
            this.moveCursorDown()
        }
    }else if(n<0){
        for(let i=n;i<=0;i++){
            this.moveCursorUp()   
        }
    }
  }
  moveCursorHorizontally(n){
    if(n>0){
        for(let i=0;i<n;i++){
            this.moveCursorRight()
        }
    }else if(n<0){
        for(let i=n;i<=0;i++){
            this.moveCursorLeft()  
        }
    }
  }
  // ── edits ───────────────────────────────────────────────────────────────

  insert(text) {
    const off = this._offsetFor(this.row, this.col);
    this._rewriteAt(off, 0, text);
    const lines = text.split('\n');
    if (lines.length>1) {
      this.row += lines.length-1;
      this.col = lines[lines.length-1].length;
    } else {
      this.col += text.length;
    }
    this._ensureCursorInView();
  }

  delete() {
    const off = this._offsetFor(this.row, this.col);
    this._rewriteAt(off, 1, '');
    this._ensureCursorInView();
  }

  backspace() {
    if (this.col>0) {
      const off = this._offsetFor(this.row, this.col);
      // remove the byte(s) of the previous character
      // approximate: remove 1 char in utf8
      this._rewriteAt(off - Buffer.byteLength('a','utf8'), 1, '');
      this.col--;
    } else if (this.row>0) {
      // join with prev line: delete the '\n'
      const off = this._offsetFor(this.row-1, fs.readFileSync(this.filePath,'utf8')
                                       .split('\n')[this.row-1].length);
      this._rewriteAt(off, 1, '');
      this.row--;
      this.col = Infinity; // will clamp after reading full line next time
    }
    this._ensureCursorInView();
  }
  /**
   * @returns {{ startLine: number, endLine: number }}
   *  both 0‐based; add +1 if you need 1‐based
   */
  getWindowRange() {
    const startLine = this.windowStartRow;
    const endLine   = this.windowStartRow + this.windowRows - 1;
    return { startLine, endLine };
  }

  // ── clone ──────────────────────────────────────────────────────────────

  /** return a new instance with identical state */
  copy() {
    const clone = new FileBufferEditor(this.filePath, {
      rows: this.windowRows,
      cols: this.windowCols
    });
    clone.row            = this.row;
    clone.col            = this.col;
    clone.windowStartRow = this.windowStartRow;
    clone.windowStartCol = this.windowStartCol;
    return clone;
  }
  getStatus(){
    return ` row:${this.row} col:${this.col} `
  }
}