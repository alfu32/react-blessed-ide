import React, {useEffect, useRef, useState} from "react";
import {
    ListElement as list,
    BoxElement as box,
    ButtonElement as button,
    TextareaElement as textarea,
    TextElement as text
} from 'react-blessed';
import {SimpleTextEditor} from "./SimpleTextEditor.js";
import {safeStringify} from "./util";
import {getNamedTokenizer, getTokenizer} from "./tokenizer";
const defaultText="..."
    .split(",").join("\n")
export function ListComponent({lines, editable=false,onClick, onChange,tokenizerDef,children,...boxProps}) {
    const boxRef = useRef(null);
    const [editor, setEditor] = useState(null);
    const [mouseCoords, setMouseCoords] = useState({x:0,y:0});
    const [size, setSize]     = useState({ rows: 10, cols: 30 });
    let changedTimeout=0
    useEffect(()=>{
        let newEditor=editor
        if(!newEditor){
            newEditor = new SimpleTextEditor(lines.join("\n")||defaultText)
        }
        if((lines.join("\n")||defaultText).substring(newEditor.cursorIndex)!==newEditor.buffer.substring(newEditor.cursorIndex)){
            newEditor.slideViewportToCursor()
        }
        newEditor.buffer=lines.join("\n")||defaultText
        newEditor.viewportHeight = size.rows-1;
        newEditor.viewportWidth = size.cols;
        setEditor(newEditor.copy())
    },[lines])

    // 2) update size on resize
    useEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        const update = () => {
            setSize({ cols: box.width, rows: box.height-2 });
        };
        update();
        box.on('resize', update);
        return () => box.removeListener('resize', update);
    }, []);

    // run once on size change
    useEffect(()=>{
        if(editor){
            editor.viewportWidth = size.cols;
            editor.viewportHeight = size.rows;
            setEditor(editor.copy())
        }
    }, [size]);

    const internalOnKeyPress=(ch,key)=>{
        if(editable) {
            editor.onKey(ch, key)
            clearTimeout(changedTimeout)
            changedTimeout = setTimeout(() => {
                onChange(editor)
                setEditor(editor.copy())
            }, 80)
        }else if ( key in ['up','down'] ){
            editor.onKey(ch, key)
            setEditor(editor.copy())
        }
    }
    const setCursorPosition = (screenEvent) => {
        if(!editor){
            return;
        }
        const {xi,yi} = boxRef.current.lpos;
        const {x,y} = screenEvent;
        editor.setCursor(x-xi+editor.viewportX,y-yi+editor.viewportY)
        const cursor = editor.cursorCoords()
        const lines = editor.renderToLines()
        const line = lines[cursor.y];
        const tokenizer=getTokenizer(tokenizerDef||{
            name:'words',
            flags:'mg',
            definitions:{
                Whitespace:       {style: {fg:'red'},pattern:'\\s+'},
                Word:             {style: {fg:'green'},pattern:'\\b.+?\\b'},
            }
        })
        const tokens = tokenizer(line,y)
        const phrase = tokens.map(v=>v.type)
        const tokenUnderCursor = tokens.find((v,i,a)=>{
            return v.start<=cursor.x && v.end>=cursor.x;
        })
        onClick({
            lines:lines,
            line,
            visibleLines:lines,
            cursor,
            cursorScreen:{x:cursor.x-editor.viewportX,y:cursor.y-editor.viewportY},
            buffer:editor.buffer,
            visibleBuffer:editor.buffer,
            index:editor.cursorIndex,
            tokens,
            tokenUnderCursor,
            phrase,
        });
        setEditor(editor.copy())
    };
    const mouseAction=(event) =>{
        const {x,y} = event

        switch(event.action){
            case 'mousemove':break;
            case 'mousedown':break;
            case 'mouseup':break;
            case 'wheelup':editor.moveCursorUp().slideViewportToCursor();setEditor(editor.copy());break;
            case 'wheeldown':editor.moveCursorDown().slideViewportToCursor();setEditor(editor.copy());break;
            default: throw new Error(safeStringify(event)); break;
        }
        setMouseCoords({x,y});
        try{
            boxProps.onMouse(event);
        }catch(e){}
    }
    const renderLines = () => {
        if(!editor){
            return;
        }
        const {viewportY:vy,viewportHeight:vh} = editor
        return editor.renderToLines()
            .filter((l,y) => {
                return (y >=vy && y <= (vy + vh));
            })
            .map((line,index,arr)=>{
                const clickLine=(event)=>{
                }
                return (
                    <box
                        top={index} left={0} height={1} width={line.length||1}
                        key={`commit-editor-line-${index}`}
                        content={line}
                    />
                )
            })
    }
    const renderCursor = () => {
        if(!editor){
            return;
        }
        const i = editor.cursorIndex
        const {x,y} = editor.cursorCoords()
        const {cursorIndex:ci,viewportX:vx,viewportY:vy,viewportHeight:vh,viewportWidth:vw} = editor;
        const content = editor.buffer.substring(i,i+1)
        return (<box
            key={`editor-cursor-${Date.now()}`}
            top={y-vy}
            left={x-vx}
            width={1} height={1}
            style={{inverse:true,underline:true}}
            content={content}
        />)
    }
    const renderStatus = () => {
        if(!editor){
            return;
        }
        const {cursorIndex:ci,viewportX:vx,viewportY:vy,viewportHeight:vh,viewportWidth:vw} = editor;
        const {x:cx,y:cy} = editor.cursorCoords()
        const {x:mx,y:my} = mouseCoords
        let cursorContent = editor.buffer.substring(ci,ci+1)
        let content=cursorContent
        if(boxRef.current && boxRef.current.lpos) {
            const {xi,yi} = boxRef.current.lpos;
            const feedback={
                C:`${cx},${cy},[${ci}]=${cursorContent}`,
                B:`${xi},${yi}`,
                V:`${vx},${vy},${vw},${vh}`,
                M:`A${mx},${my}R${mx-xi-1},${my-yi-1}`
            }
            content = safeStringify(feedback).replace(/[{} "]/gi,'')
        }
        return (<box
            key={`editor-status-${Date.now()}`}
            top={7}
            left={2}
            width={content.length} height={1}
            style={{inverse:true,underline:true}}
            content={content}
        />)
    }
    const renderScrollbar = () => {
        const barElements= [(<box
            key={`scrollbar-bg-${Date.now()}`}
            right={0}
            width={1}
            mouse
            keys
            input
            clickable
            focused
            style={{fg: 'cyan',bg: 'grey'}}
        />)];
        if(!editor){
            return barElements
        }
        const th=editor.renderToLines().length

        const {cursorIndex:ci,viewportX:vx,viewportY:vy,viewportHeight:vh,viewportWidth:vw} = editor;
        const sh=Math.floor(vh*vh/th)+1
        const sy=Math.floor(vy*vh/th)+1
        barElements.push((<box
            key={`scrollbar-btn-${Date.now()}`}
            right={0}
            width={1}
            top={sy}
            height={sh}
            mouse
            keys
            input
            clickable
            focused
            style={{fg: 'cyan',bg: 'cyan'}}
        />))
        return barElements
    }
    return (
        <box
            ref={boxRef}
            {...boxProps}
            mouse
            keys
            input
            clickable
            focused
            style={{ border: { fg: 'cyan' } }}
            tags={false}           // raw ANSI
            scrollable={false}
            onKeypress={internalOnKeyPress}
            onClick={setCursorPosition}
            onMouse={mouseAction}
        >
            {/*label = {`${boxProps.label || 'Editing'} ${JSON.stringify(editor.cursorCoords())} ${editor.cursorIndex}`}*/}
            {renderLines()}
            {renderCursor()}
            {renderScrollbar()}
            {children||[]}
        </box>)
}