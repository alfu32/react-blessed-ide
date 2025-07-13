import React, { useEffect, useState, useRef } from 'react'
import { BoxElement as box, TextElement as text,ListElement as list } from 'react-blessed';
import {getTokenizer,highlight} from './tokenizer'

export function BlessedTextEditor({
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
    const before = text.slice(0, cursorOffset)
    const at = text[cursorOffset] || ' '
    const after = text.slice(cursorOffset + 1)
    const content = before + at + after
    const lines = content.split('\n')
    const ll= Math.trunc(Math.log10(lines.length)) + 1

    return lines.map((line, y) => {
      const lineStartOffset = lines.slice(0, y).reduce((acc, l) => acc + l.length + 1, 0)
      const tokens = highlight(line)
      const lineNum = '│ ' + String(y + 1).padStart(ll) + ' │'
      let offset = 0

      return (
        <box key={y} top={y} left={0} height={1}>
          <box left={0} content={lineNum} style={{ fg:'#aaaaaa' }}/>
          {tokens.flatMap((token, i) => {
                
                // const tx=`${token.text}[${token.color}]`
                let tx = token.text
                const containsCursor = cursorOffset > offset && cursorOffset <(offset + tx.length)
                const cursorPos =   cursorOffset - offset
                const style={
                    fg: token.color,
                  }
                if(containsCursor){
                    const before = tx.slice(0, cursorPos)
                    const at = tx[cursorPos] || ' '
                    const after = tx.slice(cursorPos + 1)
                    const bx = <box
                      key={`${i}`}
                      left={lineNum.length + offset}
                      content={tx}
                      style={style}
                    />
                    offset+=tx.length
                    return [bx]
                } else {
                    const bx = <box
                      key={`${i}`}
                      left={lineNum.length + offset}
                      content={tx}
                      style={style}
                    />
                    offset+=tx.length
                    return [bx]

                }
          })}
        </box>
      )
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
