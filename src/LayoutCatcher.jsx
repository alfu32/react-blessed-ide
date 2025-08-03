import React, { useRef, useState, useEffect } from 'react'

export function LayoutCatcher(props) {
  const ref = useRef()
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const node = ref.current.widget || ref.current
    const handler = () => setSize({ width: node.width, height: node.height })

    handler()
    node.screen.on('resize', handler)
    node.on('resize', handler)
    return () => {
      node.screen.off('resize', handler)
      node.off('resize', handler)
    }
  }, [])

  return (
    <box ref={ref} {...props}>
      {JSON.stringify(size,null,'  ')}
    </box>
  )
}