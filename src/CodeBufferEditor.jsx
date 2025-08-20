import React, {useEffect, useRef, useState} from 'react';
import {CodeBufferEditor, CursorPoint} from './CodeBufferEditor.js';
import { BoxElement as box, TextElement as text } from 'react-blessed';
import {safeStringify} from "./util";


export function CodeBufferEditorComponent({
    filePath,
    onKeypress=(ch,key) =>{},
    onChange = ({editor,ch,key,screenEvent,viewport}) => {},
    ...boxProps
}) {
  const boxRef = useRef();
  /**
   * @constant {[CodeBufferEditor,(ed:CodeBufferEditor)=>void]} [editor, setEditor]
   */

	
  const [editor, setEditor] = useState(null);
  const [size, setSize]     = useState({ rows: 10, cols: 30 });
  const[lastEvent,setLastEvent] = useState({editor:null,ch:null,key:null,screenEvent:null,viewport:null})


  // 1) (Re)create editor whenever filePath changes
  useEffect(() => {
    if (filePath) {
      const ed = new CodeBufferEditor(filePath, { rows: size.rows, cols: size.cols });
      // immediately render the new file
      ed.viewportHeight = size.rows-1;
      ed.viewportWidth = size.cols;
      setEditor(ed);
    } else {
      setEditor(null);
    }
  }, [filePath]);

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
  const cursors = ()=>{
    if(!editor){
        return (
          <box key={`0-1-no-file`}
            left={4} top={1} width={1} height={1}
            style={{blink:true}}
            content={'_'}
          />
        )
    }
    const padLength=Math.ceil(Math.log10(editor.viewportHeight+editor.viewportY))+1
    editor.updateCursor()

    return [...editor.cursors,new CursorPoint(editor.cursorX,editor.cursorY,editor.cursorChar,editor.cursorStyle)]
        .filter((cursor,y)=>{
          return cursor.y>=editor.viewportY && cursor.y <= (editor.viewportY+editor.viewportHeight)
        })
        .map((crs,id)=>{
          const cursor = editor.getCursor({...crs})
          return <box key={`cursor-${id}-${Date.now()}`}
              left={cursor.x-editor.viewportX+padLength+1+ 1} top={cursor.y-editor.viewportY} width={1} height={1}
              style={{...cursor.style,underline: true,bold:true,inverse:true}}
              tags={false}
              content={cursor.char}
          />
        })

  }

  const tokenList = ()=>{
    if(!editor){
        return (
          <box key={`0-0-no-file`} 
            mouse
            keys
            input
            clickable
            focused
            left={(size.cols>>1) - 8} top={(size.rows>>1)-1} width={16} height={3} 
            style={{bg:'#eeee00',fg:'#111111'}}
            content={'\n No File Loaded'}
          />
        )
    }
    
    const padLength=Math.ceil(Math.log10(editor.viewportHeight+editor.viewportY))+1
    editor.updateTokens()
    const lines = editor.renderViewport();
    const { cursorY, cursorX } = editor.getCursorWindowCoords();
    return Object.keys(lines).flatMap((lineNumber, k) => {
      const line = lines[lineNumber]
      const lineNumberText = `${String(lineNumber).padStart(padLength, ' ')}`
      const lineNumberBox = (
          <box key={`${lineNumber}-lineNumber-${Date.now}`}
               left={0} top={k} width={padLength + 1} height={1}
               style={{bg: '#222222', fg: '#33aabb', inverse: editor.cursorY == lineNumber}}
               content={lineNumberText+'│'}
          />)
      return line.reduce((a, t) => {
        a.push(
            <box key={`${t.x}-${t.y}-${Date.now()}`}
                 left={t.x + padLength + 1 + 1} top={t.y - editor.viewportY} width={t.text.length} height={1}
                 style={t.style}
                 content={t.text}
            />
        )
        return a
      }, [
        lineNumberBox/*,
        <box
          key={`terminator-${lineNumber}-${Date.now()}`}
          left={padLength + 1 + line.length} top={lineNumber - editor.viewportY} width={1} height={1}
          style={{bg:"#113311",fg:"#555555"}}
          content={'¬'}
        />*/
      ])
    })
  }

  // 3) On keypress, update editor then re-render
  const internalOnKeypress = (ch, key) => {
    onKeypress(ch,key)
    if(editor == null || filePath==null){
        return
    }
    const hasChanged = editor.onKey(ch,key)
    if(hasChanged){
      const newLastEvent = {...lastEvent,editor,ch,key,viewport:boxRef.current.lpos}
      onChange(newLastEvent)
      setLastEvent(newLastEvent)
    }
    setEditor(editor.copy())
    // refresh();
  };

  const mouseAction=(screenEvent) =>{
    if(!editor){
      return
    }
    const mustChange = editor.onMouse(screenEvent,boxRef.current.lpos)
    if(mustChange){
      const newLastEvent = {...lastEvent,editor,screenEvent,viewport:boxRef.current.lpos}
      onChange(newLastEvent)
      setLastEvent(newLastEvent)
      setEditor(editor.copy())
    }
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
      border={{ type: 'line' }}
      style={{ border: { fg: 'cyan' } }}
      tags={false}           // raw ANSI
      scrollable={false}
      onKeypress={internalOnKeypress}
      onMouse={mouseAction}
      label={`Editing: ${filePath}`}
    >
      {/* status
      onClick={setCursorPosition}
      onScroll={scrollCursor}
      */}
      {tokenList()}
      {/* status */}
      <box
        key={`status`}
        top={size.rows}
        left={2}
        width={size.cols-6}
        height={1}
        content={editor?.getStatus()}
        tags={false}
        style={{fg:'black',bg:'yellow'}}
      />
      {cursors()}
    </box>
  );
}