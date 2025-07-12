// App.js
import React, {Component, useState,useEffect} from 'react';
import {getStatus} from './services/GitService';
import {Workspace,INode} from './services/WorkspaceService';
import FileTree from './FileTree';
import ModalDialog from './ModalDialog.jsx';
import { BoxElement as box, TextElement as text,ListElement as list } from 'react-blessed';
import { Grid,GridItem } from 'react-blessed-contrib-17'
import Counter from "./Counter";
import FolderPickerDialog from "./FolderPickerDialog";


export function App(props){
  const [message, setMessage] = useState(false);
  const [pickFolder, setPickFolder] = useState(false);
  const [activeTab, setActiveTab] = useState('Project');
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
    /**
     *
     * @param {INode} node
     */
  const selectFile = (node) => {
    setSelectedFile(node.fullPath)
    setFileContent(`Loading ${node.relPath}`)
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
      <>
      <Grid rows={8} cols={15}>
        {/* Right panel */}
          <box row={0} col={0} rowSpan={8} colSpan={1} label={'|||'}>
            {/* Tabs */}
            {['Project','Git'].map((tab,i,a) => (
                <text
                    key={tab}
                    mouse
                    clickable
                    top={tab==='Git' ? 1 : 0}
                    style={{  bg: activeTab===tab?'blue':'' }}
                    onClick={(event) => setActiveTab(tab)}
                >
                  {(activeTab===tab?"[*]":"[ ]") + tab.charAt(0).toUpperCase() + tab.slice(1) + "  "}
                </text>
            ))}
          </box>
          {/* Tab content */}
          <box row={0} col={1} rowSpan={8} colSpan={4}
               label={activeTab}>
            <Grid rows={8} cols={1}>
              {activeTab === 'Project' && (
              <box
                  row={0} col={0} rowSpan={3} colSpan={1}
                  label={'Current Files'}>
              </box>)}
              {activeTab === 'Project' ? (
              <box
                  row={3} col={0} rowSpan={5} colSpan={1}
                  label={'Project'}>
                  <FileTree
                      workspace={workspace}
                      treeData={treeData}
                      onDirSelect={selectDir}
                      onFileSelect={selectFile}
                  />
              </box>):(<></>)}
              {/**activeTab === 'Git' && (
                  <box row={0} col={0} rowSpan={8} colSpan={1} label={'Git'}>
                      <list
                          items={gitStatus}
                          keys mouse style={{ selected: { bg: 'blue' } }}
                          onSelect={onFilePathSelect}
                          label={'Status'}
                      />
                  </box>
              )**/}
            </Grid>
          </box>
          {/* Center panel */}
          <box row={0} col={5} rowSpan={6} colSpan={10}
              border={{ type: 'line' }}
              scrollable
              clickable
              mouse
              keys
              label={selectedFile || 'No file selected'}
              overflow={'scroll'}
          >
            <text>{fileContent}</text>
          </box>
          <box
              row={6} col={5} rowSpan={2} colSpan={10}
              border={{ type: 'line' }}
              scrollable
              clickable
              mouse
              keys
              label={'Terminal'}
              overflow={'scroll'}
          >
              <text></text>
          </box>
        </Grid>
        {message && (
            <ModalDialog
                title="Message"
                onClose={() => setMessage(false)}
            >
              <text>{message}</text>
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
    </>
  );
}
