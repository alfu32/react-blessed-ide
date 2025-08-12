// src/FileTree.js
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
        "Whitespace":     {style: {fg:'white'},pattern:/\s+/mgi},
        "Folder":         {style: {fg:'white'},pattern:/(?<=\[[-+]])\S+/mgi},
        "OpenButton":     {style: {fg:'yellow'},pattern:/\[\+]/mgi},
        "CloseButton":    {style: {fg:'yellow'},pattern:/\[-]/mgi},
        "AddDirButton":   {style: {fg:'cyan'},pattern:/\[\+D]/mgi},
        "AddFileButton":  {style: {fg:'magenta'},pattern:/\[\+F]/mgi},
        "RenameButton":   {style: {fg:'blue'},pattern:/\[r]/mgi},
        "DeleteButton":   {style: {fg:'red'},pattern:/\[x]/mgi},
        "NodeName":       {style: {fg:'green'},pattern:/[a-zA-Z0-9_={}\[\]%*()m,.:;!?@~-]+/mgi},
        "Word":           {style: {fg:'green'},pattern:/\s.+?\s/mgi},
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
export default function FileTree({
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
    const [workspace,setWorkspace] = useState(new Workspace(inodeFilter));



    // focus the modal so it can catch keypresses
    useEffect(() => {
        const node = boxRef.current;
        if (node) node.focus();
        workspace.init(rootDir)
            .then(wk => workspace.open(workspace.rootNode))
            .then(wk => {
                setTimeout(()=>{
                    setWorkspace(wk.copy())
                },100)
                /// setMessage(`loaded tree data ${JSON.stringify({
                ///   wk
                /// })}`)
            })
        // setWorkspace(workspace.copy())
    }, [rootDir]);
    let baseLevel=rootDir.split("/").length*2
    if (baseLevel>0) {
       baseLevel = baseLevel-1
    }
    let lines = () => {
        try{
            const lpos = boxRef.current.lpos
            const treeData = workspace.flatten().filter(inodeFilter)

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
        }catch(err){
            return []
        }
    }
    const onTokenClick=(eventData)=>{
        const treeData = workspace.flatten().filter(inodeFilter)
        const {lines, visibleLines, line, cursor:{x,y},cursorScreen, buffer, visibleBuffer, index,tokens,tokenUnderCursor,phrase} = eventData
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
                        // setCursorData({cursor:{x:0,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "RenameButton":
                        setMessage(`Rename\n${node.fullPath}`)
                        // setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "DeleteButton":
                        setMessage(`Delete\n${node.fullPath}`)
                        // setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
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
                            // setCursorData({cursor:{x,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        })
                        break;
                    case "CloseButton":
                        node.close()
                        const wk=workspace.copy()
                        const td = wk.flatten().filter(inodeFilter)
                        setWorkspace(wk)
                        // setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "NodeName":
                        setSelected(node);
                        onDirSelect(node);
                        // setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "AddDirButton":
                        setMessage(`AddDir\n${node.fullPath}`)
                        // setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "AddFileButton":
                        setMessage(`AddFile\n${node.fullPath}`)
                        // setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "RenameButton":
                        setMessage(`Rename\n${node.fullPath}`)
                        // setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "DeleteButton":
                        setMessage(`Delete\n${node.fullPath}`)
                        // setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
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
        return <box key={`xcursor-${Math.random()}-${Date.now()}`}
            top={cursorScreen.y} left={cursorScreen.x}
            width={content.length} height={1}
            style={{inverse: true}}
            content={content}
        />
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
                onTokenClick={onTokenClick}
                tokenizerDef={listingTokenizerDefinition}
            />
            {/*<box top={0} content={selected ? selected.fullPath : '' + ' ' + label} height={1}/>*/}
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

