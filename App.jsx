// App.js
import React, {Component, useState,useEffect} from 'react';
import {getStatus} from './services/GitService';
import {Workspace,INode} from './services/WorkspaceService';
import FileTree from './FileTree';
import ModalDialog from './ModalDialog.jsx';
import { BoxElement as box, TextElement as text,ListElement as list } from 'react-blessed';
import { Grid as grid } from 'react-blessed-contrib-17'
import Counter from "./Counter";
import FolderPickerDialog from "./FolderPickerDialog";


export function App(props){
  const [message, setMessage] = useState(false);
  const [pickFolder, setPickFolder] = useState(false);
  const [activeTab, setActiveTab] = useState('project');
  const [treeData, setTreeData]   = useState([]);
  const [gitStatus, setGitStatus] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent]   = useState('');
  const [rootDir, setRootDir]   = useState(process.cwd());
  const [workspace, setWorkspace]   = useState(new Workspace());
  useEffect(() => {
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
    getStatus(rootDir).then(setGitStatus)
  }, []);


  const onFilePathSelect = (event) => {
    setMessage(`file path selected ${event.content} ${process.cwd()}`)
  };
  const selectFile = (node) => {
    setFileContent(`Loading ${node.fullPath}`)
    node.readFile(node.fullPath).then(setFileContent);
  };
  /**
   *
   * @param {INode} dir
   * @returns {Promise<void>}
   */
  const selectDir = async (dir) => {
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
    // setMessage(`dir selected ${Object.keys(dir)}`)
  };
  return (
      <box
          width="100%"
          height="100%"
          flexDirection="row"
          keys
          mouse
          clickable
          // close on ESC
          onKey={(ch, key) => {
              if (key.name === 'escape') {
                  onClose();
              } else if (key.name === 'W') {
                  setPickFolder(true)
                  setMessage(`selecting workspace`)
              }
              setMessage(`selecting key ${ch} ${key}`)
          }}
      >

        {/* Right panel */}
        <box width="30%" height="100%" left="0%" border={{ type: 'line' }} flexDirection="column">
          {/* Tabs */}
          <box height={1} flexDirection="row">
            {['project','git'].map(tab => (
                <text
                    key={tab}
                    mouse
                    clickable
                    left={tab==='git' ? 15 : 0}
                    style={{  bg: activeTab===tab?'blue':'' }}
                    onClick={(event) => setActiveTab(tab)}
                >
                  {(activeTab===tab?"[*]":"[ ]") + tab.charAt(0).toUpperCase() + tab.slice(1) + "  "}
                </text>
            ))}
          </box>

          {/* Tab content */}
          {activeTab === 'project' ? (
              <FileTree top={1} bottom={0} workspace={workspace} treeData={treeData} onDirSelect={selectDir} onFileSelect={selectFile}/>
          ) : (
              <list
                  top={1} bottom={0}
                  items={gitStatus}
                  keys mouse style={{ selected: { bg: 'blue' } }}
                  onSelect={onFilePathSelect}
              />
          )}
        </box>
        {/* Center pane */}
        <box
            width="70%"
            height="100%"
            left="30%"
            border={{ type: 'line' }}
            padding={1}
            label={selectedFile || 'No file selected'}
            flexDirection="column"
        >
            <box
                top={2}
                left="30%"
                width="70%"
                height="100%"
                border={{ type: 'line' }}
                padding={1}
                label={selectedFile || 'No file selected'}
                flexDirection="column"
                scrollable
                clickable
                mouse
                keys
                alwaysScroll
            >
              <text
                  position="absolute"
                  top={2}
                  left="30%"
                  border={{ type: 'line' }}
                  width="70%"
                  height="100%"
                  scrollable
                  clickable
                  mouse
                  keys
                  alwaysScroll
                  flexDirection="row"
              >
                {fileContent}
              </text>
          <Counter count={10}/>
            </box>
        </box>
        {message && (
            <ModalDialog
                title="Message"
                onClose={() => setMessage(false)}
            >
              <text>
                {message}
              </text>
            </ModalDialog>
        )}
        {pickFolder && (
            <FolderPickerDialog
                title="Message"
                onClose={() => setMessage(false)}
                onFolderSelect={(inode)=>{
                    setMessage(`selected folder ${inode.fullPath}`)
                }}
            />
        )}
      </box>

  );
}
