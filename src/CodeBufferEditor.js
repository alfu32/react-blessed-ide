import fs from 'fs';
import { getTokenizer,TokenizerToken } from './tokenizer.js';

export class CodeBufferEditor {
  /**
   * @param {string} filePath
   * @param {{rows:number, cols:number}} windowSize
   */
  constructor(filePath, windowSize) {
    this.filePath        = filePath;
    this.viewportY  = 0;
    this.viewportX  = 0;
    this.viewportHeight      = windowSize.rows;
    this.viewportWidth      = windowSize.cols;
    this.cursorY             = 0;
    this.cursorX             = 0;
    this.cursorStyle     = {};
    this.cursorChar      = '_';
    this.lines           = [];
    this._tout000             = 0
    this._saved           = ''
    this.setFilePath(filePath)
  }
  setFilePath(filePath){
    this.filePath        = filePath;
    this.lines=fs.readFileSync(filePath,{encoding:'utf-8'}).split('\n')
    this.updateTokens()
    this.updateCursor()
  }
  save(){
    clearTimeout(this._tout000)
    this._tout000 = setTimeout(()=>{
      fs.writeFileSync(this.filePath,this.lines.join('\n'))
      this._saved = `saved ${new Date().toISOString()}`
    },1000)
  }

  // ── private ────────────────────────────────────────────────────────────

  _ensureCursorInView() {
    if (this.cursorY < this.viewportY) {
      this.viewportY = this.cursorY;
    } else if (this.cursorY >= (this.viewportY + this.viewportHeight)) {
      this.viewportY = this.cursorY - this.viewportHeight;
    }
    if (this.cursorX < this.viewportX) {
      this.viewportX = this.cursorX;
    } else if (this.cursorX >= this.viewportX + this.viewportWidth) {
      this.viewportX = this.cursorX - this.viewportWidth;
    }
  }

  /**
   * @returns {{ rowInWindow: number, colInWindow: number }}
   *   0-based coords of the cursor inside the viewport
   */
  getCursorWindowCoords() {
    return {
      cursorY: this.cursorY - this.viewportY,
      cursorX: this.cursorX - this.viewportX
    };
  }
  updateTokens(){
    const ps = this.filePath.split('.')
    const tokenizer = getTokenizer(ps[ps.length-1])

    this.tokens=this.lines.reduce((r,line,lineNumber) => {
      // const seg = line.substring(this.viewportX, this.viewportWidth);
      const tokens = tokenizer(line,lineNumber)
      r[lineNumber]=tokens
      return r
    },{});
  }
  updateCursor(){
    const lineId=this.cursorY
    const lineNumber=parseInt(lineId)

    const tokens = this.tokens[lineId]

    // 3) scan tokens to find which one covers colInWindow
    let col = 0;
    this.cursorChar = '_'
    for (const tok of tokens) {
      if( this.cursorX >= tok.start && this.cursorX < tok.end) {
        this.cursorStyle = tok.style;
        this.cursorChar = (this.lines[lineId]||"_")[this.cursorX]||'_'
        break
      }
      col += tok.text.length;
    }

    // 4) fallback to last token’s style (e.g. past EOL)
    if(this.cursorStyle==null){
      const last = tokens.slice(-1)[0];
      this.cursorStyle = last ? last.style : {};
      this.cursorChar = last && last.text.length ? last.text[last.text.length-1] : '_';
    }
  }
  /**
  * @param {(code:string)=>TokenizerToken[]} tokenizer
  * @returns {{[lineNumber:string]:TokenizerToken[]}}
  *
  * */
  renderViewport() {
    return Object.keys(this.tokens).reduce(
      (visible,lineId) => {
        const lineNumber=parseInt(lineId)
        if(lineNumber>=this.viewportY && lineNumber<=(this.viewportY+this.viewportHeight)){
          visible[lineId]=this.tokens[lineId]
        }
        return visible
      },
      {}
    )
  }

  // ── cursor moves ───────────────────────────────────────────────────────
  setCursor(x,y){
    this.cursorX=x
    this.cursorY=y
  }

  moveCursorUp() {
    if (this.cursorY > 0) { 
      this.cursorY--;
      if (this.cursorX >= this.lines[this.cursorY].length) {
        this.cursorX = this.lines[this.cursorY].length
      }
      this._ensureCursorInView();
      this.updateCursor();
    }
  }
  moveCursorDown() {
    if ((this.cursorY+1) < this.lines.length) {
      if (this.cursorX >= this.lines[this.cursorY+1].length) {
        this.cursorX = this.lines[this.cursorY+1].length
      }
      this.cursorY++;
      this._ensureCursorInView();
      this.updateCursor();
    }
  }
  moveCursorLeft() {
    if (this.cursorX > 0) {
      this.cursorX--;
      this._ensureCursorInView();
      this.updateCursor();
    }
  }
  moveCursorRight() {
    if (this.cursorX < this.lines[this.cursorY].length) {
      this.cursorX++
    } else {
      this.cursorX = this.lines[this.cursorY].length
    }
    this._ensureCursorInView()
    this.updateCursor();
  }

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

  // ── clone ──────────────────────────────────────────────────────────────

  /** return a new instance with identical state */
  copy() {
    const clone = new CodeBufferEditor(this.filePath, {
      rows: this.viewportHeight,
      cols: this.viewportWidth
    });
    clone.filePath=this.filePath
    clone.viewportY=this.viewportY
    clone.viewportX=this.viewportX
    clone.cursorY=this.cursorY
    clone.cursorX=this.cursorX
    clone.cursorStyle=this.cursorStyle
    clone.cursorChar=this.cursorChar
    clone.lines=this.lines
    clone._saved=this._saved
    return clone;
  }
  getStatus(){
    const range=Object.keys(this.renderViewport())
    const json={
      cursor:{
        x:this.cursorX,
        y:this.cursorY,
        chr:this.cursorChar,
        ...this.cursorStyle,
      },
      v:{x:this.viewportX,y:this.viewportY,w:this.viewportWidth,h:this.viewportHeight},
      s:this._saved,
      l:range[0]+' ... '+range[range.length-1]
    }
    json.cursor[`${this.cursorX}-${this.viewportX}`]=this.cursorX-this.viewportX
    json.cursor[`${this.cursorY}-${this.viewportY}`]=this.cursorY-this.viewportY
    return JSON.stringify(json).replace(/"/gi,'')
    // return ` cursor:{abs:{x:${this.cursorY},y:${this.cursorX}}},viewport:{x:${this.viewportX},y:${this.viewportY},w:${this.viewportWidth},h:${this.viewportHeight}} ${this._saved}`
  }
}