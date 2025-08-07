// services/Workspace.js

import { promises as fs } from 'fs';
import path from 'path';
import ignore from 'ignore';

const inodeSortBy=(node)=> {
  const mapping={
    'd':1,// Directory
    'f':2,// File
    'l':2,// SymbolicLink
    'b':2,// BlockDevice
    'c':2,// CharacterDevice
    'p':2,// FIFO
    's':2,// Socket
  }
  const nt=node.type.replace(/-/gi,'')
  return `${node.parentFullName().split('/').map(nn => `1|${nn}`).join("/")}/${mapping[nt]}|${node.name}`
}
const compareInodes=(na,nb) => {
  const sa = inodeSortBy(na)
  const sb=inodeSortBy(nb)
  return sa<sb?-1:(sa===sb)?0:1
}

export class INode{
  id=0        /// (file stat ino)
  type=''      ///  ( one of 'd','f','l','p','c','p','s')
  name=""      ///  file name
  fullPath=""  /// 
  relPath=""  /// 
  isOpen=false    /// (default false)
  children=[]  /// []INode
  entries=[]  /// []INode

  async readFile() {
    return fs.readFile(this.fullPath, 'utf8');
  }
  depth(){
    return this.fullPath.split("/").length
  }
  parentFullName(){
    return this.fullPath.replace(`/${this.name}`,'')
  }
  toText(){

    const nt=this.type.replace(/-/gi,'')
    const marker = this.type.indexOf('d')>-1
      ? (this.isOpen ? ' [-]' : ' [+]')
    //  : ` [${nt}]`;
      : ``;
    return `${' '.repeat(this.depth()*2)}${marker} ${this.name}`
  }
  toText2(){
    return inodeSortBy(this)
  }

  /**
   *
   * @returns {INode[]}
   */
  flatten (){
    let out =[]
    out.push(this);
    if (this.isOpen) {
      const o = this.children.flatMap(child => child.flatten());
      o.forEach(n => out.push(n))
    }
    return out;
  }
  
  /**
   * 
   * @param {string} rootDir 
   * @param {string} currentPath 
   * @param {ignoredPaths} ig 
   * @returns {INode} self
   */
  async init(rootDir, ig, currentPath){
    this.fullPath=currentPath
    const stat = await fs.stat(this.fullPath);
    this.id=stat.ino
    this.type=[
      stat.isDirectory()?'d':'-',
      stat.isFile()?'f':'-',
      stat.isSymbolicLink()?'l':'-',
      stat.isBlockDevice()?'b':'-',
      stat.isCharacterDevice()?'c':'-',
      stat.isFIFO()?'p':'-',
      stat.isSocket()?'s':'-',
    ].join("")
    this.name = path.basename(this.fullPath);
    this.relPath = path.relative(rootDir, this.fullPath);
    this.isOpen=false
    this.children=[]
    if(this.type.indexOf('d')>-1){
      try{
        this.entries = await fs.readdir(this.fullPath)
      }catch(err){
        this.entries=[]
      }
    } else {
      this.entries=[]
    }
    return this
  }

  /**
   *
   * @param rootDir
   * @param ig
   * @returns {Promise<INode>}
   */
  async open(rootDir,ig){
    this.isOpen=true;
    this.children=await Promise.all(
        this.entries.map(entry => {
          const inode1 =new INode()
          inode1.fullPath=path.join(this.fullPath, entry)
          return inode1.init(rootDir, ig, inode1.fullPath)
        })
    )
    this.children.sort(compareInodes)
    return this
  }
  async close(rootDir,ig){
    this.isOpen=false;
    this.children=[]
  }
  /**
   * 
   * @param {string} currentPath 
   * @param {string} rootDir 
   * @param {ignoredPaths} ig 
   * @returns {INode} self
   */
  async refresh(rootDir,ig){

    this.name = path.basename(this.fullPath);
    this.relPath = path.relative(rootDir, this.fullPath);

    // skip anything the .gitignore says to ignore
    if (this.relPath && (ig.ignores(this.relPath) || this.name === ".git")) {
      return null;
    }
    // let inode =new INode()
    // await this.init(rootDir, ig, this.fullPath)

    if (this.type.indexOf('d')>-1) {
      const entries = await fs.readdir(this.fullPath);
      this.entries=entries
      let children = await Promise.all(
        entries.map(entry => {
          const inode1 =new INode()
          inode1.fullPath=path.join(this.fullPath, entry)
          inode1.init(rootDir, ig, this.fullPath)
          return inode1.refresh(rootDir,ig)
        })
      )
      children=children.filter(x => x!== null)
        .sort(compareInodes)
      this.children=children
    }
    return this

  }
}



export class Workspace{
  rootDir=""
  rootNode=new INode()
  nodeFilter=(inode,index,nodes,parent)=>{return true}
  constructor(nodeFilter=(inode,index,nodes,parent)=>{}){
    this.nodeFilter=nodeFilter;
  }
  async loadIgnore() {
    const ig = ignore();
    try {
      const gitignore = await fs.readFile(path.join(this.rootDir, '.gitignore'), 'utf8');
      ig.add(gitignore.split(/\r?\n/));
    } catch (e) {
      // no .gitignore — nothing to ignore
    }
    return ig;
  }
  /**
   * 
   * @param {string} rootDir 
   * @returns {Workspace}
   */
  async init(rootDir) {
    this.ig = await this.loadIgnore();
    this.rootDir=rootDir
    this.rootNode.fullPath = rootDir
    await this.rootNode.init(this.rootDir,this.ig,this.rootDir)
    await this.rootNode.refresh(this.rootDir,this.ig)
    return this
  }
  async refresh(){
    await this.rootNode.refresh(this.rootDir,this.ig)
  }
  /**
   *
   * @param {INode} node
   * @returns {Promise<Workspace>}
   */
  async open(node){
    node.isOpen=true;
    node.children=await Promise.all(
        node.entries.map(entry => {
          const inode1 =new INode()
          inode1.fullPath=path.join(node.fullPath, entry)
          return inode1.init(this.rootDir, this.ig, inode1.fullPath)
        })
    )
    node.children=node.children.filter((v,i,a)=> {
      return this.nodeFilter(v,i,a,node)
    })
    return this
  }
  flatten(){

    // throw JSON.stringify(wk,null,' ')
    let fmap = this.rootNode.flatten()
    fmap.sort(compareInodes)
    return fmap
  }
  // build a flat list of visible nodes
  /**
   *
   * @returns {Workspace}
   */
  copy(){
    let wks = new Workspace()
    wks.rootDir=this.rootDir
    wks.rootNode=this.rootNode
    wks.ig=this.ig
    wks.nodeFilter=this.nodeFilter
    return wks
  }
}

