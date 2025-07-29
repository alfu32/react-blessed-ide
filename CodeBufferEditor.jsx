import React, {useEffect, useRef, useState} from 'react';
import {MemoryBufferEditor} from './MemoryBufferEditor';

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
            mouse
            keys
            input
            clickable
            focused
            left={4} top={1} width={1} height={1}
            style={{blink:true}}
            content={'_'}
          />
        )
    }
    const padLength=Math.ceil(Math.log10(editor.viewportHeight+editor.viewportY))
    editor.updateCursor()
    return <box key={`cursor`} 
      left={editor.cursorX-editor.viewportX+padLength+1} top={editor.cursorY-editor.viewportY} width={1} height={1}
      style={{...editor.cursorStyle,underline: true,bold:true}}
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
            style={{bg:'yellow',fg:'#111111'}} 
            content={'No File Loaded'}
          />
        )
    }
    
    const padLength=Math.ceil(Math.log10(editor.viewportHeight+editor.viewportY))
    editor.updateTokens()
    const lines = editor.renderViewport();
    const { cursorY, cursorX } = editor.getCursorWindowCoords();
    return Object.keys(lines).flatMap((lineNumber, k) => {
      const line = lines[lineNumber]
      const lineNumberText = `${String(lineNumber).padStart(padLength, ' ')}`
      const lineNumberBox = (
          <box key={`${lineNumber}-lineNumber`}
               left={0} top={k} width={padLength} height={1}
               style={{bg: 'black', fg: 'blue', inverse: editor.cursorY == lineNumber}}
               content={lineNumberText}
          />)
      return line.reduce((a, t) => {
        a.push(
            <box key={`${t.x}-${t.y}`}
                 left={t.x + padLength + 1} top={t.y - editor.viewportY} width={t.text.length} height={1}
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
      case 'up':    editor.moveCursorUp();    break;
      case 'down':  editor.moveCursorDown();  break;
      case 'left':  editor.moveCursorLeft();  break;
      case 'right': editor.moveCursorRight(); break;
      case 'backspace': editor.backspace().save();  onChange(); break;
      case 'delete':    editor.delete().save();  onChange();      break;
      default:
        if (ch && ch.length === 1){ editor.insert(ch).save();  onChange();}
    }
    setEditor(editor.copy())
    // refresh();
  };

  // 3) On keypress, update editor then re-render
  const setCursorPosition = (screenEvent) => {
    const padLength=Math.ceil(Math.log10(editor.viewportHeight+editor.viewportY))
    const {xi,yi} = boxRef.current.lpos;
    const {x,y} = screenEvent;
    editor.setCursor(x-xi-padLength-1-1+editor.viewportX,y-yi-1+editor.viewportY)
    setEditor(editor.copy())
  };
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
      label={`Editing: ${filePath}`}
    >
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
