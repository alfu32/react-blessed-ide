import React, {useEffect, useRef, useState} from "react";
import {
    ListElement as list,
    BoxElement as box,
    ButtonElement as button,
    TextareaElement as textarea,
    TextElement as text
} from 'react-blessed';
import {SimpleTextEditor} from "./SimpleTextEditor.js";
import {debounced, safeStringify} from "./util";
import {getNamedTokenizer, getTokenizer} from "./tokenizer";
import {ScreenEvent} from "react-blessed";
import {EditorEvent} from './SimpleTextEditor'
const defaultText="...".split(",").join("\n")


/**
 *
 * @param {string[]} lines
 * @param {boolean} editable
 * @param {(editorEvent:EditorEvent)=>void} onClick
 * @param {(editorEvent:EditorEvent)=>void} onLineClick
 * @param {(editorEvent:EditorEvent)=>void} onLineHover
 * @param {(editorEvent:EditorEvent)=>void} onTokenClick
 * @param {(editorEvent:EditorEvent)=>void} onTokenHover
 * @param {TokenizerDef} tokenizerDef
 * @param {NodeWithEvents[]} children
 * @param {any[]} boxProps
 * @return {Element}
 */
export function ListComponent({
  lines,
  editable = false,
  onLineClick=(editorEvent)=>{},
  onTokenClick=(editorEvent)=>{},
  onLineHover=(editorEvent)=>{},
  onTokenHover=(editorEvent)=>{},
  tokenizerDef,
  children,
  ...boxProps
}) {
    const boxRef = useRef(null);
    const [editor, setEditor] = useState(null);
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
                // onChange(editor)
                setEditor(editor.copy())
            }, 80)
        }else if ( key in ['up','down'] ){
            editor.onKey(ch, key)
            changedTimeout = setTimeout(() => {
                // onChange(editor)
                setEditor(editor.copy())
            }, 80)
        }
    }
    const getEvent = (screenEvent) => {
        if(!editor){
            return;
        }
        const tokenizer=getTokenizer(tokenizerDef||{
            name:'words',
            flags:'mg',
            definitions:{
                Whitespace:       {style: {fg:'red'},pattern:/\s+/gi},
                Word:             {style: {fg:'green'},pattern:/\b.+?\b/gi},
            }
        })
        const evt = editor.getEvent(boxRef.current.lpos,screenEvent,tokenizer);

        // editor.setCursor(screenEvent.x-boxRef.current.lpos.xi+editor.viewportX,screenEvent.y-boxRef.current.lpos.yi+editor.viewportY)
        return evt
    }
    const onmousemove=debounced((screenEvent)=>{
        const newEvent = getEvent(screenEvent)
        editor.setHighlight(newEvent.cursorScreen.x + editor.viewportX, newEvent.cursorScreen.y + editor.viewportY)
        setEditor(editor.copy())
        onLineHover(newEvent);
        onTokenHover(newEvent);
    },10)
    const onmousedown=debounced((screenEvent)=>{
        const newEvent = getEvent(screenEvent)
        editor.setCursor(screenEvent.x-boxRef.current.lpos.xi+editor.viewportX,screenEvent.y-boxRef.current.lpos.yi+editor.viewportY)
        editor.setHighlight(newEvent.cursorScreen.x + editor.viewportX, newEvent.cursorScreen.y + editor.viewportY)
        setEditor(editor.copy())
    },10)
    const onmouseup=debounced((screenEvent)=>{
        const newEvent = getEvent(screenEvent)
        const {x,y} = screenEvent;
        // setLastEvent(newEvent);
        setTimeout(()=>{
            editor.setHighlight(null)
            editor.setCursor(screenEvent.x-boxRef.current.lpos.xi+editor.viewportX,screenEvent.y-boxRef.current.lpos.yi+editor.viewportY)
            editor.setHighlight(newEvent.cursorScreen.x + editor.viewportX, newEvent.cursorScreen.y + editor.viewportY)
            onLineClick(newEvent);
            onTokenClick(newEvent);
            setEditor(editor.copy())
        },1)
    },10)
    const onwheelup=debounced((screenEvent)=>{
        const newEvent = getEvent(screenEvent)
        editor.moveCursorUp().slideViewportToCursor();
        editor.setHighlight(null)
        // editor.setCursor(screenEvent.x-boxRef.current.lpos.xi+editor.viewportX,screenEvent.y-boxRef.current.lpos.yi+editor.viewportY)
        setEditor(editor.copy())
    },10)
    const onwheeldown=debounced((screenEvent)=>{
        const newEvent = getEvent(screenEvent)
        editor.moveCursorDown().slideViewportToCursor();
        editor.setHighlight(null)
        // editor.setCursor(screenEvent.x-boxRef.current.lpos.xi+editor.viewportX,screenEvent.y-boxRef.current.lpos.yi+editor.viewportY)
        setEditor(editor.copy())
    },10)
    const mouseAction=(screenEvent) =>{

        switch(screenEvent.action){
            case 'mousemove': onmousemove(screenEvent);break;
            case 'mousedown': onmousedown(screenEvent);break;
            case 'mouseup': onmousedown(onmouseup);break;
            case 'wheelup': onwheelup(onmouseup); break;
            case 'wheeldown': onwheeldown(onmouseup); break;
            default: throw new Error(safeStringify(screenEvent)); break;
        }
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
            .flatMap((line,index,arr)=>{
                const renderables = [
                    <box
                        key={`listc-line-${index}-${Date.now}`}
                        top={index} left={0} height={1} width={line.length||1}
                        content={line}
                    />
                ]
                const tokenizer=getTokenizer(tokenizerDef||{
                    name:'words',
                    flags:'mg',
                    definitions:{
                        Whitespace:       {style: {fg:'red'},pattern:/\s+/mig},
                        Word:             {style: {fg:'green'},pattern:/\b.+?\b/mig},
                    }
                })
                const tokens = tokenizer(line,index)
                tokens.forEach((token,j)=>{
                    renderables.push(
                        <box
                            mouse keys
                            key={`listc-line-${index}-token-${j}-${Date.now}`}
                            top={index} left={token.start} height={1} width={token.text.length||1}
                            content={token.text} style={token.style}
                        />)
                })
                return renderables
            })
    }
    const renderCursor = () => {
        if(!editor){
            return;
        }
        const i = editor.cursorIndex
        const {x,y} = editor.cursorCoords()
        const {cursorIndex:ci,viewportX:vx,viewportY:vy,viewportHeight:vh,viewportWidth:vw} = editor;
        return (<box
            mouse keys
            key={`editor-cursor-${Date.now()}`}
            top={y-vy}
            left={x-vx}
            width={1} height={1}
            style={{inverse:true}}
            content={editor.buffer.substring(i,i+1)}
        />)
    }
    const renderHighlight=()=>{
        if(!editor){
            return;
        }
        const i = editor.cursorIndex
        const {x,y} = editor.highlightCoords()
        const {cursorIndex:ci,viewportX:vx,viewportY:vy,viewportHeight:vh,viewportWidth:vw} = editor;
        const tokenizer=getTokenizer(tokenizerDef||{
            name:'words',
            flags:'mg',
            definitions:{
                Whitespace:       {style: {fg:'red'},pattern:/\s+/mig},
                Word:             {style: {fg:'green'},pattern:/\b.+?\b/mig},
            }
        })
        const tokenUnderCursor=editor.tokenUnderCursor(x,y,tokenizer)
        return (<box
            mouse keys
            key={`editor-highlight-${Date.now()}`}
            top={y-vy}
            left={tokenUnderCursor.start}
            width={tokenUnderCursor.text.length} height={1}
            style={{...tokenUnderCursor.style,inverse:true}}
            content={tokenUnderCursor.text}
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

    const renderStatus=()=>{
        if(!editor){
            return;
        }
        const {viewportX:vx,viewportY:vy,viewportHeight:vh,viewportWidth:vw} = editor
        const t=JSON.stringify(editor.cursor).replace(/"/gi,'')
        return (<box
            mouse keys
            key={`editor-status-${Date.now()}`}
            top={0}
            left={vw-10}
            width={t.length} height={1}
            style={{inverse:true}}
            content={t}
        />)
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
            onMouse={mouseAction}
        >
            {/*label = {`${boxProps.label || 'Editing'} ${JSON.stringify(editor.cursorCoords())} ${editor.cursorIndex}`}*/}
            {renderLines()}
            {renderCursor()}
            {renderScrollbar()}
            {children||[]}
            {renderHighlight()}
            {renderStatus()}
        </box>)
}