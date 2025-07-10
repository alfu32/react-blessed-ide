// App.js
import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, List, Tree } from 'react-blessed';
import {getTree,readFile} from './services/WorkspaceService';
import {getStatus} from './services/GitService';

export function App() {
  const [activeTab, setActiveTab] = useState('project');
  const [treeData, setTreeData]   = useState({});
  const [gitStatus, setGitStatus] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent]   = useState('');

  useEffect(() => {
    getTree(process.cwd()).then(setTreeData);
    getStatus(process.cwd()).then(setGitStatus);
  }, []);

  const onFileSelect = useCallback(path => {
    readFile(path).then(content => {
      setSelectedFile(path);
      setFileContent(content);
    });
  }, []);

  return (
    <Box width="100%" height="100%" flexDirection="row">
      {/* Center */}
      <Box width="70%" height="100%" border={{ type: 'line' }} padding={1}>
        <Text bold>{selectedFile || 'No file selected'}</Text>
        <Box top={2} scrollable mouse keys alwaysScroll>
          {fileContent}
        </Box>
      </Box>

      {/* Side Panel */}
      <Box width="30%" height="100%" border={{ type: 'line' }} flexDirection="column">
        {/* Tabs */}
        <Box height={3} flexDirection="row">
          {['project','git'].map(tab => (
            <Text
              key={tab}
              mouse clickable
              bold={activeTab===tab}
              onClick={() => setActiveTab(tab)}
              left={tab==='git' ? 10 : 0}
            >
              {tab.charAt(0).toUpperCase()+tab.slice(1)}
            </Text>
          ))}
        </Box>
        {/* Content */}
        {activeTab === 'project' ? (
          <Tree
            data={treeData}
            onSelect={node => !node.children && onFileSelect(node.fullPath)}
          />
        ) : (
          <List
            items={gitStatus}
            onSelect={item => onFileSelect(item.split(' ').pop())}
          />
        )}
      </Box>
    </Box>
  );
}
