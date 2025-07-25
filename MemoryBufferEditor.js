import fs from 'fs';
import { getTokenizer } from './tokenizer.js';

export class MemoryBufferEditor {
  /**
   * @param {string} filePath
   * @param {{rows:number, cols:number}} windowSize
   */
  constructor(filePath, windowSize) {
    this.filePath        = filePath;
    this.windowStartRow  = 0;
    this.windowStartCol  = 0;
    this.windowRows      = windowSize.rows;
    this.windowCols      = windowSize.cols;
    this.row             = 0;
    this.col             = 0;
    this.cursorStyle     = {};
    this.cursorChar      = '#';
    this.lines           = []
    this._to             = 0
    this._saved           = ''
    this.setFilePath(filePath)
  }
  setFilePath(filePath){
    this.filePath        = filePath;
    this.lines=fs.readFileSync(filePath,{encoding:'utf-8'}).split('\n')
  }
  save(){
    clearTimeout(this._to)
    this._to = setTimeout(()=>{
      fs.writeFileSync(this.filePath,this.lines.join('\n'))
      this._saved = `saved ${new Date().toISOString()}`
    },1000)
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
    let offsetStart=0
    let offsetEnd=0
    for(let i=0;i<this.lines.length;i++){
      const line=this.lines[i]
      offsetStart=offsetEnd
      offsetEnd=offsetEnd+line.length+1
      if(i==row){
        if(col<=line.length){
          return offsetStart+col
        }else{
          return offsetEnd
        }
      }
    }
    return offsetEnd
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
  
    return this.lines.slice(this.windowStartRow,this.windowStartRow+this.windowRows)
      .reduce((r,line,i) => {
        const lineNumber=i+this.windowStartRow
        // const seg = line.substring(this.windowStartCol, this.windowCols);
        const tokens = tokenizer(line,lineNumber)
          .filter(tk =>{
            return tk.end > this.windowStartCol && tk.start <= (this.windowStartCol + this.windowCols)
          });
        const { rowInWindow:cy, colInWindow:cx } = this.getCursorWindowCoords();
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
    const oldLine=this.lines[this.row]
    const before=oldLine.substring(0,this.col)
    const after=oldLine.substring(this.col)
    const newLine=before+text+after
    let newLines=this.lines.slice(0,this.row)
    let oldLinesAfter=this.lines.slice(this.row+1)
    this.lines=newLines.concat(newLine.split('\n')).concat(oldLinesAfter)
    this.col++
    this._ensureCursorInView();
    return this
  }

  delete() {
    const oldLine=this.lines[this.row]
    const before=oldLine.substring(0,this.col-1)
    const after=oldLine.substring(this.col+1)
    const newLine=before+after
    let newLines=this.lines.slice(0,this.row)
    let oldLinesAfter=this.lines.slice(this.row+1)
    this.lines=newLines.concat(newLine.split('\n')).concat(oldLinesAfter)
    this._ensureCursorInView();
    return this
  }

  backspace() {
    if (this.col>0) {
      this.delete()
      this.col--;
    } else if (this.row>0) {
      const newCol=this.lines[this.row-1].length
      this.delete()
      this.row--;
      this.col = newCol; // will clamp after reading full line next time
    }
    this._ensureCursorInView();
    return this
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
    const clone = new MemoryBufferEditor(this.filePath, {
      rows: this.windowRows,
      cols: this.windowCols
    });
    clone.row            = this.row;
    clone.col            = this.col;
    clone.windowStartRow = this.windowStartRow;
    clone.windowStartCol = this.windowStartCol;
    clone.cursorStyle    = this.cursorStyle
    clone.cursorChar     = this.cursorChar
    clone.lines          = this.lines
    clone._to            = this._to
    clone._saved         = this._saved
    return clone;
  }
  getStatus(){
    return ` row:${this.row} col:${this.col} ${this._saved}`
  }
}