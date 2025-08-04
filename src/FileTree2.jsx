// src/FileTree2.js
import React, {Component, useEffect, useRef, useState} from 'react';
import { ListElement as list, TextElement as text, BoxElement as box } from 'react-blessed';
import { Workspace,INode } from './Workspace';
import {safeStringify} from "./util";
import {ListComponent} from "./ListComponent";

/**
 *
 * @param {INode[]} tree
 * @param {(node:INode)->undefined} onDirSelect
 * @param {(node:INode)->undefined} onFileSelect
 * @returns {JSX.Element}
 * @constructor
 */
export default function FileTree2({
    children,
    rootDir,
    onDirSelect,
    onFileSelect,
    label,
    inodeFilter=(inode,index,nodes,parent)=>{return true},
    ...boxProps
}){
    const boxRef = useRef();
    const [selected, setSelected] = React.useState(null);
    const [cursorData, setCursorData] = React.useState(null);
    const [selectionData, setSelectionData] = React.useState(null);
    const [treeData, setTreeData]   = useState([]);
    const [workspace,setWorkspace] = useState(new Workspace(inodeFilter));
    const [mouseCoords, setMouseCoords] = useState({x:0,y:0});

    // focus the modal so it can catch keypresses
    useEffect(() => {
        const node = boxRef.current;
        if (node) node.focus();
        workspace.init(rootDir)
            .then(wk => workspace.open(workspace.rootNode))
            .then(t => {
                const wk=workspace.copy()
                const td = workspace.flatten().filter(inodeFilter)
                setWorkspace(wk)
                setTreeData(td)
                // setMessage(`loaded tree data ${JSON.stringify({
                //   td
                // })}`)
            })
        setWorkspace(workspace.copy())
    }, [rootDir]);
    // let treeData = workspace.flatten()
    let lines = (treeData||[]).map((v,i,a) => {
        return v.toText();
    })
    const itemSelect=(eventData)=>{
        const {lines, visibleLines, line, cursor:{x,y},cursorScreen, buffer, visibleBuffer, index} = eventData
        setSelectionData({lines, visibleLines, line, cursor:{x,y}, buffer, visibleBuffer, index})
        const node = treeData[y];
        // throw JSON.stringify({node,y},null, ' ')
        // if (node.type.indexOf('d')>-1) {
        if (node.type.indexOf('d')>-1) {
            const tk=line.split(/(\[\+])|(\[\-])/gi)
            const [empty,sign,name] = [tk[0],line.substring(tk[0].length,tk[0].length+3),tk[1]];


            // throw JSON.stringify({dir})
            if(x>=(empty.length) && x<(empty.length+sign.length)) {
                //if on [+] or [-] toggle open/close
                if (node.isOpen) {
                    node.close()
                    const wk=workspace.copy()
                    const td = wk.flatten().filter(inodeFilter)
                    setWorkspace(wk)
                    setTreeData(td)
                    setCursorData({cursor:{x,y},cursorScreen:{x:empty.length,y:cursorScreen.y},content:'[+]'})
                } else {
                    node.open(workspace.rootDir,workspace.ig).then(n => {
                        const wk=workspace.copy()
                        const td = wk.flatten().filter(inodeFilter)
                        setWorkspace(wk)
                        setTreeData(td)
                        setCursorData({cursor:{x,y},cursorScreen:{x:empty.length,y:cursorScreen.y},content:'[-]'})
                    })
                }
            }else if (x>=(empty.length+sign.length)) {
                setSelected(node);
                onDirSelect(node);
                setCursorData({cursor:{x:0,y},cursorScreen:{x:0,y:cursorScreen.y},content:line})
            }
        } else {
            setSelected(node);
            onFileSelect(node);
            setCursorData({cursor:{x:0,y},cursorScreen:{x:0,y:cursorScreen.y},content:line})
        }
    }
    const cursorExtra=()=>{
        if(!cursorData) return <box top={0} left={0} width={1} height={1} content={' '}/>;
        const {cursor,cursorScreen,content} = cursorData
        const {x,y} = mouseCoords
        return <box key={`xcursor-${Math.random()}-${Date.now()}`}
            top={cursorScreen.y} left={cursorScreen.x}
            width={content.length} height={1}
            style={{inverse: true}}
            content={content}
        />
    }
    const mouseAction=(event) =>{
        const {x,y} = event

        switch(event.action){
            case 'mousemove':break;
            case 'mousedown':break;
            case 'mouseup':break;
            case 'wheelup':setCursorData(null);break;
            case 'wheeldown':setCursorData(null);break;
            default: throw new Error(safeStringify(event)); break;
        }
        setMouseCoords({x,y});
        try{
            boxProps.onMouse(event);
        }catch(e){}
    }
    return (
        // <>
        //     <text>{workspacePath}</text>
        //     <text>{JSON.stringify(items,null,' ')}</text>
        // </>
        <box {...boxProps}>
            <ListComponent
                scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
                top={0}
                bottom={2}
                lines={lines}
                keys mouse
                style={{ selected: { bg: 'blue' } }}
                onClick={itemSelect}
                onMouse={mouseAction}
            />
            <box top={0} content={selected?selected.fullPath:'' + ' ' + label} height={1}/>
            {children||[]}
            {cursorExtra()}
        </box>
    );
}

