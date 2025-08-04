// components/FileTree.jsx
import React, { Component } from 'react';
import { ListElement as list, TextElement as text, BoxElement as box } from 'react-blessed';
import { Workspace,INode } from '../src/Workspace';
import {safeStringify} from "../src/util";
import {ListComponent} from "../src/ListComponent";

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
    const itemSelect=(eventData)=>{
        const {lines, visibleLines, line, cursor:{x,y}, buffer, visibleBuffer, index} = eventData
        const node = treeData[y];
        // throw JSON.stringify({node,y},null, ' ')
        // if (node.type.indexOf('d')>-1) {
        if (node.type.indexOf('d')>-1) {
            onDirSelect(node);
            setSelected(node);
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
            <ListComponent
                scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
                top={1}
                bottom={4}
                lines={lines}
                keys mouse
                style={{ selected: { bg: 'blue' } }}
                onClick={itemSelect}
                label={label}
            />
            {children||[]}
        </box>
    );
}

