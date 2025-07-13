import React, { useEffect, useState, useRef } from 'react'
import { BoxElement as box, TextElement as text,ListElement as list } from 'react-blessed';

function highlight(line) {
  const tokens = []
  const regexes = [
    { regex: /\/\/.*/g, style: { fg: 'gray' } },
    { regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, style: { fg: 'yellow' } },
    { regex: /\b(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)\b/g, style: { fg: 'cyan' } }
  ]

  let cursor = 0
  while (cursor < line.length) {
    let matched = false
    for (const { regex, style } of regexes) {
      regex.lastIndex = cursor
      const match = regex.exec(line)
      if (match && match.index === cursor) {
        tokens.push({ text: match[0], style })
        cursor += match[0].length
        matched = true
        break
      }
    }
    if (!matched) {
      tokens.push({ text: line[cursor], style: {color:'green'} })
      cursor++
    }
  }
  return tokens
}

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

    return lines.map((line, y) => {
      const lineStartOffset = lines.slice(0, y).reduce((acc, l) => acc + l.length + 1, 0)
      const tokens = highlight(line)

      let offset = 0

      return (
        <box key={y} top={y} left={0} height={1}>
          <text left={0} style={{ fg: 'red' }}>
            {String(y + 1).padStart(3)}│
          </text>
          {tokens.map((token, i) => {
            const result = [...token.text].map((char, j) => {
              const absOffset = lineStartOffset + offset + j
              const isCursor = absOffset === cursorOffset
              return (
                <box
                  key={`${i}-${j}`}
                  left={4 + offset + j}
                  style={isCursor ? { bg: 'white', fg: 'black' } : token.style}
                >
                  {char}
                </box>
              )
            })
            offset += token.text.length
            return result
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
