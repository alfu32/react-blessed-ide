
import React, {useEffect, useRef, useState} from "react";
import {
    ListElement as list,
    BoxElement as box,
    ButtonElement as button,
    TextareaElement as textarea,
    TextElement as text
} from 'react-blessed';
import {SimpleTextBuffer} from "./SimpleTextBuffer.js";

export function SimpleTextEditor({initialText, onChange,...boxProps}) {
    const boxRef = useRef(null);
    const [editor, setEditor] = useState(new SimpleTextBuffer("... commit message"));
    let changedTimeout=0

    const internalOnKeyPress=(ch,key)=>{
        editor.onKey(ch,key)
        clearTimeout(changedTimeout)
        changedTimeout = setTimeout(()=>{
            onChange(editor)
            setEditor(editor.copy())
        },80)
    }
    const setCursorPosition = (screenEvent) => {
        // if(!editor){
        //     return;
        // }
        // const {xi,yi} = boxRef.current.lpos;
        // const {x,y} = screenEvent;
        // editor.setCursor(x,y)
        // setEditor(editor.copy())
    };
    const renderLines = () => {
        return editor.renderToLines()
            .map((line,index)=>{
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
        const i = editor.cursorIndex
        const {x,y} = editor.cursorCoords()
        const content = editor.buffer.substring(i,i+1)
        return (<box
            key={`editor-cursor-${Date.now()}`}
            top={y}
            left={x}
            width={1} height={1}
            style={{fg:"#333333",bg:"#775500",underline:true}}
            content={content}
        />)
    }
    const renderStatus = () => {
        const i = editor.cursorIndex
        const {x,y} = editor.cursorCoords()
        const content = editor.buffer.substring(i,i+1)
        return (<box
            key={`editor-cursor-${Date.now()}`}
            top={y}
            left={x}
            width={1} height={1}
            style={{fg:"#333333",bg:"#775500",underline:true}}
            content={content}
        />)
    }
    return (
        <box
            ref={boxRef}
            mouse
            keys
            input
            clickable
            focused
            border={{ type: 'line' }}
            style={{ border: { fg: 'cyan' } }}
            tags={false}           // raw ANSI
            scrollable={false}
            onKeypress={internalOnKeyPress}
            onClick={setCursorPosition}
            {...boxProps}
            label={`${boxProps.label||'Editing'} ${JSON.stringify(editor.cursorCoords())} ${editor.cursorIndex}`}
        >
            {renderLines()}
            {renderCursor()}
        </box>)
}