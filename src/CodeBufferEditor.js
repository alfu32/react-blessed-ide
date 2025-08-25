import fs from 'fs';
import {getNamedTokenizer, TokenizerToken} from './tokenizer.js';
import {safeStringify} from "./util";
import { copy, paste } from 'copy-paste';

// test test
export class Rectangle{
  x=-1
  y=-1
  w=-1
  h=-1

  /**
   *
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   */
  constructor(x,y,w,h){
    this.x = x
    this.y = y
    this.w = w
    this.h = h
  }

  /**
   *
   * @param {CodeBufferEditor} editor
   */
  static fromEditor(editor) {
    return new Rectangle(editor.viewportX, editor.viewportY, editor.viewportWidth, editor.viewportHeight)
  }
}
// some test    multiple spaces
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
  lookup(tokens){
    const lineOfTokens = tokens[this.y]
    const tk = lineOfTokens.match(tk => tk.start<=this.x && this.x<=tk.end)
    return tk
  }

  /**
   *
   * @param {Rectangle} visibleArea
   * @returns boolean
   */
  isVisible(visibleArea){
    return this.x>=visibleArea.x && this.x <= (visibleArea.x + visibleArea.w) &&
        this.y>=visibleArea.y && this.y <= (visibleArea.y+visibleArea.h)
  }
  copy(){
    const cp = new CursorPoint()
    cp.x = this.x
    cp.y = this.y
    cp.char = this.char
    cp.style = {...this.style}
    return cp
  }
}

export class CodeBufferEditorSelection{
  start= new CursorPoint()
  end= new CursorPoint()

  /**
   *
   * @param {CursorPoint} start
   */
  constructor(start) {
    this.start=start.copy()
  }

  /**
   *
   * @param {Rectangle} visibleArea
   * @returns boolean
   */
  isVisible(visibleArea){
    return this.start.isVisible(visibleArea) || this.end.isVisible(visibleArea)
  }



  /**
   *
   * @param {CursorPoint} val
   */
  setEnd(val){
    // const start = this.start.copy()
    // const end = val.copy()
    // const min_x=Math.min(start.x,end.x)
    // const min_y=Math.min(start.y,end.y)
    // const max_x=Math.max(start.x,end.x)
    // const max_y=Math.max(start.y,end.y)
    // start.x=min_x
    // start.y=min_y
    // end.x=max_x
    // end.y=max_y
    // this.start = start
    // this.end = end
    this.end = val
    return this
  }

  copy(){
    const cp = new CodeBufferEditorSelection(this.start.copy())
    cp.setEnd(this.end)
    return cp
  }
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
    this.selectStart=null
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
    x=parseInt(x)
    y=parseInt(y)
    crs.x=x
    crs.y=y

    const tokens = [...this.tokens[y]]
    if(tokens.length === 0 || x === line.length) {
      crs.char=' '
      crs.style={fg:"#ff0000",bg:"#ffff44"}
      return crs
    }

