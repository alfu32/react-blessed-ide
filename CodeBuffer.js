

export class CodeBuffer{
    constructor(text){
        this.text=""
        this.cursor={x:0,y:0,index:0}
        this.lines=[]
    }
    setText(text){
        this.text=text
        this.cursor={...this.cursor}
        this.lines=this.text.split("\n")
    }
    updateCursorIndex(newIndex) {
        const i=Math.min(Math.max(newIndex,0),this.text.length)
        const newCursor={...this.cursor,index:i}
        const slice=this.text.slice(0,i).split('\n')
        newCursor.y=slice.length
        newCursor.x=slice[slice.length-1].length
        this.cursor=newCursor
    }
    moveCursorLeft(n){
        this.updateCursorIndex(this.cursor.index-n)
    }
    moveCursorRight(n){
        this.updateCursorIndex(this.cursor.index+n)
    }
    moveCursorUp(n){
        const slice=this.text.slice(0,this.cursor.index).split('\n')
        if (slice.length>n) {
            const lastLines = slice.slice(slice.length-1-n)
            /// TODO
        }else{
            this.updateCursorIndex(0)
        }
        
    }
    moveCursorDown(n){
        
    }
    tokenize(startY,endY,width){

    }
}