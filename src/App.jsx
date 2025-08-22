// App.js
import React, {Component, useState, useEffect, useRef} from 'react';
import {Workspace,INode} from './Workspace';
import ModalDialog from './ModalDialog.jsx';
import { BoxElement as box, TextElement as text,ListElement as list,ButtonElement as button } from 'react-blessed';
import { Grid,GridItem } from 'react-blessed-contrib-17'
import FolderPickerDialog from "./FolderPickerDialog";
import {Tab, VTabs} from "./VTabs";
import {CodeBufferEditorComponent} from './CodeBufferEditor.jsx'
import {GitComponent} from "./GitComponent";
import { ErrorBoundary } from 'react-error-boundary'
import {ErrorFallback} from './ErrorFallback';
import FileTree from "./FileTree";
import {ListComponent} from "./ListComponent";
import { safeStringify } from './util.js';
// import {parsers} from "./grammars";
const listingTokenizerDefinition={
    name:'listing',
    flags:'mg',
    definitions:{
        "Whitespace":     {style: {fg:'white'},pattern:/\s+/mgi},
        "CloseButton":   {style: {fg:'red'},pattern:/\[x]/mgi},
        "NodeName":       {style: {fg:'green'},pattern:/[/a-zA-Z0-9_={}\[\]%*()m,.:;!?@~-]+/mgi},
        "Word":           {style: {fg:'yellow'},pattern:/\s.+?\s/mgi},
    }
}
export function App(props){
  // Some Coment
  const openedFilesRef=useRef(null);
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
  const onCurrentEditorChange = ({editor,ch,key,screenEvent,viewport})=> {
    setCurrentEditorText(safeStringify({editor: {cursors:editor.cursors},viewport,ch,key,screenEvent}))
  }
  const onCodeEditKeyPress = (ch,key)=> {
    // setCurrentEditorText(JSON.stringify({ch,key}))
  }
  const debugView=()=>{
      const content = `Debug:\n${('parsed some text')}`
      return <box content={content}/>
  }
  const listOpenedFiles=()=>{
      if(openedFilesRef === null) {
          return [];
      }
      if(openedFilesRef.current === null) {
          return [];
      }
      const lpos = openedFilesRef.current.lpos
      return Object.keys(openedFiles).map(
          k => {
              return k.padEnd(lpos.width-6,' ')+'[x]'
          }
      )
  }

    const onTokenClick=(eventData)=>{
        const treeData = listOpenedFiles()
        const {lines, visibleLines, line, cursor:{x,y},cursorScreen, buffer, visibleBuffer, index,tokens,tokenUnderCursor,phrase} = eventData

        let k = Object.keys(openedFiles)[y]
        let node = openedFiles[k];
        // throw JSON.stringify({node,y},null, ' ')
        // if (node.type.indexOf('d')>-1) {
        switch(phrase.filter(v => v!=='Whitespace').join(",")){
            case "Whitespace,NodeName":
            case "NodeName,CloseButton":
                switch((tokenUnderCursor||{type:'undefined'}).type){
                    case "NodeName":
                        selectFile(node)
                        // setCursorData({cursor:{x:0,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                    case "CloseButton":
                        const newOpenedFiles={...openedFiles}
                        delete newOpenedFiles[k];
                        setOpenedFiles(newOpenedFiles)
                        setMessage(`Close\n${node.fullPath} selectedFile:${selectedFile} node.fullPath:${node.fullPath} `)
                        if(selectedFile === node.fullPath){
                            k = Object.keys(openedFiles)[y-1]
                            node = openedFiles[k];
                            setSelectedFile(node.fullPath)
                        }

                        // setCursorData({cursor:{x:tokenUnderCursor.start,y},cursorScreen:{x:tokenUnderCursor.start,y:cursorScreen.y},content:tokenUnderCursor.text,style:tokenUnderCursor.style})
                        break;
                }
                break;
            default:
                throw new Error(`Unexpected phrase Structure '${phrase}'`)
        }
    }
  return (
      <>
      <Grid rows={8} cols={15} hideBorder>
          <VTabs row={0} col={0} rowSpan={8} colSpan={5}>
              <Tab name='Project'>
                  <Grid rows={8} cols={1}>
                  <box key={1} row={0} col={0} rowSpan={3} colSpan={1}
                       label={'opened Files'}  ref={openedFilesRef}>
                      <ListComponent
                          lines={listOpenedFiles()}
                          defaultText={''}
                          keys mouse scroll style={{ selected: { bg: 'blue' } }}
                          scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
                          onTokenClick={onTokenClick}
                          tokenizerDef={listingTokenizerDefinition}
                      />
                  </box>
                  <box key={2}
                       row={3} col={0} rowSpan={5} colSpan={1}
                       label={'Project'}>

                      <FileTree
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
                      </FileTree>
                  </box>
                  </Grid>
              </Tab>
              <Tab name='Git'>
                  <GitComponent rootDir={rootDir} row={0} col={1} rowSpan={1} colSpan={5}/>
              </Tab>
              <Tab name={'Debug'}>
                  <box>
                      {debugView()}
                  </box>
              </Tab>
              <Tab name={'Quit'} onTabClick={()=>{process.exit(0)}}>
                  <box onTabClick={()=>{process.exit(0)}}>
                      {debugView()}
                  </box>
              </Tab>
          </VTabs>
          {/* Center panel */}
          <CodeBufferEditorComponent row={0} col={5} rowSpan={6} colSpan={10}
                      border={{ type: 'line' }}
                      label={(selectedFile || 'No file selected').replace(rootDir,'')}
                      filePath={selectedFile||null}
                      onKeypress={onCodeEditKeyPress}
                      onChange={onCurrentEditorChange}
                      onEvent={onCurrentEditorChange}
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
