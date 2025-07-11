// components/ModalDialog.js
import React, { useEffect, useRef,useState } from 'react';
import { BoxElement as box, TextElement as text } from 'react-blessed';
import FileTree from "./FileTree";

export default function FolderPickerDialog({
    title = 'Dialog',
    width = '50%',
    height = '50%',
    onClose,
    onFolderSelect,
}) {
    const boxRef = useRef();
    const [treeData, setTreeData]   = useState([]);
    const [workspace,setWorkspace] = useState(new Workspace())

    // focus the modal so it can catch keypresses
    useEffect(() => {
        const node = boxRef.current;
        if (node) node.focus();
        workspace.init('/')
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
    }, []);
    const selectDir = async (dir) => {
        /**
         *
         * @param {INode} dir
         * @returns {Promise<void>}
         */
        if (dir.isOpen) {
            dir.close()
            const wk=workspace.copy()
            const td = wk.flatten()
            setWorkspace(wk)
            setTreeData(td)
        } else {
            dir.open(workspace.rootDir,workspace.ig).then(n => {
                const wk=workspace.copy()
                const td = wk.flatten()
                setWorkspace(wk)
                setTreeData(td)
            })

        }
    }
    const selectFile = async (dir) => {
        /**
         *
         * @param {INode} dir
         * @returns {Promise<void>}
         */

        // setMessage(`dir selected ${Object.keys(dir)}`)
    };
    return (<box
            ref={boxRef}
            top="center"
            left="center"
            width={width}
            height={height}
            border={{ type: 'line' }}
            style={{ bg: 'black', fg: 'white' }}
            keys
            mouse
            clickable
            // close on ESC
            onKey={(ch, key) => {
                if (key.name === 'escape') onClose();
            }}
        >
            {/* Header with title and close button */}
            <box height={1} width="100%" style={{ fg: 'green' }}>
                <text bold>{` ${title}`} </text>
                <text
                    right={0}
                    mouse
                    clickable
                    underline
                    onClick={onClose}
                >[×]</text>
            </box>

            {/* Content area */}
            <box top={2} left={1} right={1} bottom={1} scrollable keys mouse alwaysScroll>
                <FileTree top={1} bottom={0} workspace={workspace} treeData={treeData} onDirSelect={selectDir} onFileSelect={selectFile}/>
            </box>
            <box top={3} height={1}>
                <text
                    mouse
                    clickable
                    underline
                    onClick={() => {
                        /* do something */
                        onFolderSelect()
                        setShowModal(false);
                    }}
                >Select</text>
                <text left={6}
                      mouse
                      clickable
                      underline
                      onClick={() => {
                          setShowModal(false)
                          onClose()
                      }}
                >Cancel</text>
            </box>
        </box>
    )
}
