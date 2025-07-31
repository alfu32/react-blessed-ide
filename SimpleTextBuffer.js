/**
 *
 * @param {SimpleTextBuffer} eventData
 * @return {(function())|undefined}
 */
export function Listener(eventData){return ()=>{}}

export class SimpleTextBuffer {
    buffer=""
    cursorIndex=0
    listeners={"cursorChanged":[],"bufferChanged":[]}

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
     * @param {(eventData:SimpleTextBuffer)=>(()=>void)} listener
     */
    on(eventType,listener){
        this.listeners[eventType]=listener
    }

    /**
     *
     * @param {"cursorChanged"|"bufferChanged"} eventType
     * @param {SimpleTextBuffer} payload
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
        const linesTo=this.buffer.substring(0,index).split("\n");
        //console.log({linesTo})
        return {
            y:linesTo.length-1,
            x:linesTo[linesTo.length-1].length
        }
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
     * @return {SimpleTextBuffer}
     */
    onKey(ch,key){
        switch (key.name) {
            case 'up':      this.moveCursorUp();    break;
            case 'down':    this.moveCursorDown();  break;
            case 'left':    this.moveCursorLeft();  break;
            case 'right':   this.moveCursorRight(); break;
            case 'home':    this.toHome() ;break;
            case 'end':      this.toEnd() ;break;
            case 'backspace': this.backspace();  break;
            case 'delete':    this.delete();  break;
            case 'return':    this.insert("\n");this.moveCursorDown(); break;
            case 'tab':    this.insert("\t");  break;
            default:
                if (ch && ch.length > 0){
                    if(key.name && key.name.length === 1) {
                        this.insert(key.name)
                    } else {
                        this.insert(ch)
                    }
                }
        }
        return this
    }

    /**
     *
     * @return {SimpleTextBuffer}
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
     * @return {SimpleTextBuffer}
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
     * @return {SimpleTextBuffer}
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
     * @return {SimpleTextBuffer}
     */
    moveCursorRight(){
        if(this.cursorIndex<this.buffer.length-1){
            this.cursorIndex+=1
            this._dispatchEvents("cursorChanged",this)
        }
        return this
    }

    /**
     *
     * @return {SimpleTextBuffer}
     */
    toHome(){
        let {x,y} = this.cursorIndexToCoords(this.cursorIndex)
        this.cursorIndex=this.cursorCoordsToIndex({x:0,y:y})
        this._dispatchEvents("cursorChanged",this)
        return this
    }

    /**
     *
     * @return {SimpleTextBuffer}
     */
    toEnd(){
        let {x,y} = this.cursorIndexToCoords(this.cursorIndex)
        const line=this.buffer.split("\n")[y]
        this.cursorIndex=this.cursorCoordsToIndex({x:line.length-1,y:y})
        this._dispatchEvents("cursorChanged",this)
        return this
    }

    /**
     *
     * @return {SimpleTextBuffer}
     */
    backspace(){
        this.cursorIndex-=1
        const before=this.buffer.substring(0,this.cursorIndex+1)
        const after=this.buffer.substring(this.cursorIndex+2)
        this.buffer=before+after
        this._dispatchEvents("bufferChanged",this)
        this._dispatchEvents("cursorChanged",this)
        return this
    }
    /**
     *
     * @return {SimpleTextBuffer}
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
     * @return {SimpleTextBuffer}
     */
    insert(ch){
        this.cursorIndex+=1
        const before=this.buffer.substring(0,this.cursorIndex)
        const after=this.buffer.substring(this.cursorIndex)
        this.buffer=before+ch+after
        this._dispatchEvents("bufferChanged",this)
        this._dispatchEvents("cursorChanged",this)
        return this
    }

    /**
     *
     * @return {SimpleTextBuffer}
     */
    copy(){
        const newSimpleTextBuffer= new SimpleTextBuffer()
        newSimpleTextBuffer.buffer = this.buffer
        newSimpleTextBuffer.cursorIndex = this.cursorIndex
        return newSimpleTextBuffer
    }
}