import fs from 'fs';
import { getNamedTokenizer,TokenizerToken } from './tokenizer.js';
import {safeStringify} from "./util";

export class Point{
  x=-1
  y=-1
  char='-'
  style={}
  constructor(x,y,char,style){
    this.x=x||-1
    this.y=y||-1
    this.char=char||'-'
    this.style=style||{}
  }
}
export class CodeBufferEditorSelection{

  start= new Point()
  end= new Point()

}

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
    /**
     *
     * @type {Point[]}
     */
    this.cursors=[]
    /**
     *
     * @type {CodeBufferEditorSelection[]}
     */
    this.selections=[]
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

  /**
   *
   */
  updateTokens(){
    const ps = this.filePath.split('.')
    const tokenizer = getNamedTokenizer(ps[ps.length-1])

    this.tokens=this.lines.reduce((r,line,lineNumber) => {
      // const seg = line.substring(this.viewportX, this.viewportWidth);
      const tokens = tokenizer(line,lineNumber)
      r[lineNumber]=tokens
      return r
    },{});
  }

  /**
   *
   */
  updateCursor(){
    const crs = this.getCursor({x:this.cursorX,y:this.cursorY})
    this.cursorX = crs.x
    this.cursorY = crs.y
    this.cursorChar = crs.char
    this.cursorStyle = crs.style
  }

  /**
   *
   * @param x
   * @param y
   * @returns {Point}
   */
  getCursor({x,y}){
    let crs = new Point()
    crs.x=x
    crs.y=y

    const line=this.lines[y]
    const ps = this.filePath.split('.')
    const lineNumber=parseInt(y)
    const tokenizer = getNamedTokenizer(ps[ps.length-1])

    let tokens=null
    try {
      tokens = tokenizer(line,lineNumber)
    }catch(err){
      tokens = this.tokens[y]
    }

    // 3) scan tokens to find which one covers colInWindow
    let col = 0;
    crs.char = '0'
    for (const tok of tokens) {
      if( x >= tok.start && x < tok.end) {
        crs.style = tok.style;
        crs.char  = (this.lines[y]||"1")[x]||'2'
        break
      }
      col += tok.text.length;
    }

    // 4) fallback to last token’s style (e.g. past EOL)
    if(crs.style){
      const last = tokens.slice(-1)[0];
      crs.style = last ? last.style : {};
      crs.char = last && last.text.length ? last.text[last.text.length-1] : '3';
    }
    return crs
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
    const currentLine=this.lines[y];
    this.cursorX=x>currentLine.length?currentLine.length:x;
    this.cursorY=y;
  }
  onMouse(screenEvent,viewportPosition){
    let hasChanged=false
    switch(screenEvent.action){
      case 'mousemove':break;
      case 'mousedown':
        const padLength=Math.ceil(Math.log10(this.viewportHeight+this.viewportY))+1
        const {xi,yi} = viewportPosition;
        const {x,y} = screenEvent;
        const cursor= {x:(x-xi - padLength - 1 - 1 - 1 + this.viewportX), y:(y-yi - 1 + this.viewportY)}
        if(screenEvent.meta){
          this.cursors.push(new Point(this.cursorX,this.cursorY,this.cursorChar, {...this.cursorStyle}))
        }else{
          this.cursors=[]
        }
        this.setCursor(cursor.x,cursor.y)
        hasChanged=true
        break;
      case 'mouseup':

        break;
      case 'wheelup':this.moveCursorUp();hasChanged=true;break;
      case 'wheeldown':this.moveCursorDown();hasChanged=true;break;
      default: throw new Error(safeStringify(screenEvent)); break;
    }
    return hasChanged
  }
  onKey(ch,key,onChange=()=>{}){
    const THIS = this
  let hasChanged=false
    switch (key.name) {
      case 'up':      this.moveCursorUp();this.cursors=this.cursors.map(crs => THIS.moveCursorUp(crs));    break;
      case 'down':    this.moveCursorDown();this.cursors=this.cursors.map(crs => THIS.moveCursorDown(crs));  break;
      case 'left':    this.moveCursorLeft();this.cursors=this.cursors.map(crs => THIS.moveCursorLeft(crs));  break;
      case 'right':   this.moveCursorRight();this.cursors=this.cursors.map(crs => THIS.moveCursorRight(crs)); break;
      case 'home':    this.cursorX=0;    break;
      case 'end':      this.cursorX=this.lines[this.cursorY].length;    break;
      case 'pageup':    this.moveCursorVertically(-this.viewportHeight);    break;
      case 'pagedown':    this.moveCursorVertically(this.viewportHeight);    break;
      case 'backspace': this.backspace().save();  hasChanged=true; break;
      case 'delete':    this.delete().save();  hasChanged=true;      break;
      case 'return':    this.insert("\n");this.moveCursorDown();this.save();  hasChanged=true;      break;
      case 'tab':    this.insert("\t").save();  hasChanged=true;      break;
      default:
        if (ch && ch.length > 0 && !key.ctrl && !key.meta){
          if(key.sequence && key.sequence.length === 1) {
            this.insert(key.sequence).save();
            hasChanged=true;
          } else if(key.name && key.name.length === 1) {
            this.insert(key.name).save();
            hasChanged=true;
          } else {
            this.insert(ch).save();
            hasChanged=true;
          }
        }
    }
    return hasChanged
  }

  /**
   *
   * @param {Point} cursor
   * @returns {Point}
   */
  moveCursorUp(cursor=null) {
    cursor=cursor||new Point(this.cursorX,this.cursorY,this.cursorChar, {...this.cursorStyle});
    if (cursor.y > 0) {
      cursor.y--;
      if (cursor.x >= this.lines[cursor.y].length) {
        cursor.x = this.lines[cursor.y].length
      }
      this.setCursor(cursor.x,cursor.y)
      this._ensureCursorInView();
      this.updateCursor();
    }
    return cursor
  }

  /**
   *
   * @param {Point} cursor
   * @returns {Point}
   */
  moveCursorDown(cursor=null) {
    cursor=cursor||new Point(this.cursorX,this.cursorY,this.cursorChar, {...this.cursorStyle});
    if ((cursor.y+1) < this.lines.length) {
      if (cursor.x >= this.lines[cursor.y+1].length) {
        cursor.x = this.lines[cursor.y+1].length
      }
      cursor.y++;
      this.setCursor(cursor.x,cursor.y)
      this._ensureCursorInView();
      this.updateCursor();
    }
    return cursor
  }

  /**
   *
   * @param {Point} cursor
   * @returns {Point}
   */
  moveCursorLeft(cursor=null) {
    cursor=cursor||new Point(this.cursorX,this.cursorY,this.cursorChar, {...this.cursorStyle});
    if (cursor.x > 0) {
      cursor.x--;
      this.setCursor(cursor.x,cursor.y)
      this._ensureCursorInView();
      this.updateCursor();
    }
    return cursor
  }

  /**
   *
   * @param {Point} cursor
   * @returns {Point}
   */
  moveCursorRight(cursor=null) {
    cursor=cursor||new Point(this.cursorX,this.cursorY,this.cursorChar, {...this.cursorStyle});
    if (cursor.x < this.lines[cursor.y].length) {
      cursor.x++
    } else {
      cursor.x = this.lines[cursor.y].length
    }
    this.setCursor(cursor.x,cursor.y)
    this._ensureCursorInView()
    this.updateCursor();
    return cursor
  }

  moveCursorVertically(n,cursor){
    if(n>0){
        for(let i=0;i<n;i++){
            this.moveCursorDown(cursor)
        }
    }else if(n<0){
        for(let i=n;i<=0;i++){
            this.moveCursorUp(cursor)
        }
    }
  }
  moveCursorHorizontally(n,cursor){
    if(n>0){
        for(let i=0;i<n;i++){
            this.moveCursorRight(cursor)
        }
    }else if(n<0){
        for(let i=n;i<=0;i++){
            this.moveCursorLeft(cursor)
        }
    }
  }
  // ── edits ───────────────────────────────────────────────────────────────

  insert(text,cursor) {
    cursor=cursor||{x:this.cursorX,y:this.cursorY};
    const oldLine=this.lines[cursor.y]
    const before=oldLine.substring(0,cursor.x)
    const after=oldLine.substring(cursor.x)
    const newLine=before+text+after
    let newLines=this.lines.slice(0,cursor.y)
    let oldLinesAfter=this.lines.slice(cursor.y+1)
    this.lines=newLines.concat(newLine.split('\n')).concat(oldLinesAfter)
    cursor.x++
    this.setCursor(cursor.x,cursor.y)
    this._ensureCursorInView();
    return this
  }

  delete(cursor) {
    cursor=cursor||{x:this.cursorX,y:this.cursorY};
    const oldLine=this.lines[cursor.y]
    const before=oldLine.substring(0,cursor.x)
    const after=oldLine.substring(cursor.x+1)
    const newLine=before+after
    let newLines=this.lines.slice(0,cursor.y)
    let oldLinesAfter=this.lines.slice(cursor.y+1)
    this.lines=newLines.concat(newLine.split('\n')).concat(oldLinesAfter)
    this.setCursor(cursor.x,cursor.y)
    this._ensureCursorInView();
    return this
  }

  backspace(cursor) {
    cursor=cursor||{x:this.cursorX,y:this.cursorY};
    if (cursor.x>0) {
      cursor.x--;
      this.delete(cursor)
    } else if (cursor.y>0) {
      const newCol=this.lines[cursor.y-1].length
      cursor.y--;
      cursor.x = newCol; // will clamp after reading full line next time
      this.delete(cursor)
    }
    this.setCursor(cursor.x,cursor.y)
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
    clone.cursors=this.cursors
    clone.selections=this.selections
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