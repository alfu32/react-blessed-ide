// App.js
import React, {Component, useState,useEffect} from 'react';
import {getStatus} from './services/GitService';
import {Workspace,INode} from './services/WorkspaceService';
import FileTree from './FileTree';
import ModalDialog from './ModalDialog.jsx';
import { BoxElement as box, TextElement as text,ListElement as list } from 'react-blessed';
import { Grid,GridItem } from 'react-blessed-contrib-17'
import FolderPickerDialog from "./FolderPickerDialog";
import {Tab, VTabs} from "./VTabs";


export function App(props){
  const [message, setMessage] = useState(false);
  const [pickFolder, setPickFolder] = useState(false);
  const [activeTab, setActiveTab] = useState('Project');
  const [treeData, setTreeData]   = useState([]);
  const [gitStatus, setGitStatus] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [openedFiles, setOpenedFiles] = useState({});
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
    const newOpenedFiles={...openedFiles}
    newOpenedFiles[node.fullPath.replace(workspace.rootNode.fullPath,'')] = node
    setOpenedFiles(newOpenedFiles)
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
      <Grid rows={8} cols={15} hideBorder>
          <VTabs row={0} col={0} rowSpan={8} colSpan={5}>
              <Tab name='Project'>
                  <Grid rows={8} cols={1}>
                  <box key={1} row={0} col={0} rowSpan={3} colSpan={1}
                       label={'opened Files'}>
                      <list
                          items={Object.keys(openedFiles)}
                          keys mouse scroll style={{ selected: { bg: 'blue' } }}
                          onSelect={(_,idx) =>{
                              const k = Object.keys(openedFiles)[idx]
                              const inode = openedFiles[k];
                              selectFile(inode)
                          }}
                      />
                  </box>
                  <box key={2}
                       row={3} col={0} rowSpan={5} colSpan={1}
                       label={'Project'}>

                      <FileTree
                          workspace={workspace}
                          treeData={treeData}
                          onDirSelect={selectDir}
                          onFileSelect={selectFile}
                          label={'Project'}
                      />
                  </box>
                  </Grid>
              </Tab>
              <Tab name='Git'>
                  <box key={3} label={'Git'}>
                      <list
                          items={gitStatus}
                          keys mouse style={{selected: {bg: 'blue'}}}
                          onSelect={onFilePathSelect}
                          label={'Status'}
                      />
                  </box>
              </Tab>
          </VTabs>
          {/* Center panel */}
          <box row={0} col={5} rowSpan={6} colSpan={10}
              border={{ type: 'line' }}
              scrollable
              clickable
              mouse
              keys
              label={(selectedFile || 'No file selected').replace(workspace.rootDir,'')}
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
