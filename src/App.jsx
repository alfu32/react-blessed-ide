// App.js
import React, {Component, useState,useEffect} from 'react';
import {Workspace,INode} from './Workspace';
// import FileTree from './FileTree';
import ModalDialog from './ModalDialog.jsx';
import { BoxElement as box, TextElement as text,ListElement as list,ButtonElement as button } from 'react-blessed';
import { Grid,GridItem } from 'react-blessed-contrib-17'
import FolderPickerDialog from "./FolderPickerDialog";
import {Tab, VTabs} from "./VTabs";
import {CodeBufferEditorComponent} from './CodeBufferEditor.jsx'
import {GitComponent} from "./GitComponent";
import { ErrorBoundary } from 'react-error-boundary'
import {ErrorFallback} from './ErrorFallback';
import FileTree2 from "./FileTree2";


export function App(props){// Some Coment 
  const [message, setMessage] = useState(false);
  const [pickFolder, setPickFolder] = useState(false);
  const [currentEditorText, setCurrentEditorText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [openedFiles, setOpenedFiles] = useState({});
  const [fileContent, setFileContent]   = useState('');
  const [rootDir, setRootDir]   = useState(process.cwd());
  const [gitStatus, setGitStatus] = useState([]);


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
    newOpenedFiles[node.fullPath.replace(rootDir,'')] = node
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
    setMessage(`dir selected ${Object.keys(dir)}`)
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

                      <FileTree2
                          top={0}
                          bottom={0}
                          rootDir={rootDir}
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
                              content={'workspace'}/>
                      </FileTree2>
                  </box>
                  </Grid>
              </Tab>
              <Tab name='Git'>
                  <GitComponent rootDir={rootDir} row={0} col={1} rowSpan={1} colSpan={5}/>
              </Tab>
          </VTabs>
          {/* Center panel */}
          <CodeBufferEditorComponent row={0} col={5} rowSpan={6} colSpan={10}
                      border={{ type: 'line' }}
                      label={(selectedFile || 'No file selected').replace(rootDir,'')}
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
                label={'Message'}
                title="Message"
                onClose={() => setMessage(false)}
            >
              <text>{message}</text>
            </ModalDialog>
        )}
        {pickFolder &&
            (<ErrorBoundary
                FallbackComponent={ErrorFallback}
                onReset={() => {
                    setPickFolder(false)
                }}
                onClose={() => setPickFolder(false)}
            >
            <FolderPickerDialog
                title="Pick Folder"
                onFolderSelect={(inode)=>{
                    setPickFolder(false)
                    if(inode) {
                        setMessage(`selected folder ${inode.fullPath}`)
                        setRootDir(inode.fullPath)
                    }
                }}
            />
            </ErrorBoundary>)
        }
    </>
  );
}
