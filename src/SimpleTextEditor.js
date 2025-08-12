import {ScreenEvent} from 'react-blessed'
import {getTokenizer, TokenizerToken} from './tokenizer'
/**
 *
 * @param {SimpleTextEditor} eventData
 * @return {(function())|undefined}
 */
export function Listener(eventData){return ()=>{}}


class EditorEvent{
    /**
     * @type {ScreenEvent}
     */
    screen= {}
    /**
     *
     * @type {string[]}
     */
    lines=[]
    /**
     *
     * @type {string}
     */
    line=""
    /**
     *
     * @type {string[]}
     */
    visibleLines=[]
    /**
     *
     * @type {{x: number, y: number}}
     */
    cursor={x:0,y:0}
    /**
     *
     * @type {{x: number, y: number}}
     */
    cursorScreen={x:0,y:0}
    /**
     *
     * @type {string}
     */
    buffer=""
    /**
     *
     * @type {string}
     */
    visibleBuffer=""
    /**
     *
     * @type {number}
     */
    index=0
    /**
     *
     * @type {TokenizerToken[]}
     */
    tokens=[]
    /**
     *
     * @type {TokenizerToken}
     */
    tokenUnderCursor=null
    phrase=""
}

export class SimpleTextEditor {
    buffer=""
    cursorIndex=0
    highlightIndex=0
    listeners={"cursorChanged":[],"bufferChanged":[]}
    viewportHeight=7
    viewportWidth=30
    viewportX=0
    viewportY=0

    /**
     *
     * @param {string} buffer
     */
    constructor(buffer) {
        this.buffer = buffer||"";
    }
    /**
     *
     * @param {"cursorChanged"|"bufferChanged"} eventType
     * @param {(eventData:SimpleTextEditor)=>(()=>void)} listener
     */
    on(eventType,listener){
        this.listeners[eventType]=listener
    }

    /**
     *
     * @param {"cursorChanged"|"bufferChanged"} eventType
     * @param {SimpleTextEditor} payload
     */
    _dispatchEvents(eventType,payload){
        const toKeep=[]
        for(let listener of this.listeners[eventType]){
            try{
                const unsubscribe=listener(payload)
                if(typeof(unsubscribe) === "function"){
                    unsubscribe()
                }else{
                    toKeep.push(listener)
                }
            }catch(err){

            }
        }
        this.listeners[eventType]=toKeep
    }
    slideViewportToCursor(){
        let {x,y} = this.cursorCoords()
        let {viewportHeight:vh, viewportWidth:vw, viewportX:vx, viewportY:vy}=this
        if (y<vy){
            vy=y
        }
        if(y>(vy+vh)){
            vy+=1
        }
        this.viewportY=vy
    }
    /**
     *
     * @return {string[]}
     */
    renderToLines(start=0,height){
        const lines = this.buffer.split("\n");
        const e=start+(height||lines.length);
        return lines.slice(start,e)
    }

    /**
     *
     * @return {{y: number, x: number}}
     */
    cursorCoords(){
        return this.cursorIndexToCoords(this.cursorIndex)
    }
    /**
     *
     * @return {{y: number, x: number}}
     */
    highlightCoords(){
        return this.cursorIndexToCoords(this.highlightIndex)
    }
    /**
     *
     * @param {String} index
     * @return {{y: number, x: number}}
     */
    cursorIndexToCoords(index){
        const linesTo=this.buffer.substring(0,parseInt(index)).split("\n");
        //console.log({linesTo})
        return {
            y:linesTo.length-1,
            x:linesTo[linesTo.length-1].length
        }
    }
    setCursor(x,y){
        this.cursorIndex=this.cursorCoordsToIndex({x,y})
    }
    setHighlight(x,y){
        this.highlightIndex=this.cursorCoordsToIndex({x,y})
    }

    /**
     *
     * @param {{x:Number,y:Number}} coords
     * @return {Number}
     */
    cursorCoordsToIndex(coords){
        const {x,y} = coords
        const lines=this.buffer.split("\n").slice(0,y);
        //console.log({lines})
        return lines.reduce((c,l)=>c+1+l.length,0) + x;
    }

