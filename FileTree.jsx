// components/FileTree.js
import React, { Component } from 'react';
import { ListElement as list, TextElement as text, BoxElement as box } from 'react-blessed';
import { Workspace,INode } from './services/WorkspaceService';
import {safeStringify} from "./util";

/**
 *
 * @param {INode[]} tree
 * @param {(node:INode)->undefined} onDirSelect
 * @param {(node:INode)->undefined} onFileSelect
 * @returns {JSX.Element}
 * @constructor
 */
export default function FileTree({children,workspace,treeData, onDirSelect, onFileSelect,label,...boxProps}){
    const [selected, setSelected] = React.useState(null);
    // let treeData = workspace.flatten()
    let lines = (treeData||[]).map((v,i,a) => {
        return v.toText();
    })
    const itemSelect=(n,idx)=>{
        const node = treeData[idx];
        //throw JSON.stringify({node,idx},null, ' ')
        if (node.type.indexOf('d')>-1) {
            onDirSelect(node);
        } else {
            if(selected!==null && selected===node){
                onFileSelect(node);
            } else {
                setSelected(node);
            }
        }
    }
    return (
        // <>
        //     <text>{workspacePath}</text>
        //     <text>{JSON.stringify(items,null,' ')}</text>
        // </>
        <box {...boxProps}>
            <list
                scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
                top={1}
                bottom={4}
                items={lines}
                keys mouse
                style={{ selected: { bg: 'blue' } }}
                onSelect={itemSelect}
                onSelectItem={itemSelect}
                label={label}
            />
            {children||[]}
        </box>
    );
}

