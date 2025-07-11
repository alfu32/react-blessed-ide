// App.js
import React, { Component } from 'react';
import {getStatus} from './services/GitService';
import {Workspace,INode} from './services/WorkspaceService';
import FileTree from './FileTree';
import { BoxElement as box, TextElement as text,ListElement as list } from 'react-blessed';
import Counter from "./Counter";

export class App extends Component {
  state = {
    activeTab: 'project',   // 'project' or 'git'
    treeData: { type:'r', name: '', children: [] },
    gitStatus: [],
    selectedFile: null,
    fileContent: '',
    workspace:process.cwd()
  };

  componentDidMount() {
    getStatus(this.state.workspace.rootDir)
      .then(status => this.setState({ gitStatus: status,workspace: process.cwd() }));
  }

  onFilePathSelect = (filePath) => {
    readFile(filePath)
      .then(content => {
        this.setState({ selectedFile: filePath, fileContent: content });
      });
  };
  selectFile = (node) => {
    this.setState({ selectedFile: node.fullPath, fileContent: `Loading ${node.fullPath}` })
    readFile(node.fullPath)
      .then(content => {
        this.setState({ selectedFile: node.fullPath, fileContent: content });
      });
  };
  selectDir = async (dir) => {

  };

  render() {
    const { activeTab, treeData, gitStatus, selectedFile, fileContent,workspace } = this.state;
    const {selectDir,selectFile} = this

    return (
      <box width="100%" height="100%" flexDirection="row">

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
                style={{  bg: activeTab==tab?'blue':'' }}
                onClick={(event) => this.setState({ activeTab: tab })}
              >
                {(activeTab===tab?"[*]":"[ ]") + tab.charAt(0).toUpperCase() + tab.slice(1) + "  "}
              </text>
            ))}
          </box>

          {/* Tab content */}
          {activeTab === 'project' ? (
            <FileTree workspace={workspace} onDirSelect={selectDir} onFileSelect={selectFile}/>
          ) : (
            <list
              top={1} bottom={0}
              items={gitStatus}
              keys mouse style={{ selected: { bg: 'blue' } }}
              onSelect={(line) => {
                const path = line.split(' ').pop();
                this.onFilePathSelect(path);
              }}
            />
          )}
        </box>
        {/* Center pane */}
        <box width="70%" height="100%" left="30%" border={{ type: 'line' }} padding={1} label={selectedFile || 'No file selected'}>
          <text top={2} left={"30%"} scrollable mouse keys alwaysScroll>
            {fileContent}
          </text>
        </box>
        <Counter count={10}/>
      </box>
    );
  }
}
