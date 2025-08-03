// components/FileTree.js
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
export default function FileTree2({children,rootDir, onDirSelect, onFileSelect,label,...boxProps}){
    const boxRef = useRef();
    const [selected, setSelected] = React.useState(null);
    const [treeData, setTreeData]   = useState([]);
    const [workspace,setWorkspace] = useState(new Workspace());

    // focus the modal so it can catch keypresses
    useEffect(() => {
        const node = boxRef.current;
        if (node) node.focus();
        workspace.init(rootDir)
            .then(wk => workspace.open(workspace.rootNode))
            .then(t => {
                const wk=workspace.copy()
                const td = workspace.flatten()
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
        const {lines, visibleLines, line, cursor:{x,y}, buffer, visibleBuffer, index} = eventData
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
                    const td = wk.flatten()
                    setWorkspace(wk)
                    setTreeData(td)
                } else {
                    node.open(workspace.rootDir,workspace.ig).then(n => {
                        const wk=workspace.copy()
                        const td = wk.flatten()
                        setWorkspace(wk)
                        setTreeData(td)
                    })
                }
            }else if (x>=(empty.length+sign.length)) {
                setSelected(node);
            }
        } else {
            setSelected(node);
        }
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
            />
            <box top={0} content={label} height={1}/>
            {children||[]}
        </box>
    );
}