    /**
     *
     * @param {String} ch
     * @param {String} key
     * @return {SimpleTextEditor}
     */
    onKey(ch,key){
        switch (key.name) {
            case 'up':      this.moveCursorUp();  break;
            case 'down':    this.moveCursorDown();  break;
            case 'left':    this.moveCursorLeft();  break;
            case 'right':   this.moveCursorRight(); break;
            case 'home':    this.toHome(); ;break;
            case 'end':      this.toEnd(); ;break;
            case 'backspace': this.backspace();  break;
            case 'delete':    this.delete();  break;
            case 'return':    this.insert("\n");this.moveCursorDown(); break;
            case 'tab':    this.insert("\t");  break;
            default:
                if (ch && ch.length > 0){
                    if(key.name && key.name.length === 1) {
                        this.insert(key.sequence)
                    } else {
                        this.insert(ch);
                    }
                }
        }
        this.slideViewportToCursor()
        return this
    }
    tokenUnderCursor(x,y,tokenizer){
        const lines = this.renderToLines()
        const line = lines[y];
        const tokens = tokenizer(line,y)
        const phrase = tokens.map(v=>v.type)
        const tokenUnderCursor = tokens.find((v,i,a)=>{
            return v.start<=x && v.end>=x;
        })
        return tokenUnderCursor
    }
    /**
     *
     * @param lpos
     * @param {Screen} screenEvent
     * @param tokenizer
     * @return {EditorEvent}
     */
    getEvent(lpos,screenEvent,tokenizer) {
        const {xi,yi} = lpos;
        const {x,y} = screenEvent;
        const cursor = this.cursorCoords()
        const lines = this.renderToLines()
        const line = lines[cursor.y];
        const tokens = tokenizer(line,y)
        const phrase = tokens.map(v=>v.type)
        const tokenUnderCursor = tokens.find((v,i,a)=>{
            return v.start<=cursor.x && v.end>=cursor.x;
        })
        //this.setCursor(x-xi+this.viewportX,y-yi+this.viewportY)
        return {
            event:screenEvent,
            parentPos:{x:xi,y:yi},
            lines:lines,
            line,
            visibleLines:lines,
            cursor,
            cursorScreen:{x:cursor.x-this.viewportX,y:cursor.y-this.viewportY},
            buffer:this.buffer,
            visibleBuffer:this.buffer,
            index:this.cursorIndex,
            tokens,
            tokenUnderCursor,
            phrase,
        }
    }

    /**
     *
     * @return {SimpleTextEditor}
     */
    moveCursorUp(){
        let {x,y} = this.cursorIndexToCoords(this.cursorIndex)
        if (y>0) {
            this.cursorIndex=this.cursorCoordsToIndex({x:x,y:y-1})
            this._dispatchEvents("cursorChanged",this)
        }
        return this
    }

    /**
     *
     * @return {SimpleTextEditor}
     */
    moveCursorDown(){
        let {x,y} = this.cursorIndexToCoords(this.cursorIndex)
        const lines=this.buffer.split("\n")
        if (y<(lines.length-1)) {
            this.cursorIndex=this.cursorCoordsToIndex({x:x,y:y+1})
            this._dispatchEvents("cursorChanged",this)
        }
        return this
    }

    /**
     *
     * @return {SimpleTextEditor}
     */
    moveCursorLeft(){
        if(this.cursorIndex>0){
            this.cursorIndex-=1
            this._dispatchEvents("cursorChanged",this)
        }
        return this
    }

    /**
     *
     * @return {SimpleTextEditor}
     */
    moveCursorRight(){
        if(this.cursorIndex<this.buffer.length){
            this.cursorIndex+=1
            this._dispatchEvents("cursorChanged",this)
        }
        return this
    }

    /**
     *
     * @return {SimpleTextEditor}
     */
    toHome(){
        let {x,y} = this.cursorIndexToCoords(this.cursorIndex)
        this.cursorIndex=this.cursorCoordsToIndex({x:0,y:y})
        this._dispatchEvents("cursorChanged",this)
        return this
    }

    /**
     *
     * @return {SimpleTextEditor}
     */
    toEnd(){
        let {x,y} = this.cursorIndexToCoords(this.cursorIndex)
        const line=this.buffer.split("\n")[y]
        this.cursorIndex=this.cursorCoordsToIndex({x:line.length,y:y})
        this._dispatchEvents("cursorChanged",this)
        return this
    }

    /**
     *
     * @return {SimpleTextEditor}
     */
    backspace(){
        if(this.cursorIndex>0){
            this.cursorIndex -= 1
            this._dispatchEvents("cursorChanged", this)
            const before=this.buffer.substring(0,this.cursorIndex)
            const after=this.buffer.substring(this.cursorIndex+1)
            this.buffer=before+after
            this._dispatchEvents("bufferChanged",this)
        }
        return this
    }
    /**
     *
     * @return {SimpleTextEditor}
     */
    delete(){
        const before=this.buffer.substring(0,this.cursorIndex+1)
        const after=this.buffer.substring(this.cursorIndex+2)
        this.buffer=before+after
        this._dispatchEvents("bufferChanged",this)
        return this
    }
    /**
     *
     * @return {SimpleTextEditor}
     */
    insert(ch){
        this.cursorIndex+=1
        const before=this.buffer.substring(0,this.cursorIndex-1)
        const after=this.buffer.substring(this.cursorIndex-1)
        this.buffer=before+ch+after
        this._dispatchEvents("bufferChanged",this)
        this._dispatchEvents("cursorChanged",this)
        return this
    }

    /**
     *
     * @return {SimpleTextEditor}
     */
    copy(){
        const newSimpleTextBuffer= new SimpleTextEditor()
        newSimpleTextBuffer.buffer = this.buffer
        newSimpleTextBuffer.cursorIndex = this.cursorIndex
        newSimpleTextBuffer.highlightIndex = this.highlightIndex
        newSimpleTextBuffer.viewportHeight=this.viewportHeight
        newSimpleTextBuffer.viewportWidth=this.viewportWidth
        newSimpleTextBuffer.viewportX=this.viewportX
        newSimpleTextBuffer.viewportY=this.viewportY
        return newSimpleTextBuffer
    }
}