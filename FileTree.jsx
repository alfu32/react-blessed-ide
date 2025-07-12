// components/FileTree.js
import React, { Component } from 'react';
import { ListElement as list, TextElement as text, BoxElement as box } from 'react-blessed';
import { Workspace,INode } from './services/WorkspaceService';

/**
 *
 * @param {INode[]} tree
 * @param {(node:INode)->undefined} onDirSelect
 * @param {(node:INode)->undefined} onFileSelect
 * @returns {JSX.Element}
 * @constructor
 */
export default function FileTree({workspace,treeData, onDirSelect, onFileSelect,label}){
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
            onFileSelect(node);
        }
    }
    return (
        // <>
        //     <text>{workspacePath}</text>
        //     <text>{JSON.stringify(items,null,' ')}</text>
        // </>
        <box label={label}>
            <text>{label}</text>
            <list
                top={0}
                bottom={1}
                items={lines}
                keys mouse
                style={{ selected: { bg: 'blue' } }}
                onSelect={itemSelect}
                label={label}
            />
        </box>
    );
}

