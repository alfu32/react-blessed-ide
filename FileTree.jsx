// components/FileTree.js
import React, { Component } from 'react';
import { ListElement as list, TextElement as text } from 'react-blessed';
import { Workspace,INode } from './services/WorkspaceService';



export default class FileTree extends Component {
    /**
     *
     * @type {{workspacePath: string, workspace: Workspace}}
     */
  state = {
        workspacePath: "/",
        workspace: new Workspace()
  };

  componentDidMount() {
    this.state.workspacePath = this.props.workspace
    let new_workspace=new Workspace()
      new_workspace
      .init(this.state.workspacePath)
      .then(wk => wk.open(wk.rootNode))
      .then(wk => {

          this.setState({...this.state,workspacePath:this.props.workspace, workspace: wk})
          // throw JSON.stringify(items,null,'  ')
      })
    // this.setState({ ...this.state,workspacePath:this.state.workspacePath,workspace: new_workspace })//.init(this.workspacePath)
  }

  /**
   * // toggle a directory’s isOpen and notify parent
   * @param {string[]} lines
   * @param {INode[]} items
   * @param {INode} node 
   */
  toggleDir = (lines,items,node) => {
    const { onDirSelect } = this.props;
    node.isOpen = !node.isOpen;
    onDirSelect(node);

    if(node.isOpen){
        node.open(this.state.workspace.rootDir,this.state.workspace.ig)
            .then(node => {
                let wk = this.state.workspace.copy()
                this.setState({...this.state, workspace: wk })
                //throw JSON.stringify(node,null,' ')
            })
    } else {
        node.close()
        let wk = this.state.workspace.copy()
        this.setState({...this.state, workspace: wk });
    }
    // mutate then setState to trigger render

  }



  render() {
    const { onFileSelect,workspace:wkRoot } = this.props;
      const { workspacePath,workspace} = this.state;

    if (!workspace) {
        return (<><text>loading {wkRoot}</text></>);
    }
    const items=workspace.flatten()// .filter(v => v instanceof INode)
    const lines = items.map((v,i,a) => {
        return v.toText();
    })
    // if (lines.length > 0 ) {
    //     throw lines.join('\n');
    // }
    return (
      // <>
      //     <text>{workspacePath}</text>
      //     <text>{JSON.stringify(items,null,' ')}</text>
      // </>
      <list
        top={0}
        width="100%"
        height="100%"
        items={lines}
        keys mouse
        style={{ selected: { bg: 'blue' } }}
        onSelect={(n, idx) => {
          const node = items[idx];
          //throw JSON.stringify({node,idx},null, ' ')
          if (node.type.indexOf('d')>-1) {
              this.toggleDir(lines,items,node);
          } else {
              onFileSelect(node);
          }
        }}
      />
    );
  }
}

