// components/ModalDialog.js
import React, { useEffect, useRef,useState } from 'react';
import { BoxElement as box, TextElement as text, ButtonElement as button } from 'react-blessed';
import FileTree2 from "./FileTree2";
import {Workspace} from "./Workspace";

export default function FolderPickerDialog({
    title = 'Dialog',
    width = '50%',
    height = '50%',
    onFolderSelect,
}) {
    const [selected, setSelected] = React.useState(null);

    return (
        <FileTree2
            top="center"
            left="center"
            border={{ type: 'line' }}
            style={{ bg: 'black', fg: 'white' }}
            keys
            mouse
            clickable
            // close on ESC
            onKey={(ch, key) => {
                if (key.name === 'escape') onFolderSelect(null);
            }}
            label={selected?selected.fullName:'Pick Workspace'}
            rootDir={'/'}
            onDirSelect={(selectDir) => {
                setSelected(selectDir);
            }}
            onFileSelect={()=>{}}
        >
            <button
                mouse
                keys
                input
                clickable
                focused
                left={0}
                bottom={0}
                height={3}
                width={'45%'}
                valign={'middle'}
                align={'center'}
                style={{bg:'#ffaa00',fg:'#333333',hover:{bg:'#ffdd88',fg:'#333333'}}}
                onClick={() => {
                    /* do something */
                    onFolderSelect(selected)
                }}
                content={'select'}
            />
            <button
                    mouse
                    keys
                    input
                    clickable
                    focused
                    right={0}
                    bottom={0}
                    height={3}
                    valign={'middle'}
                    align={'center'}
                    width={'45%'}
                    style={{bg:'#ffaa00',fg:'#333333',hover:{bg:'#ffdd88',fg:'#333333'}}}
                  onClick={() => {
                      onFolderSelect(null)
                  }}
                    content={'cancel'}
            />
        </FileTree2>
    )
}
