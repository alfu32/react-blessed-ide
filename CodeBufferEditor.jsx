import React, { useRef, useState, useEffect } from 'react';
import blessed from 'blessed';
import { render } from 'react-blessed';
import {FileBufferEditor} from './FileBufferEditor';

export function CodeBufferEditor({
    filePath,
    onKeypress=(ch,key) =>{},
    onChange = (p) => {},
    ...boxProps
}) {
  const boxRef = useRef();
  /**
   * @constant {[FileBufferEditor,(ed:FileBufferEditor)=>void]} [editor, setEditor]
   */
  const [editor, setEditor] = useState(null);
  const [size, setSize]     = useState({ rows: 10, cols: 30 });


  // 1) (Re)create editor whenever filePath changes
  useEffect(() => {
    if (filePath) {
      const ed = new FileBufferEditor(filePath, { rows: size.rows, cols: size.cols });
      // immediately render the new file
      ed.windowRows = size.rows;
      ed.windowCols = size.cols;
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
      editor.windowCols = size.cols;
      editor.windowRows = size.rows;
      setEditor(editor.copy())
    }
  }, [size]);

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
    
    const padLength=Math.ceil(Math.log10(editor.windowRows+editor.windowStartRow))
    const lines = editor.render();
    const { rowInWindow, colInWindow } = editor.getCursorWindowCoords();
    const tt = Object.keys(lines).flatMap((lineNumber,k) => {
      const line = lines[lineNumber]
      const lineNumberText=`${String(lineNumber).padStart(padLength,' ')}`
      const lineNumberBox=(
        <box key={`${lineNumber}-lineNumber`} 
          left={0} top={k} width={padLength} height={1} 
          style={{bg:'black',fg:'blue',inverse:rowInWindow==lineNumber}} 
          content={lineNumberText}
        />)
      return line.reduce((a,t) => {
        a.push(
          <box key={`${t.x}-${t.y}`} 
            left={t.x+padLength+1} top={t.y} width={t.text.length} height={1} 
            style={t.style} 
            content={t.text}
          />
        )
        return a
      },[lineNumberBox])
    })

    const style = editor.cursorStyle;
    const char  = editor.cursorChar;
    tt.push((
      <box key={`cursor`} 
        left={colInWindow+padLength+1} top={rowInWindow} width={1} height={1} 
        style={{...style,inverse: true}}
        tags={false}
        content={char}
      />
    ))
    return tt
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
      case 'backspace': editor.backspace();  onChange(); break;
      case 'delete':    editor.delete();  onChange();      break;
      default:
        if (ch && ch.length === 1){ editor.insert(ch);  onChange();}
    }
    setEditor(editor.copy())
    // refresh();
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
      label={`Editing: ${filePath}`}
    >
      {tokenList()}
      {/* caret overlay 
      <box
        key={`caret`}
        top={caret.row}
        left={caret.col}
        width={1}
        height={1}
        content={caret.char}
        tags={false}
        style={{...caret.style,inverse: true}}
      />*/}
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
    </box>
  );
}
