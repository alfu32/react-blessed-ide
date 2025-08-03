// App.js
import React, {Component, useState,useEffect} from 'react';
import {getStatus} from './services/GitService';
import {Workspace,INode} from './services/WorkspaceService';
import FileTree from './FileTree';
import ModalDialog from './ModalDialog.jsx';
import { BoxElement as box, TextElement as text,ListElement as list,ButtonElement as button } from 'react-blessed';
import { Grid,GridItem } from 'react-blessed-contrib-17'
import FolderPickerDialog from "./FolderPickerDialog";
import {Tab, VTabs} from "./VTabs";
import {TextEditor} from "./TextEditor";
import {CodeEditor} from "./CodeEditor";
import {LayoutCatcher} from "./LayoutCatcher";
import {CodeBufferEditor} from './CodeBufferEditor'
import {GitPanel} from "./GitPanel";


export function App(props){// Some Coment 
  const [message, setMessage] = useState(false);
  const [pickFolder, setPickFolder] = useState(false);
  const [currentEditorText, setCurrentEditorText] = useState('');
  const [activeTab, setActiveTab] = useState('Project');
  const [treeData, setTreeData]   = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [openedFiles, setOpenedFiles] = useState({});
  const [fileContent, setFileContent]   = useState('');
  const [rootDir, setRootDir]   = useState(process.cwd());
  const [gitStatus, setGitStatus] = useState([]);
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
  const onTextEditorSave = (a,b,c)=> {
      setMessage(JSON.stringify({a,b,c}))
  }
  const onTextEditorCancel = (a,b,c)=> {
      setMessage(JSON.stringify({a,b,c}))
  }
  const onCurrentEditorChange = (a,b,c)=> {
    // setCurrentEditorText(JSON.stringify(a))
  }
  const onCodeEditKeyPress = ({ch,key})=> {
    setCurrentEditorText(JSON.stringify({ch,key}))
  }
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
                          scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
                          onSelect={(_,idx) =>{
                              const k = Object.keys(openedFiles)[idx]
                              const inode = openedFiles[k];
                              selectFile(inode)
                          }}
                          onSelectItem={(_,idx) =>{
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
                          top={0}
                          bottom={0}
                          workspace={workspace}
                          treeData={treeData}
                          onDirSelect={selectDir}
                          onFileSelect={selectFile}
                          label={'Project'}
                      >
                          <button
                              mouse
                              keys
                              input
                              clickable
                              focused
                              bottom={0}
                              height={3}
                              valign={'middle'}
                              align={'center'}
                              style={{bg:'#ffaa00',fg:'#333333',hover:{bg:'#ffdd88',fg:'#333333'}}}
                              onClick={() => {
                                  setPickFolder(true)
                              }}
                              content={'ClickMe'}/>
                      </FileTree>
                  </box>
                  </Grid>
              </Tab>
              <Tab name='Git'>
                  <GitPanel rootDir={rootDir} row={0} col={1} rowSpan={1} colSpan={5}/>
                  {/* <box key={3} label={'Git Status'} height={9} border={{type: 'line'}}>
                      <list
                          mouse
                          keys
                          input
                          clickable
                          focused
                          scrollbar={{ch: '=', track: {fg: 'blue', bg: 'grey'}}}
                          items={gitStatus}
                          keys mouse style={{selected: {bg: 'blue'}}}
                          onSelect={onFilePathSelect}
                          label={'Status'}
                      />
                  </box>
                      <textarea
                      key={4} top={9} height={9}
                              mouse
                              keys
                              input
                              clickable
                              focused
                              label={'Comment'}
                              border={{type: 'line'}}
                              inputOnFocus={true}/>
              <button
                  key={5} top={18} left={'0%'} height={3} width={'48%'}
                  mouse
                  keys
                  input
                  clickable
                  focused
                  valign={'middle'}
                  align={'center'}
                  style={{bg: '#ffaa00', fg: '#333333'}}
                  border={{type: 'line', bg: '#ffaa00', fg: '#333333'}}
                  content={'commit'}
              />
              <button
                  key={5} top={18} left={'52%'} height={3} width={'48%'}
                  mouse
                  keys
                  input
                  clickable
                  focused
                  valign={'middle'}
                  align={'center'}
                  style={{bg: '#ffaa00', fg: '#333333'}}
                  border={{type: 'line', bg: '#ffaa00', fg: '#333333'}}
                  content={'revert'}
              />
              <box key={3} label={'Commits'} top={21} border={{type: 'line'}}>
                  <list
                      mouse
                      keys
                      input
                      clickable
                      focused
                      scrollbar={{ch: '=', track: {fg: 'blue', bg: 'grey'}}}
                      items={gitStatus}
                      keys mouse style={{selected: {bg: 'blue'}}}
                      onSelect={onFilePathSelect}
                      label={'Status'}
                  />
              </box>*/
              }
              </Tab>
          </VTabs>
          {/* Center panel */}
          {/**<CodeEditor row={0} col={5} rowSpan={6} colSpan={10}
                      border={{ type: 'line' }}
                      label={(selectedFile || 'No file selected').replace(workspace.rootDir,'')}
                      initialText={fileContent||""}
                      onKeypress={onCodeEditKeyPress}
                      onSave={onTextEditorSave}
                      onCancel={onTextEditorCancel}
                      onChange={onCurrentEditorChange}
          />**/}
          <CodeBufferEditor row={0} col={5} rowSpan={6} colSpan={10}
                      border={{ type: 'line' }}
                      label={(selectedFile || 'No file selected').replace(workspace.rootDir,'')}
                      filePath={selectedFile||null}
                      onKeypress={onCodeEditKeyPress}
                      onChange={onCurrentEditorChange}
          />
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
              {currentEditorText}
          </box>
          {/*<LayoutCatcher  row={0} col={5} rowSpan={6} colSpan={10}/>*/}
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
