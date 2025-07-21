import React, { useRef, useState, useEffect } from 'react';
import blessed from 'blessed';
import { render } from 'react-blessed';
import {FileBufferEditor} from './services/FileBufferEditor';
import {getTokenizer} from './tokenizer';

export function CodeBufferEditor({
    filePath,
    onKeypress=(ch,key) =>{},
    onChange = (p) => {},
    ...boxProps
}) {
  const boxRef = useRef();
  const [editor, setEditor] = useState(null);
  const [size, setSize]     = useState({ rows: 0, cols: 0 });
  const [content, setContent] = useState('');
  const [caret, setCaret]     = useState({
    row: 0,
    col: 0,
    char: ' ',
    style: {}
  });


  // 1) (Re)create editor whenever filePath changes
  useEffect(() => {
    if (filePath) {
      const ed = new FileBufferEditor(filePath, { rows: size.rows, cols: size.cols });
      setEditor(ed);
      // immediately render the new file
      ed.windowRows = size.rows;
      ed.windowCols = size.cols;
      const tokens = ed.render();
      setContent(tokens.map(line => line.map(t => t.ansi||t.text).join('')).join('\n'));
    } else {
      setEditor(null);
      setContent('No file open');
    }
  }, [filePath]);

  // 2) update size on resize
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const update = () => {
      setSize({ cols: box.width, rows: box.height });
    };
    update();
    box.on('resize', update);
    return () => box.removeListener('resize', update);
  }, []);

  // 2) Whenever size (or after edits) changes, re-render file + caret
  const refresh = () => {
    if(filePath==null){
        return
    }
    editor.windowCols = size.cols;
    editor.windowRows = size.rows;

    // render tokens → ANSI string
    const tokenLines = editor.render();
    const ansi = tokenLines
      .map(line =>
        line.map(t => t.ansi || t.text).join('')
      )
      .join('\n');
    setContent(ansi);

    // compute caret info
    const { rowInWindow, colInWindow } = editor.getCursorWindowCoords();
    const style = editor.cursorStyle;
    const char  = editor.cursorChar;
    setCaret({
      row: rowInWindow,
      col: colInWindow,
      style,
      char
    });
  };

  // run once on size change
  useEffect(refresh, [size]);

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
    refresh();
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
      content={content}
      tags={false}           // raw ANSI
      scrollable={false}
      onKeypress={internalOnKeypress}
      label={`Editing: ${filePath}`}
    >
      {/* caret overlay */}
      <box
        top={caret.row}
        left={caret.col}
        width={1}
        height={1}
        content={caret.char}
        tags={false}
        style={{...caret.style,inverse: true}}
      />
    </box>
  );
}
