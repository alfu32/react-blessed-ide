/**
 *
 * @param {SimpleTextEditor} eventData
 * @return {(function())|undefined}
 */
export function Listener(eventData){return ()=>{}}

export class SimpleTextEditor {
    buffer=""
    cursorIndex=0
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
                        this.insert(key.name);
                    } else {
                        this.insert(ch);
                    }
                }
        }
        this.slideViewportToCursor()
        return this
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
        newSimpleTextBuffer.viewportHeight=this.viewportHeight
        newSimpleTextBuffer.viewportWidth=this.viewportWidth
        newSimpleTextBuffer.viewportX=this.viewportX
        newSimpleTextBuffer.viewportY=this.viewportY
        return newSimpleTextBuffer
    }
}