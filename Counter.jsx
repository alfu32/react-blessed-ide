import React, { useState,useEffect } from 'react';
import { BoxElement as box, TextElement as text,ListElement as list } from 'react-blessed';


export default function Counter(props,children) {
    const [count,setCount] = useState(props.count)
    useEffect(() => {
        const t = setTimeout(()=>{
            setCount(count + 1)
        },1000)
        return () => {clearTimeout(t)}
    }, [count]);
    return <box>
        <text>{count}</text>
    </box>
}