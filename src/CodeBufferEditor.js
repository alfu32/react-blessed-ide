import fs from 'fs';
import {getNamedTokenizer, TokenizerToken} from './tokenizer.js';
import {safeStringify} from "./util";

// test test


export class CursorPoint{
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
  start= new CursorPoint()
  end= new CursorPoint()
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
    this.lines           = [];
    this.tokens=[]
    this.tokenizer=function(line,lineNumber){
      return line.split(" ").flatMap(n => [n,' '])
    }
    this._tout000             = 0
    this._saved           = ''

    this.setFilePath(filePath)
    /**
     *
     * @type {CursorPoint[]}
     */
    this.cursors=[]
    /**
     *
     * @type {CodeBufferEditorSelection[]}
     */
    this.selections=[]
  }
  setFilePath(filePath){
    const ps = this.filePath.split('.')
    this.tokenizer = getNamedTokenizer(ps[ps.length-1])
    this.filePath        = filePath;
    this.lines=fs.readFileSync(filePath,{encoding:'utf-8'}).split('\n')
    this.updateTokens()
  }
  save(){
    clearTimeout(this._tout000)
    this._tout000 = setTimeout(()=>{
      fs.writeFileSync(this.filePath,this.lines.join('\n'))
      this._saved = `saved ${new Date().toISOString()}`
    },1000)
  }

  // ── private ────────────────────────────────────────────────────────────

  scrollViewport(n) {
    let nextY=this.viewportY+n
    let maxY = this.lines.length - 1
    if (nextY < 0) {
      this.viewportY=0;
    } else if ( (nextY +this.viewportHeight)  > maxY) {
      this.viewportY=maxY-this.viewportHeight;
    } else {
      this.viewportY = nextY
    }
  }
  _ensureCursorInView(cursor) {
    if (cursor.y < this.viewportY) {
      this.viewportY = cursor.y;
    } else if (cursor.y >= (this.viewportY + this.viewportHeight)) {
      this.viewportY = cursor.y - this.viewportHeight;
    }
    if (cursor.x < this.viewportX) {
      this.viewportX = cursor.x;
    } else if (cursor.x >= this.viewportX + this.viewportWidth) {
      this.viewportX = cursor.x - this.viewportWidth;
    }
  }

  /**
   *
   * @param lineNumber
   */
  updateTokensLine(lineNumber){
    this.tokens[lineNumber]=this.tokenizer(this.lines[lineNumber], lineNumber)
  }
  /**
   *
   */
  updateTokens(){
    this.tokens=this.lines.map((line,lineNumber) => {
      return this.tokenizer(line, lineNumber)
    });
  }

  /**
   *
   * @param x
   * @param y
   * @returns {CursorPoint}
   */
  getCursor({x,y}){
    let crs = new CursorPoint()
    // clamp x,y
    y=y<0?0:(y>(this.lines.length-1)?(this.lines.length-1):y)
    const line=this.lines[y]
    x=x<0?0:(x>(line.length)?(line.length):x)
    crs.x=x
    crs.y=y

    const lineNumber=parseInt(y)

    let tokens=null
    try {
      tokens = this.tokenizer(line,lineNumber)
    }catch(err){
      tokens = this.tokens[y]
    }

    // 3) scan tokens to find which one covers colInWindow
    let col = 0;
    crs.char = this.lines[y][x]||' '
    for (const tok of tokens) {
      if( x >= tok.start && x < tok.end) {
        crs.style = tok.style;
        break
      }
      col += tok.text.length;
    }

    // 4) fallback to last token’s style (e.g. past EOL)
    if(crs.style){
      const last = tokens.slice(-1)[0];
      crs.style = last ? last.style : {};
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

  onMouse(screenEvent,viewportPosition){
    const THIS = this
    let hasChanged=false
    let mustRender=false
    const clicks = Array.from(screenEvent.buf||[]).filter(v => v === 77).length
    switch(screenEvent.action){
      case 'mousemove':break;
      case 'mousedown':
        const padLength=Math.ceil(Math.log10(this.viewportHeight+this.viewportY))+1
        const {xi,yi} = viewportPosition;
        const {x,y} = screenEvent;
        const cursor= {x:(x-xi - padLength - 1 - 1 - 1 + this.viewportX), y:(y-yi - 1 + this.viewportY)}
        const crs=this.getCursor(cursor)
        if(screenEvent.meta){
          this.cursors.push(crs)
        }else{
          this.cursors=[crs]
        }
        hasChanged=true
        break;
      case 'mouseup':

        break;
      case 'wheelup':
        this.scrollViewport(-clicks)
        mustRender=true
      break;
      case 'wheeldown':
        this.scrollViewport(clicks)
        mustRender=true
      break;
      default: throw new Error(safeStringify(screenEvent)); break;
    }
    return [hasChanged,mustRender]
  }
  onKey(ch,key,onChange=()=>{}){
  const THIS = this
  let hasChanged=false
    switch (key.name) {
      case 'up':
        this.cursors=this.cursors.map(crs => THIS.moveCursorUp(crs));
      break;
      case 'down':
        this.cursors=this.cursors.map(crs => THIS.moveCursorDown(crs));
      break;
      case 'left':
        this.cursors=this.cursors.map(crs => THIS.moveCursorLeft(crs));
      break;
      case 'right':
        this.cursors=this.cursors.map(crs => THIS.moveCursorRight(crs));
      break;
      case 'home':
        this.cursors=this.cursors.map(crs => THIS.getCursor({x:0,y:crs.y}));
        break;
      case 'end':
        this.cursors=this.cursors.map(crs => THIS.getCursor({x:this.lines[crs.y].length,y:crs.y}));
        break;
      case 'pageup':
        this.scrollViewport(-this.viewportHeight);
      break;
      case 'pagedown':
        this.scrollViewport(this.viewportHeight);
      break;
      case 'backspace':
        this.cursors.forEach(crs => THIS.backspace(crs))
        this.save();
        hasChanged=true;
        break;
      case 'delete':
        this.cursors.forEach(crs => THIS.delete(crs))
        this.save();
        hasChanged=true;
        break;
      case 'return':
        this.cursors
            .toSorted((a,b) => (a.y-b.y))
            .forEach((crs,y) => {
              crs.y+=y
              THIS.insert("\n", crs)
              crs.y+=1
              crs.x=0
            })
        this.save();
        hasChanged=true;
      break;
      case 'tab':
        this.cursors
            .toSorted((a,b) => (a.y-b.y))
            .forEach((crs,y) => {
              THIS.insert("\t", crs)
            })
        this.save();
        hasChanged=true;
      break;
      default:
        if (ch && ch.length > 0 && !key.ctrl && !key.meta){
          if(key.sequence && key.sequence.length === 1) {
            this.cursors.forEach(crs => THIS.insert(key.sequence,crs))
            this.save();
            hasChanged=true;
          } else if(key.name && key.name.length === 1) {
            this.cursors.forEach(crs => THIS.insert(key.name,crs))
            this.save();
            hasChanged=true;
          } else {
            this.cursors.forEach(crs => THIS.insert(ch,crs))
            hasChanged=true;
          }
        }
    }
    return hasChanged
  }

  /**
   *
   * @param {CursorPoint} cursor
   * @returns {CursorPoint}
   */
  moveCursorUp(cursor) {
    if (cursor.y > 0) {
      cursor.y--;
      const line = this.lines[cursor.y]
      if (cursor.x >= line.length) {
        cursor.x = line.length
      }
      this._ensureCursorInView(cursor);
    }
    return cursor
  }

  /**
   *
   * @param {CursorPoint} cursor
   * @returns {CursorPoint}
   */
  moveCursorDown(cursor) {
    if ((cursor.y+1) < this.lines.length) {
      if (cursor.x >= this.lines[cursor.y+1].length) {
        cursor.x = this.lines[cursor.y+1].length
      }
      cursor.y++;
      this._ensureCursorInView(cursor);
    }
    return cursor
  }

  /**
   *
   * @param {CursorPoint} cursor
   * @returns {CursorPoint}
   */
  moveCursorLeft(cursor) {
    if (cursor.x > 0) {
      cursor.x--;
      this._ensureCursorInView(cursor);
    }
    return cursor
  }

  /**
   *
   * @param {CursorPoint} cursor
   * @returns {CursorPoint}
   */
  moveCursorRight(cursor) {
    const line = this.lines[cursor.y]
    if (cursor.x < line.length) {
      cursor.x++
    } else {
      cursor.x = line.length
    }
    this._ensureCursorInView(cursor)
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
    const oldLine=this.lines[cursor.y]
    const before=oldLine.substring(0,cursor.x)
    const after=oldLine.substring(cursor.x)
    const newLine=before+text+after
    let newLines=this.lines.slice(0,cursor.y)
    let oldLinesAfter=this.lines.slice(cursor.y+1)
    this.lines=newLines.concat(newLine.split('\n')).concat(oldLinesAfter)
    if(newLine.indexOf("\n")>-1){
      this.updateTokens()
    } else {
      this.updateTokensLine(cursor.y)
    }
    cursor.x++
    this._ensureCursorInView(cursor);
    return this
  }

  delete(cursor) {
    if(cursor.x===this.lines[cursor.y].length){
      let newLines=this.lines.slice(0,cursor.y)
      let currentLine=this.lines[cursor.y]
      const nextLine=this.lines[cursor.y+1]
      let restLines=this.lines.slice(cursor.y+2)
      this.lines=newLines.concat([currentLine+nextLine]).concat(restLines)
      this.updateTokens()
    } else {
      let newLines=this.lines.slice(0,cursor.y)
      const oldLine=this.lines[cursor.y]
      const before=oldLine.substring(0,cursor.x)
      const after=oldLine.substring(cursor.x+1)
      const newLine=before+after
      let oldLinesAfter=this.lines.slice(cursor.y+1)
      this.lines=newLines.concat(newLine.split('\n')).concat(oldLinesAfter)
      this.updateTokensLine(cursor.y)
    }
    this._ensureCursorInView(cursor);
    return this
  }

  backspace(cursor) {
    if (cursor.x>0) {
      cursor.x--;
      this.delete(cursor)
    } else if (cursor.y>0) {
      const newCol=this.lines[cursor.y-1].length
      cursor.y--;
      cursor.x = newCol; // will clamp after reading full line next time
      this.delete(cursor)
      this.updateTokensLine(cursor.y)
    }
    this._ensureCursorInView(cursor);
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
    clone.lines=this.lines
    clone.cursors=this.cursors
    clone.tokens=this.tokens
    clone.tokenizer=this.tokenizer
    clone.selections=this.selections
    clone._saved=this._saved
    return clone;
  }
  getStatus(){
    const range=Object.keys(this.renderViewport())
    const json={
      cursor:this.cursors,
      v:{x:this.viewportX,y:this.viewportY,w:this.viewportWidth,h:this.viewportHeight},
      s:this._saved,
      l:range[0]+' ... '+range[range.length-1]
    }
    return JSON.stringify(json).replace(/"/gi,'')
  }
}