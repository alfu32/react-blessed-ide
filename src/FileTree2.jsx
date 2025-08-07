// src/FileTree2.js
import React, {Component, useEffect, useRef, useState} from 'react';
import { ListElement as list, TextElement as text, BoxElement as box } from 'react-blessed';
import { Workspace,INode } from './Workspace';
import {insertAt, safeStringify} from "./util";
import {ListComponent} from "./ListComponent";
import ModalDialog from "./ModalDialog";

const listingTokenizerDefinition={
    name:'listing',
    flags:'mg',
    definitions:{
        "Whitespace":     {style: {},pattern:'\\s+'},
        "OpenButton":     {style: {bg:'yellow'},pattern:'\\[\\+]'},
        "CloseButton":    {style: {bg:'yellow'},pattern:'\\[-]'},
        "AddDirButton":   {style: {bg:'cyan'},pattern:'\\[\\+D]'},
        "AddFileButton":  {style: {bg:'magenta'},pattern:'\\[\\+F]'},
        "RenameButton":   {style: {bg:'blue'},pattern:'\\[r]'},
        "DeleteButton":   {style: {bg:'red'},pattern:'\\[x]'},
        "NodeName":       {style: {bg:'green'},pattern:'[a-zA-Z0-9_=\\{\\}\\[\\]%*()=m,.:;!?@~\\\\-]+'},
        "Word":           {style: {bg:'green'},pattern:'\\s.+?\\s'},
    }
}
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
    cursor=true,
    ...boxProps
}){
    const boxRef = useRef();
    const [message, setMessage] = React.useState(false);
    const [selected, setSelected] = React.useState(null);
    const [cursorData, setCursorData] = React.useState(null);
    const [highlightCursorData, setHighlightCursorData] = React.useState(null);
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
    let baseLevel=rootDir.split("/").length*2
    if (baseLevel>0) {
       baseLevel = baseLevel-1
    }
    let lines = () => {
        if(boxRef && boxRef.current && boxRef.current.lpos) {
            const lpos = boxRef.current.lpos

            return (treeData || []).map((v, i, a) => {
                const lineBuffer = " ".repeat(lpos.width)
                const t = v.toText().substring(baseLevel)
                let rr = insertAt(lineBuffer,0,t)
                switch (v.type.substring(0, 1)) {
                    case 'd':
                        rr=insertAt(rr,lpos.width-17,'[+D][+F][r][x]')
                        return rr
                    default:
                        rr=insertAt(rr,lpos.width-9,'[r][x]')
                        return rr
                }
            })
        } else {
            return []
        }
    }
    const highlight=(eventData)=>{
        const {lines, visibleLines, line, cursor:{x,y},cursorScreen, buffer, visibleBuffer, index,tokens,tokenUnderCursor,phrase} = eventData
        setHighlightCursorData({cursor:{x:0,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
    }
    const onElementClick=(eventData)=>{
        const {lines, visibleLines, line, cursor:{x,y},cursorScreen, buffer, visibleBuffer, index,tokens,tokenUnderCursor,phrase} = eventData
        setSelectionData({lines, visibleLines, line, cursor:{x,y}, buffer, visibleBuffer, index,tokens,tokenUnderCursor,phrase})
        const node = treeData[y];
        // throw JSON.stringify({node,y},null, ' ')
        // if (node.type.indexOf('d')>-1) {
        switch(phrase.filter(v => v!=='Whitespace').join(",")){
            case "Whitespace,NodeName":
            case "NodeName,RenameButton,DeleteButton":
                switch((tokenUnderCursor||{type:'undefined'}).type){
                    case "NodeName":
                        setSelected(node);
                        onFileSelect(node);
                        setCursorData({cursor:{x:0,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "RenameButton":
                        setMessage(`Rename\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "DeleteButton":
                        setMessage(`Delete\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                }
                break;
            case "Whitespace,OpenButton,Whitespace,NodeName":
            case "Whitespace,CloseButton,Whitespace,NodeName":
            case "OpenButton,NodeName,AddDirButton,AddFileButton,RenameButton,DeleteButton":
            case "CloseButton,NodeName,AddDirButton,AddFileButton,RenameButton,DeleteButton":
                switch((tokenUnderCursor||{type:'undefined'}).type){
                    case "OpenButton":
                        node.open(workspace.rootDir,workspace.ig).then(n => {
                            const wk=workspace.copy()
                            const td = wk.flatten().filter(inodeFilter)
                            setWorkspace(wk)
                            setTreeData(td)
                            setCursorData({cursor:{x,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        })
                        break;
                    case "CloseButton":
                        node.close()
                        const wk=workspace.copy()
                        const td = wk.flatten().filter(inodeFilter)
                        setWorkspace(wk)
                        setTreeData(td)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "NodeName":
                        setSelected(node);
                        onDirSelect(node);
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "AddDirButton":
                        setMessage(`AddDir\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "AddFileButton":
                        setMessage(`AddFile\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "RenameButton":
                        setMessage(`Rename\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "DeleteButton":
                        setMessage(`Delete\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                }
                break;
            default:
                throw new Error(`Unexpected phrase Structure '${phrase}'`)
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
    const cursorHighlight=()=>{
        if(!highlightCursorData) return <box top={0} left={0} width={1} height={1} content={' '}/>;
        const {cursor,cursorScreen,content,style} = highlightCursorData
        const {x,y} = mouseCoords
        return <box key={`hxcursor-${Math.random()}-${Date.now()}`}
                    top={cursorScreen.y} left={cursorScreen.x}
                    width={content.length} height={1}
                    style={{...style}}
                    content={content}
        />
    }
    // const mouseAction=(event) =>{
    //     const {x,y} = event
    //     setMouseCoords({x,y});
    //     try{
    //         boxProps.onMouse(event);
    //     }catch(e){}
//
    //     switch(event.action){
    //         case 'mousemove':
    //             highlight(event)
    //             break;
    //         case 'mousedown':break;
    //         case 'mouseup':break;
    //         case 'wheelup':setCursorData(null);break;
    //         case 'wheeldown':setCursorData(null);break;
    //         default: throw new Error(safeStringify(event)); break;
    //     }
    // }
    const mouseAction=(event) =>{
        const {x,y} = event
        setMouseCoords({x,y});
        try{
            boxProps.onMouse(event);
        }catch(e){}
        switch(event.action){
            case 'mousemove':
                setCursorData(null)
                highlight(event)
                break;
            case 'mousedown':break;
            case 'mouseup':break;
            case 'wheelup':setCursorData(null);break;
            case 'wheeldown':setCursorData(null);break;
            default: throw new Error(safeStringify(event)); break;
        }
    }
    return (
        <>
        <box {...boxProps} ref={boxRef}>
            <ListComponent
                scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
                top={0}
                bottom={2}
                lines={lines()}
                keys mouse
                style={{ selected: { bg: 'blue' } }}
                onClick={onElementClick}
                onTokenHover={highlight}
                tokenizerDef={listingTokenizerDefinition}
            />
            {/*<box top={0} content={selected ? selected.fullPath : '' + ' ' + label} height={1}/>*/}
            {children||[]}
            {cursorHighlight()}
            {cursor?cursorExtra():[]}
        </box>
        {message && (
            <ModalDialog
                label={'Message'}
                title="Message"
                onClose={() => setMessage(false)}
            >
                <text>{message}</text>
            </ModalDialog>
        )}
    </>
    );
}

