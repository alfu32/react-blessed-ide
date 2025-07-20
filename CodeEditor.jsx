import React, { useEffect, useState, useRef } from 'react'
import { BoxElement as box, TextElement as text,ListElement as list } from 'react-blessed';
import {getTokenizer,highlight} from './tokenizer'

export function CodeEditor({
  width = '100%',
  height = '100%',
  initialText = '',
  onKeypress=(ch,key) =>{},
  onChange = (p) => {},
  ...boxProps
}) {
  const [text, setText] = useState(initialText)
  const [cursorOffset, setCursorOffset] = useState(0)
  const [cursorVisible, setCursorVisible] = useState(true)
  const boxRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const node = boxRef.current.widget || boxRef.current
    const handler = () => setSize({ width: node.width-2, height: node.height-2 })

    handler()
    node.screen.on('resize', handler)
    node.on('resize', handler)
    return () => {
      node.screen.off('resize', handler)
      node.off('resize', handler)
    }
  }, [])
  useEffect(() => {
    setText(initialText)
    setCursorOffset(0)
  }, [initialText])

  useEffect(() => {
    onChange({ text, cursorOffset })
  }, [text, cursorOffset])
  useEffect(() => {
    const lines = text.slice(0, cursorOffset).split('\n')
    const lineIndex = lines.length - 1
  
    if (lineIndex < scrollTop) {
      setScrollTop(lineIndex)
    } else if (lineIndex >= scrollTop + size.height) {
      setScrollTop(lineIndex - size.height + 1)
    }
  }, [cursorOffset])

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
      const lineIndex=lines.length-1
      if (lines.length > 1) {
        const before=lines[lines.length-1].length
        const prevLine = lines[lines.length - 2]
        const prev=prevLine.length
        newCursor -= before + 1
        if (prev > before) {
          newCursor-=prev-before
        }
      }
      if (lineIndex - 1 < scrollTop) {
        setScrollTop(Math.max(0, scrollTop - 1))
      }
    } else if (key.name === 'down') {
      const lines = text.split('\n')
      const index = text.slice(0, newCursor).split('\n').length - 1
      const col = newCursor - text.lastIndexOf('\n', newCursor - 1) - 1
      const lineIndex=index
      if (index < lines.length - 1) {
        const below = lines[index + 1]
        newCursor += lines[index].length - col + 1 + Math.min(below.length, col)
      }
      if (lineIndex + 1 >= scrollTop + size.height){
        setScrollTop(scrollTop + 1)
      }
    } else if (key.name === 'backspace') {
      if (newCursor > 0) {
        newText = newText.slice(0, newCursor - 1) + newText.slice(newCursor)
        newCursor--
      }
    } else if (key.full === 'return') {
      newText = newText.slice(0, newCursor) + '\n' + newText.slice(newCursor)
      newCursor++
    } else if (typeof ch === 'string' && ch.length === 1 && !key.ctrl && !key.meta) {
      newText = newText.slice(0, newCursor) + ch + newText.slice(newCursor)
      newCursor++
    }
    onKeypress({ch,key})

    setText(newText)
    setCursorOffset(newCursor)
  }

  const cursorStyle={underline:true,inverse:true}
  const renderLOC = (line,y,offset,ll) =>{
      const lineNum = '│ ' + String(scrollTop+y + 1).padStart(ll) + ' │'
      const lineBox=<box key={`${y}-linenum`} left={0} height={1} content={lineNum} style={{ fg:'#aaaaaa' }}/>

      const tokens = highlight(line)
      let inlineOffset = 0

      const renderedLine = (
        <box key={y} top={1+y-scrollTop} left={0} height={1}>
          {lineBox}
          {tokens.filter(tk => tk.start<size.width).map((token, i) => {
              // const tx=`${token.text}[${token.color}]`
              let tx = token.text
              const containsCursor = cursorOffset >= offset && cursorOffset < (offset + tx.length)
              const style=token.style
              let bx = <box
                key={`${y}-${i}`}
                left={lineNum.length + token.start}
                content={tx}
                style={style}
              />
              if(containsCursor){
                const cursorPos = cursorOffset - offset
                let at = tx[cursorPos]
                at = ['\n','\r'].indexOf(at)>-1 ? `${at}_`: at
                bx = <box
                    key={`${y}-${i}`}
                    left={lineNum.length + token.start}
                >
                  <box
                    key={`${y}-${i}`}
                    left={0}
                    content={tx}
                    style={style}
                  />
                  <box
                      key={`${y}-${i}-at`}
                      left={cursorPos}
                      width={1}
                      content={at}
                      style={{...style, ...cursorStyle}}
                  />
                  
                </box>
              }
              inlineOffset+=tx.length
              offset+=tx.length
              return [bx]
            })
          }
        </box>
      )
      offset+=1
      return [renderedLine,offset]
  }

  const renderWithCursor = () => {
    const lines = text.split('\n')
    const linesLength = Math.trunc(Math.log10(lines.length)) + 1
    let offset = 0

    return lines.slice(scrollTop, scrollTop + size.height)
    .map((line, y,lines) => {
      let [loc,offsetOut] = renderLOC(line,y,offset,linesLength)
      offset=offsetOut
      return loc
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
      onKeypress={handleKeyPress}
      {...boxProps}
    >
      {renderWithCursor()}
    </box>
  )
}
