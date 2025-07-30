import React, {useEffect, useRef, useState} from 'react';
import {MemoryBufferEditor} from './MemoryBufferEditor';
import { BoxElement as box, TextElement as text } from 'react-blessed';
import {safeStringify} from "./util";


export function CodeBufferEditor({
    filePath,
    onKeypress=(ch,key) =>{},
    onChange = (p) => {},
    ...boxProps
}) {
  const boxRef = useRef();
  /**
   * @constant {[MemoryBufferEditor,(ed:MemoryBufferEditor)=>void]} [editor, setEditor]
   */

	
  const [editor, setEditor] = useState(null);
  const [size, setSize]     = useState({ rows: 10, cols: 30 });


  // 1) (Re)create editor whenever filePath changes
  useEffect(() => {
    if (filePath) {
      const ed = new MemoryBufferEditor(filePath, { rows: size.rows, cols: size.cols });
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
  const cursor = ()=>{
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
    return <box key={`cursor-${Date.now()}`}
      left={editor.cursorX-editor.viewportX+padLength+1+ 1} top={editor.cursorY-editor.viewportY} width={1} height={1}
      style={{...editor.cursorStyle,underline: true,bold:true,inverse:true}}
      tags={false}
      content={editor.cursorChar}
    />
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
          <box key={`${lineNumber}-lineNumber`}
               left={0} top={k} width={padLength + 1} height={1}
               style={{bg: '#222222', fg: '#33aabb', inverse: editor.cursorY == lineNumber}}
               content={lineNumberText+'│'}
          />)
      return line.reduce((a, t) => {
        a.push(
            <box key={`${t.x}-${t.y}`}
                 left={t.x + padLength + 1 + 1} top={t.y - editor.viewportY} width={t.text.length} height={1}
                 style={t.style}
                 content={t.text}
            />
        )
        return a
      }, [lineNumberBox])
    })
  }

  // 3) On keypress, update editor then re-render
  const internalOnKeypress = (ch, key) => {
    onKeypress({ch,key})
    if(filePath==null){
        return
    }
    switch (key.name) {
      case 'up':      editor.moveCursorUp();    break;
      case 'down':    editor.moveCursorDown();  break;
      case 'left':    editor.moveCursorLeft();  break;
      case 'right':   editor.moveCursorRight(); break;
      case 'home':    editor.cursorX=0;    break;
      case 'end':      editor.cursorX=editor.lines[editor.cursorY].length;    break;
      case 'pageup':    editor.moveCursorVertically(-editor.viewportHeight);    break;
      case 'pagedown':    editor.moveCursorVertically(editor.viewportHeight);    break;
      case 'backspace': editor.backspace().save();  onChange(); break;
      case 'delete':    editor.delete().save();  onChange();      break;
      case 'return':    editor.insert("\n");editor.moveCursorDown();editor.save();  onChange();      break;
      case 'tab':    editor.insert("\t").save();  onChange();      break;
      default:
        if (ch && ch.length > 0){
          if(key.name && key.name.length === 1) {
            editor.insert(ch).save();
            onChange();
          } else {

          }
        }
    }
    setEditor(editor.copy())
    // refresh();
  };

  // 3) On keypress, update editor then re-render
  const setCursorPosition = (screenEvent) => {
    if(!editor){
      return;
    }
    const padLength=Math.ceil(Math.log10(editor.viewportHeight+editor.viewportY))+1
    const {xi,yi} = boxRef.current.lpos;
    const {x,y} = screenEvent;
    editor.setCursor(x-xi-padLength-1-1+editor.viewportX,y-yi-1+editor.viewportY)
    setEditor(editor.copy())
  };

  const mouseAction=(event) =>{
    switch(event.action){
      case 'mousemove':break;
      case 'mousedown':break;
      case 'mouseup':break;
      case 'wheelup':editor.moveCursorUp();setEditor(editor.copy());break;
      case 'wheeldown':editor.moveCursorDown();setEditor(editor.copy());break;
      default: throw new Error(safeStringify(event)); break;
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
      onClick={setCursorPosition}
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
        left={-1}
        width={size.cols}
        height={1}
        content={editor?.getStatus()}
        tags={false}
        style={{fg:'black',bg:'yellow'}}
      />
      {cursor()}
    </box>
  );
}