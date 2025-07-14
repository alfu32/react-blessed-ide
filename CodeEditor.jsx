import React, { useEffect, useState, useRef } from 'react'
import { BoxElement as box, TextElement as text,ListElement as list } from 'react-blessed';
import {getTokenizer,highlight} from './tokenizer'

export function CodeEditor({
  width = '100%',
  height = '100%',
  initialText = '',
  onChange = () => {},
  ...boxProps
}) {
  const [text, setText] = useState(initialText)
  const [cursorOffset, setCursorOffset] = useState(0)
  const [cursorVisible, setCursorVisible] = useState(true)
  const boxRef = useRef(null)
  useEffect(() => {
    setText(initialText)
    setCursorOffset(0)
  }, [initialText])

  useEffect(() => {
    if (boxRef.current) boxRef.current.focus()
  }, [])

  useEffect(() => {
    onChange({ text, cursorOffset })
  }, [text, cursorOffset])

  const handleKeyPress = (ch, key) => {
    let newText = text
    let newCursor = cursorOffset

    if (key.name === 'left') {
      newCursor = Math.max(0, newCursor - 1)
    } else if (key.name === 'right') {
      newCursor = Math.min(newText.length, newCursor + 1)
    } else if (key.name === 'up') {
      const lines = text.slice(0, newCursor).split('\n')
      const col = lines.at(-1)?.length || 0
      if (lines.length > 1) {
        const prevLine = lines[lines.length - 2]
        newCursor -= col + 1 + Math.min(prevLine.length, col)
      }
    } else if (key.name === 'down') {
      const lines = text.split('\n')
      const index = text.slice(0, newCursor).split('\n').length - 1
      const col = newCursor - text.lastIndexOf('\n', newCursor - 1) - 1
      if (index < lines.length - 1) {
        const below = lines[index + 1]
        newCursor += lines[index].length - col + 1 + Math.min(below.length, col)
      }
    } else if (key.name === 'backspace') {
      if (newCursor > 0) {
        newText = newText.slice(0, newCursor - 1) + newText.slice(newCursor)
        newCursor--
      }
    } else if (key.full === 'return') {
      newText = newText.slice(0, newCursor) + '\n' + newText.slice(newCursor)
      newCursor++
    } else if (typeof ch === 'string' && ch.length === 1) {
      newText = newText.slice(0, newCursor) + ch + newText.slice(newCursor)
      newCursor++
    }

    setText(newText)
    setCursorOffset(newCursor)
  }

  const renderWithCursor = () => {
    const lines = text.split('\n')
    const ll= Math.trunc(Math.log10(lines.length)) + 1
    let offset = 0

    return lines.map((line, y) => {
      const lineStartOffset = lines.slice(0, y).reduce((acc, l) => acc + l.length + 1, 0)
      const tokens = highlight(line)
      const lineNum = '│ ' + String(y + 1).padStart(ll) + ' │'
      let inlineOffset = 0
      let lineOffset = offset
      /// return <box
      ///     key={`${y}`}
      ///     left={lineNum.length + inlineOffset + cursorPos}>{}</box>

      const renderedLine = (
        <box key={y} top={y} left={0} height={1}>
          <box left={0} height={1} content={lineNum} style={{ fg:'#aaaaaa' }}/>
          {tokens.map((token, i) => {
                if(token.text.length === 0){
                  return []
                }
                let bx=[]
                // const tx=`${token.text}[${token.color}]`
                let tx = token.text
                const containsCursor = cursorOffset > offset && cursorOffset <(offset + tx.length)
                const cursorPos =   cursorOffset - offset
                const style=token.style
                if(containsCursor){
                  if (tx.length <= 1) {
                    bx= <box
                        key={`${y}-${i}`}
                        left={lineNum.length + token.start + cursorPos}
                        content={'_'}
                        style={{fg:'black',underline:true,bg:'white'}}
                    />
                  } else {
                      let before = tx.substring(0, cursorPos)
                      let at = tx[cursorPos] || '.'
                      let after = tx.substring(cursorPos + 1)
                      bx = <box
                          key={`${y}-${i}`}
                          left={lineNum.length + token.start}
                          style={{...style}}
                      >
                        {before !== '' && (<box
                            key={`${y}-${i}-before`}
                            left={0}
                            content={before}
                            style={style}
                        />)}
                        {(<box
                            key={`${y}-${i}-at`}
                            left={cursorPos}
                            content={at !== '' ? at : '_'}
                            style={{...style, underline:true,bg:'white'}}
                        />)}
                        {after !== '' && (<box
                            key={`${y}-${i}-after`}
                            left={cursorPos + 1}
                            content={after}
                            style={style}
                        />)}
                      </box>
                  }
                } else {
                    bx = <box
                      key={`${y}-${i}`}
                      left={lineNum.length + token.start}
                      content={tx}
                      style={style}
                    />

                }
              inlineOffset+=tx.length
              offset+=tx.length
              return [bx]
            })
          }
        </box>
      )
      offset+=1
      return renderedLine
    })
  }

  return (
    <box
      ref={boxRef}
      label=" Blessed Editor "
      border={{ type: 'line' }}
      style={{ border: { fg: 'cyan' } }}
      width={width}
      height={height}
      mouse
      keys
      input
      clickable
      focused
      scrollable
      alwaysScroll
      onKeypress={handleKeyPress}
      {...boxProps}
    >
      {renderWithCursor()}
    </box>
  )
}
