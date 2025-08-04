// src/FileTree2.js
import React, {Component, useEffect, useRef, useState} from 'react';
import { ListElement as list, TextElement as text, BoxElement as box } from 'react-blessed';
import { Workspace,INode } from './Workspace';
import {insertAt, safeStringify} from "./util";
import {ListComponent} from "./ListComponent";
import ModalDialog from "./ModalDialog";

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
    const [selectionData, setSelectionData] = React.useState(null);
    const [treeData, setTreeData]   = useState([]);
    const [workspace,setWorkspace] = useState(new Workspace(inodeFilter));
    const [mouseCoords, setMouseCoords] = useState({x:0,y:0});
    const listingTokenizerDefinition={
        name:'listing',
        flags:'mg',
        definitions:{
            "Whitespace":     {style: {fg:'white'},pattern:'\\s+'},
            "OpenButton":     {style: {fg:'yellow'},pattern:'\\[\\+]'},
            "CloseButton":    {style: {fg:'yellow'},pattern:'\\[-]'},
            "AddDirButton":   {style: {fg:'cyan'},pattern:'\\[\\+D]'},
            "AddFileButton":  {style: {fg:'magenta'},pattern:'\\[\\+F]'},
            "RenameButton":   {style: {fg:'blue'},pattern:'\\[r]'},
            "DeleteButton":   {style: {fg:'red'},pattern:'\\[x]'},
            "NodeName":       {style: {fg:'green'},pattern:'[a-zA-Z0-9_=\\{\\}\\[\\]%*()=m,.:;!?@~\\\\-]+'},
            "Word":           {style: {fg:'green'},pattern:'\\s.+?\\s'},
        }
    }



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
    let lines = () => {
        if(boxRef && boxRef.current && boxRef.current.lpos) {
            const lpos = boxRef.current.lpos

            return (treeData || []).map((v, i, a) => {
                const lineBuffer = " ".repeat(lpos.width)
                const t = v.toText()
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
    const itemSelect=(eventData)=>{
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
                        setCursorData({cursor:{x:0,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text})
                        break;
                    case "RenameButton":
                        setMessage(`Rename\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text})
                        break;
                    case "DeleteButton":
                        setMessage(`Delete\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text})
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
                            setCursorData({cursor:{x,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text})
                        })
                        break;
                    case "CloseButton":
                        node.close()
                        const wk=workspace.copy()
                        const td = wk.flatten().filter(inodeFilter)
                        setWorkspace(wk)
                        setTreeData(td)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text})
                        break;
                    case "NodeName":
                        setSelected(node);
                        onDirSelect(node);
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text})
                        break;
                    case "AddDirButton":
                        setMessage(`AddDir\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text})
                        break;
                    case "AddFileButton":
                        setMessage(`AddFile\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text})
                        break;
                    case "RenameButton":
                        setMessage(`Rename\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text})
                        break;
                    case "DeleteButton":
                        setMessage(`Delete\n${node.fullPath}`)
                        setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text})
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
        <>
        <box {...boxProps} ref={boxRef}>
            <ListComponent
                scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
                top={0}
                bottom={2}
                lines={lines()}
                keys mouse
                style={{ selected: { bg: 'blue' } }}
                onClick={itemSelect}
                onMouse={mouseAction}
                tokenizerDef={listingTokenizerDefinition}
            />
            <box top={0} content={selected?selected.fullPath:'' + ' ' + label} height={1}/>
            {children||[]}
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