    // 3) scan tokens to find which one covers colInWindow
    crs.char = this.lines[y][x]
    const tkLookup = tokens.filter(t => ( ( x >= parseInt(t.start) ) && ( x <= parseInt(t.end) ) ) )
    if(tkLookup.length === 0){
      crs.style = {fg:"#ff0000",bg:"#ffff44"}
      throw new Error(safeStringify({msg:"no token",x,y,tkLookup,tokens}))
    }else{
      try{
        crs.style = tkLookup[0].style
      }catch (e) {
        throw new Error(safeStringify({msg:"no token style",x,y,tkLookup,tokens}))
      }
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
      case 'mousedown': {
          const padLength = Math.ceil(Math.log10(this.viewportHeight + this.viewportY)) + 1
          const {xi, yi} = viewportPosition;
          const {x, y} = screenEvent;
          const cursor = {x: (x - xi - padLength - 1 - 1 - 1 + this.viewportX), y: (y - yi - 1 + this.viewportY)}
          const crs = this.getCursor(cursor)
          this.selectStart = new CodeBufferEditorSelection(crs)
          this.selectStart.setEnd(crs)
          if (screenEvent.meta) {
            this.cursors.push(crs)
          } else {
            this.cursors = [crs]
          }
          hasChanged = true
        }
        break;
      case 'mousemove': {
          const padLength = Math.ceil(Math.log10(this.viewportHeight + this.viewportY)) + 1
          const {xi, yi} = viewportPosition;
          const {x, y} = screenEvent;
          const cursor = {x: (x - xi - padLength - 1 - 1 - 1 + this.viewportX), y: (y - yi - 1 + this.viewportY)}
          const crs = this.getCursor(cursor)
          if (this.selectStart) {
            this.selectStart.setEnd(crs)
          }
          mustRender=true
        }
        break;
      case 'mouseup': {
          if(this.selectStart){
            if (screenEvent.meta) {
              this.selections.push(this.selectStart.copy())
            } else {
              this.selections=[this.selectStart.copy()]
            }
          }
          hasChanged = true
          this.selectStart = null
      }
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
  let mustRender=false
    switch (key.full) {
      case 'up':
        this.cursors=this.cursors.map(crs => THIS.moveCursorUp(crs));
        this.selectStart = key.meta?this.selectStart:null
        mustRender=true
      break;
      case 'down':
        this.cursors=this.cursors.map(crs => THIS.moveCursorDown(crs));
        this.selectStart = key.meta?this.selectStart:null
        mustRender=true
      break;
      case 'left':
        if(key.ctrl){
          this.cursors=this.cursors.map(crs => {
            const line = this.lines[crs.y]
            if(((crs.x-1)>0) && line[crs.x-1] === ' '){
              crs.x-=2
              return crs
            }
            while(crs.x>=0) {
              if(line[crs.x] === ' ' || crs.x === 0){
                crs.x+=(crs.x === 0?0:1)
                break
              }
              crs.x-=1
            }
            return crs
          });
        }else{
          this.cursors=this.cursors.map(crs => THIS.moveCursorLeft(crs));
        }
        this.selectStart = key.meta?this.selectStart:null
        mustRender=true
      break;
      case 'right':
        if(key.ctrl){
          this.cursors=this.cursors.map(crs => {
            const line = this.lines[crs.y]
            if(((crs.x+1)<line.length) && line[crs.x+1] === ' '){
              crs.x+=2
              return crs
            }
            while(crs.x<line.length) {
              if(line[crs.x] === ' '){
                crs.x-=1
                break
              }
              crs.x+=1
            }
            return crs
          });
        }else{
          this.cursors=this.cursors.map(crs => THIS.moveCursorRight(crs));
        }
        this.selectStart = key.meta?this.selectStart:null
        mustRender=true
      break;
      case 'home':
        this.cursors=this.cursors.map(crs => THIS.getCursor({x:0,y:crs.y}));
        mustRender=true
        break;
      case 'end':
        this.cursors=this.cursors.map(crs => THIS.getCursor({x:this.lines[crs.y].length,y:crs.y}));
        mustRender=true
        break;
      case 'pageup':
        this.scrollViewport(-this.viewportHeight);
        mustRender=true
      break;
      case 'pagedown':
        this.scrollViewport(this.viewportHeight);
        mustRender=true
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
      case 'C-c':{
        copy(this.selections.flatMap(s => {
          const lines=[]
          for(let y=s.start.y;y<=s.end.y;y++){
            lines.push(this.lines[y].substring(s.start.x,s.end.x+1))
          }
          return lines
        }).join("\n"), (err, text) => {
          // "some text" is in your clipboard
        });
      }
      break;
      case 'C-p':{
        throw new Error("paste operation not implemented")
      }
      break;
      default:
        if (ch && ch.length > 0 /* && !key.ctrl && !key.meta*/){
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
    return [hasChanged,mustRender]
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
    clone.selectStart=this.selectStart
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