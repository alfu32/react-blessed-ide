import fs from 'fs';
import { getTokenizer,TokenizerToken } from './tokenizer.js';

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
    this.cursorY             = 0;
    this.cursorX             = 0;
    this.cursorStyle     = {};
    this.cursorChar      = '#';
    this.lines           = [];
    this._to             = 0
    this._saved           = ''
    this.setFilePath(filePath)
  }
  setFilePath(filePath){
    this.filePath        = filePath;
    this.lines=fs.readFileSync(filePath,{encoding:'utf-8'}).split('\n')
    this.updateTokens()
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
    if (this.cursorY < this.windowStartRow) {
      this.windowStartRow = this.cursorY;
    } else if (this.cursorY >= (this.windowStartRow + this.windowRows)) {
      this.windowStartRow = this.cursorY - this.windowRows;
    }
    if (this.cursorX < this.windowStartCol) {
      this.windowStartCol = this.cursorX;
    } else if (this.cursorX >= this.windowStartCol + this.windowCols) {
      this.windowStartCol = this.cursorX - this.windowCols;
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
      y: this.cursorY - this.windowStartRow,
      x: this.cursorX - this.windowStartCol
    };
  }
  updateTokens(){
    const ps = this.filePath.split('.')
    const tokenizer = getTokenizer(ps[ps.length-1])

    this.tokens=this.lines.reduce((r,line,lineNumber) => {
      // const seg = line.substring(this.windowStartCol, this.windowCols);
      const tokens = tokenizer(line,lineNumber)
      r[lineNumber]=tokens
      return r
    },{});
  }
  /**
  * @param {(code:string)=>TokenizerToken[]} tokenizer
  * @returns {{[lineNumber:string]:TokenizerToken[]}}
  *
  * */
  render() {
    return Object.keys(this.tokens).reduce(
      (visible,lineNumber) => {

        if(parseInt(lineNumber)>=this.windowStartRow && parseInt(lineNumber)<(this.windowStartRow+this.windowRows)){
          visible[lineNumber]=this.tokens[lineNumber]

          const tokens = this.tokens[lineNumber]

          // 3) scan tokens to find which one covers colInWindow
          let col = 0;
          if (this.cursorY == lineNumber) {
            this.cursorChar = ' '
            for (const tok of tokens) {
              if( this.cursorX >= tok.start && this.cursorX < tok.end) {
                this.cursorStyle = tok.style;
                this.cursorChar = (this.lines[lineNumber]||" ")[this.cursorX]||' '
                break
              }
              col += tok.text.length;
            }
          }

          // 4) fallback to last token’s style (e.g. past EOL)
          if(this.cursorStyle==null){
            const last = tokens.slice(-1)[0];
            this.cursorStyle = last ? last.style : {};
            this.cursorChar = last && last.text.length ? last.text[last.text.length-1] : '#';
          }
        }
        return visible
      },
      {}
    )
  }

  // ── cursor moves ───────────────────────────────────────────────────────

  moveCursorUp()    { if (this.cursorY>0) { this.cursorY--;if(this.cursorX>=this.lines[this.cursorY].length){this.cursorX=this.lines[this.cursorY].length};  this._ensureCursorInView(); } }
  moveCursorDown()  { if (this.cursorY<this.lines.length) { this.cursorY++;if(this.cursorX>=this.lines[this.cursorY].length){this.cursorX=this.lines[this.cursorY].length}; this._ensureCursorInView(); } }
  moveCursorLeft()  { if (this.cursorX>0) { this.cursorX--; this._ensureCursorInView(); } }
  moveCursorRight() { if(this.cursorX<this.lines[this.cursorY].length) {this.cursorX++}else{this.cursorX=this.lines[this.cursorY].length}; this._ensureCursorInView();}
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
    const oldLine=this.lines[this.cursorY]
    const before=oldLine.substring(0,this.cursorX)
    const after=oldLine.substring(this.cursorX)
    const newLine=before+text+after
    let newLines=this.lines.slice(0,this.cursorY)
    let oldLinesAfter=this.lines.slice(this.cursorY+1)
    this.lines=newLines.concat(newLine.split('\n')).concat(oldLinesAfter)
    this.cursorX++
    this._ensureCursorInView();
    return this
  }

  delete() {
    const oldLine=this.lines[this.cursorY]
    const before=oldLine.substring(0,this.cursorX-1)
    const after=oldLine.substring(this.cursorX+1)
    const newLine=before+after
    let newLines=this.lines.slice(0,this.cursorY)
    let oldLinesAfter=this.lines.slice(this.cursorY+1)
    this.lines=newLines.concat(newLine.split('\n')).concat(oldLinesAfter)
    this._ensureCursorInView();
    return this
  }

  backspace() {
    if (this.cursorX>0) {
      this.delete()
      this.cursorX--;
    } else if (this.cursorY>0) {
      const newCol=this.lines[this.cursorY-1].length
      this.delete()
      this.cursorY--;
      this.cursorX = newCol; // will clamp after reading full line next time
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
    clone.cursorY            = this.cursorY;
    clone.cursorX            = this.cursorX;
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
    return ` row:${this.cursorY} col:${this.cursorX} ${this._saved}`
  }
}