#!/usr/bin/env node
"use strict";
const jsxRuntime_js = require("react/jsx-runtime.js");
require("raf/polyfill.js");
const blessed = require("blessed");
const reactBlessed = require("react-blessed");
const React = require("react");
const ignore = require("ignore");
const reactBlessedContrib17 = require("react-blessed-contrib-17");
const fs = require("fs");
const path = require("path");
require("vite");
const reactErrorBoundary = require("react-error-boundary");
const inodeSortBy = (node) => {
  const mapping = {
    "d": 1,
    // Directory
    "f": 2,
    // File
    "l": 2,
    // SymbolicLink
    "b": 2,
    // BlockDevice
    "c": 2,
    // CharacterDevice
    "p": 2,
    // FIFO
    "s": 2
    // Socket
  };
  const nt = node.type.replace(/-/gi, "");
  return `${node.parentFullName().split("/").map((nn) => `1|${nn}`).join("/")}/${mapping[nt]}|${node.name}`;
};
const compareInodes = (na, nb) => {
  const sa = inodeSortBy(na);
  const sb = inodeSortBy(nb);
  return sa < sb ? -1 : sa === sb ? 0 : 1;
};
class INode {
  id = 0;
  /// (file stat ino)
  type = "";
  ///  ( one of 'd','f','l','p','c','p','s')
  name = "";
  ///  file name
  fullPath = "";
  /// 
  relPath = "";
  /// 
  isOpen = false;
  /// (default false)
  children = [];
  /// []INode
  entries = [];
  /// []INode
  async readFile() {
    return fs.promises.readFile(this.fullPath, "utf8");
  }
  depth() {
    return this.fullPath.split("/").length;
  }
  parentFullName() {
    return this.fullPath.replace(`/${this.name}`, "");
  }
  toText() {
    this.type.replace(/-/gi, "");
    const marker = this.type.indexOf("d") > -1 ? this.isOpen ? " [-]" : " [+]" : ``;
    return `${" ".repeat(this.depth() * 2)}${marker} ${this.name}`;
  }
  toText2() {
    return inodeSortBy(this);
  }
  /**
   *
   * @returns {INode[]}
   */
  flatten() {
    let out = [];
    out.push(this);
    if (this.isOpen) {
      const o = this.children.flatMap((child) => child.flatten());
      o.forEach((n) => out.push(n));
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
  async init(rootDir, ig, currentPath) {
    this.fullPath = currentPath;
    let stat = await fs.promises.stat(this.fullPath);
    this.id = stat.ino;
    this.type = [
      stat.isDirectory() ? "d" : "-",
      stat.isFile() ? "f" : "-",
      stat.isSymbolicLink() ? "l" : "-",
      stat.isBlockDevice() ? "b" : "-",
      stat.isCharacterDevice() ? "c" : "-",
      stat.isFIFO() ? "p" : "-",
      stat.isSocket() ? "s" : "-"
    ].join("");
    this.name = path.basename(this.fullPath);
    this.relPath = path.relative(rootDir, this.fullPath);
    this.isOpen = false;
    this.children = [];
    if (this.type.indexOf("d") > -1) {
      try {
        this.entries = await fs.promises.readdir(this.fullPath);
      } catch (err) {
        this.entries = [];
      }
    } else {
      this.entries = [];
    }
    return this;
  }
  /**
   *
   * @param rootDir
   * @param ig
   * @returns {Promise<INode>}
   */
  async open(rootDir, ig) {
    this.isOpen = true;
    this.children = (await Promise.all(
      this.entries.map((entry) => {
        try {
          const inode1 = new INode();
          inode1.fullPath = path.join(this.fullPath, entry);
          return inode1.init(rootDir, ig, inode1.fullPath);
        } catch (err) {
          return Promise.resolve(null);
        }
      })
    )).filter((k) => k !== null);
    this.children.sort(compareInodes);
    return this;
  }
  async close(rootDir, ig) {
    this.isOpen = false;
    this.children = [];
  }
  /**
   * 
   * @param {string} currentPath 
   * @param {string} rootDir 
   * @param {ignoredPaths} ig 
   * @returns {INode} self
   */
  async refresh(rootDir, ig) {
    this.name = path.basename(this.fullPath);
    this.relPath = path.relative(rootDir, this.fullPath);
    if (this.relPath && (ig.ignores(this.relPath) || this.name === ".git")) {
      return null;
    }
    if (this.type.indexOf("d") > -1) {
      const entries = await fs.promises.readdir(this.fullPath);
      this.entries = entries;
      let children = (await Promise.all(
        entries.map((entry) => {
          try {
            const inode1 = new INode();
            inode1.fullPath = path.join(this.fullPath, entry);
            inode1.init(rootDir, ig, this.fullPath);
            return inode1.refresh(rootDir, ig);
          } catch (e) {
            return Promise.resolve(null);
          }
        })
      )).filter((k) => k !== null);
      children = children.filter((x) => x !== null).sort(compareInodes);
      this.children = children;
    }
    return this;
  }
}
class Workspace {
  rootDir = "";
  rootNode = new INode();
  nodeFilter = (inode, index, nodes, parent) => {
    return true;
  };
  constructor(nodeFilter = (inode, index, nodes, parent) => {
  }) {
    this.nodeFilter = nodeFilter;
  }
  async loadIgnore() {
    const ig = ignore();
    try {
      const gitignore = await fs.promises.readFile(path.join(this.rootDir, ".gitignore"), "utf8");
      ig.add(gitignore.split(/\r?\n/));
    } catch (e) {
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
    this.rootDir = rootDir;
    this.rootNode.fullPath = rootDir;
    await this.rootNode.init(this.rootDir, this.ig, this.rootDir);
    await this.rootNode.refresh(this.rootDir, this.ig);
    return this;
  }
  async refresh() {
    await this.rootNode.refresh(this.rootDir, this.ig);
  }
  /**
   *
   * @param {INode} node
   * @returns {Promise<Workspace>}
   */
  async open(node) {
    node.isOpen = true;
    node.children = await Promise.all(
      node.entries.map((entry) => {
        const inode1 = new INode();
        inode1.fullPath = path.join(node.fullPath, entry);
        return inode1.init(this.rootDir, this.ig, inode1.fullPath);
      })
    );
    node.children = node.children.filter((v, i, a) => {
      return this.nodeFilter(v, i, a, node);
    });
    return this;
  }
  flatten() {
    let fmap = this.rootNode.flatten();
    fmap.sort(compareInodes);
    return fmap;
  }
  // build a flat list of visible nodes
  /**
   *
   * @returns {Workspace}
   */
  copy() {
    let wks = new Workspace();
    wks.rootDir = this.rootDir;
    wks.rootNode = this.rootNode;
    wks.ig = this.ig;
    wks.nodeFilter = this.nodeFilter;
    return wks;
  }
}
function ModalDialog({
  title = "Dialog",
  width = "50%",
  height = "50%",
  onClose,
  children
}) {
  const boxRef = React.useRef();
  React.useEffect(() => {
    const node = boxRef.current;
    if (node) node.focus();
  }, []);
  return /* @__PURE__ */ jsxRuntime_js.jsxs(
    "box",
    {
      ref: boxRef,
      top: "center",
      left: "center",
      width,
      height,
      border: { type: "line" },
      style: { bg: "black", fg: "white" },
      keys: true,
      mouse: true,
      clickable: true,
      onKey: (ch, key) => {
        if (key.name === "escape") onClose();
      },
      children: [
        /* @__PURE__ */ jsxRuntime_js.jsxs("box", { height: 1, width: "100%", style: { fg: "green" }, children: [
          /* @__PURE__ */ jsxRuntime_js.jsxs("text", { bold: true, children: [
            ` ${title}`,
            " "
          ] }),
          /* @__PURE__ */ jsxRuntime_js.jsx(
            "text",
            {
              right: 0,
              mouse: true,
              clickable: true,
              underline: true,
              onClick: onClose,
              children: "[×]"
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntime_js.jsx("box", { top: 2, left: 1, right: 1, bottom: 1, scrollable: true, keys: true, mouse: true, alwaysScroll: true, children })
      ]
    }
  );
}
function safeStringify(obj, space = void 0) {
  const seen = /* @__PURE__ */ new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    switch (key) {
      // case "content": return "[content]"
      case "screen":
        return "[screen]";
      case "parent":
        return "[parent]";
      case "lines":
        return "[lines]";
      case "children":
        return "[children]";
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  }, space);
}
function insertAt(destination, index, source) {
  let first = destination.substring(0, index);
  let last = destination.substring(index + source.length);
  return (first + source + last).substring(0, destination.length);
}
class TokenizerToken {
  tokenizerName = "";
  type = "";
  style = {};
  start = 0;
  end = 0;
  y = 0;
  x = 0;
  text = "";
  /**
   *
   * @param {RegExpExecArray} m
   * @param tokenizerDef
   * @return {{name: void | string, text: *, type: string, style, start, end: *}}
   */
  static fromRegexpMatch(m, tokenizerDef, tokenizerName, lineNumber) {
    const groups = m.groups;
    const type = Object.keys(groups).find((key) => groups[key] !== void 0);
    const tokenDef = tokenizerDef.definitions[type];
    const tt = new TokenizerToken();
    tt.tokenizerName = tokenizerName;
    tt.text = m[0];
    tt.type = type;
    tt.style = tokenDef.style;
    tt.start = m.index;
    tt.end = m.index + m[0].length;
    tt.y = lineNumber;
    tt.x = tt.start;
    return tt;
  }
}
const namedTokenizers = {
  any: { name: "any", definitions: {
    Number: { style: { fg: "red" }, pattern: /\d+(?:\.\d+)?/mig },
    Identifier: { style: { fg: "green" }, pattern: /[A-Za-z_]\w*/mig },
    String: { style: { fg: "yellow" }, pattern: /"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/mig },
    Operator: { style: { fg: "cyan" }, pattern: /==|!=|<=|>=|[+\-*/=<>]/mig },
    punctuation: { style: { fg: "cyan" }, pattern: /[()\[\]{}.,;:?\^]/mig },
    Whitespace: { style: { fg: "white" }, pattern: /\s+/mig },
    Others: { style: { fg: "white" }, pattern: /.*?/mig }
  } },
  js: { name: "js", flags: "mg", definitions: {
    Keyword: { style: { fg: "magenta" }, pattern: /\b(as|from|default|this|const|constructor|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw|switch|case|break|continue)\b/mig },
    Number: { style: { fg: "red" }, pattern: /\d+(?:\.\d+)?/mig },
    Comment: { style: { fg: "#779977" }, pattern: /\/\/.*$/mig },
    // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
    String: { style: { fg: "yellow" }, pattern: /"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/mig },
    Operator: { style: { fg: "cyan" }, pattern: /==|!=|<=|>=|[+\-*/=<>%|&]/mig },
    Punctuation: { style: { fg: "red" }, pattern: /[\\()\[\]{}.,;:?^$]/mig },
    Whitespace: { style: { fg: "white" }, pattern: /\s+/smig },
    Identifier: { style: { fg: "green" }, pattern: /[A-Za-z_]\w*/mig },
    Others: { style: { fg: "white" }, pattern: /[^]/smig }
  } },
  jsx: { name: "jsx", flags: "mg", definitions: {
    ReactToken: { style: { fg: "#FFDD00" }, pattern: /\buse[A-Z][a-z]*\b/mig },
    Keyword: { style: { fg: "magenta" }, pattern: /\b(as|from|default|const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw|switch|case|break|continue)\b/mig },
    JsxTag: { style: { fg: "#FFDD00" }, pattern: /<(\/)?[a-zA-Z-]*>/mig },
    Comment: { style: { fg: "#779977" }, pattern: /\/\/.*$/mig },
    // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
    Number: { style: { fg: "red" }, pattern: /\d+(?:\.\d+)?/mig },
    Punctuation: { style: { fg: "red" }, pattern: /[\\()\[\]{}.,;:?^$]/mig },
    Operator: { style: { fg: "cyan" }, pattern: /==|!=|<=|>=|[+\-*/=<>]/mig },
    Whitespace: { style: { fg: "white" }, pattern: /\s+/mig },
    Identifier: { style: { fg: "green" }, pattern: /[A-Za-z_]\w*/mig },
    Others: { style: { fg: "white" }, pattern: /.*?/mig }
  } },
  c: { name: "c", flags: "mg", definitions: {
    Keyword: { style: { fg: "magenta" }, pattern: /\b(int|const|char|long|if|else|for|while|return|switch|case|break|continue)\b/mig },
    Number: { style: { fg: "red" }, pattern: /\d+(?:\.\d+)?/mig },
    Comment: { style: { fg: "#779977" }, pattern: /\/\/.*$/mig },
    // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
    String: { style: { fg: "yellow" }, pattern: /"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/mig },
    Operator: { style: { fg: "cyan" }, pattern: /==|!=|<=|>=|[+\-*/=<>]/mig },
    Punctuation: { style: { fg: "cyan" }, pattern: /==|!=|<=|>=|[+\-*/=<>]/mig },
    Whitespace: { style: { fg: "white" }, pattern: /\s+/mig },
    Identifier: { style: { fg: "green" }, pattern: /[A-Za-z_]\w*/mig },
    Others: { style: { fg: "white" }, pattern: /.*?/mig }
  } },
  words: { name: "c", flags: "mg", definitions: {
    Whitespace: { style: { fg: "red" }, pattern: /\s+/mig },
    Word: { style: { fg: "green" }, pattern: /\b.+?\b/mig }
  } }
};
function getNamedTokenizer(name) {
  const tokenizerDef = namedTokenizers[name] || namedTokenizers["any"];
  return getTokenizer(tokenizerDef);
}
function getTokenizer(tokenizerDef) {
  tokenizerDef["Any"] = { style: { fg: "#eeeeee" }, pattern: /(\b|^).+?(\b|$)/smig };
  const tokenRegex = new RegExp(
    Object.entries(tokenizerDef.definitions).map(([name, definition]) => `(?<${name}>${definition.pattern.source})`).join("|"),
    tokenizerDef.flags || "g"
  );
  return function tokenizer(code, lineNumber) {
    const tokens = [];
    for (const m of code.matchAll(tokenRegex)) {
      const groups = m.groups;
      const type = Object.keys(groups).find((key) => groups[key] !== void 0);
      tokenizerDef.definitions[type];
      tokens.push(TokenizerToken.fromRegexpMatch(m, tokenizerDef, tokenizerDef.name, lineNumber));
    }
    return tokens;
  };
}
class SimpleTextEditor {
  buffer = "";
  cursorIndex = 0;
  highlightIndex = 0;
  listeners = { "cursorChanged": [], "bufferChanged": [] };
  viewportHeight = 7;
  viewportWidth = 30;
  viewportX = 0;
  viewportY = 0;
  /**
   *
   * @param {string} buffer
   */
  constructor(buffer) {
    this.buffer = buffer || "";
  }
  /**
   *
   * @param {"cursorChanged"|"bufferChanged"} eventType
   * @param {(eventData:SimpleTextEditor)=>(()=>void)} listener
   */
  on(eventType, listener) {
    this.listeners[eventType] = listener;
  }
  /**
   *
   * @param {"cursorChanged"|"bufferChanged"} eventType
   * @param {SimpleTextEditor} payload
   */
  _dispatchEvents(eventType, payload) {
    const toKeep = [];
    for (let listener of this.listeners[eventType]) {
      try {
        const unsubscribe = listener(payload);
        if (typeof unsubscribe === "function") {
          unsubscribe();
        } else {
          toKeep.push(listener);
        }
      } catch (err) {
      }
    }
    this.listeners[eventType] = toKeep;
  }
  slideViewportToCursor() {
    let { x, y } = this.cursorCoords();
    let { viewportHeight: vh, viewportWidth: vw, viewportX: vx, viewportY: vy } = this;
    if (y < vy) {
      vy = y;
    }
    if (y > vy + vh) {
      vy += 1;
    }
    this.viewportY = vy;
  }
  /**
   *
   * @return {string[]}
   */
  renderToLines(start = 0, height) {
    const lines = this.buffer.split("\n");
    const e = start + (height || lines.length);
    return lines.slice(start, e);
  }
  /**
   *
   * @return {{y: number, x: number}}
   */
  cursorCoords() {
    return this.cursorIndexToCoords(this.cursorIndex);
  }
  /**
   *
   * @return {{y: number, x: number}}
   */
  highlightCoords() {
    return this.cursorIndexToCoords(this.highlightIndex);
  }
  /**
   *
   * @param {String} index
   * @return {{y: number, x: number}}
   */
  cursorIndexToCoords(index) {
    const linesTo = this.buffer.substring(0, parseInt(index)).split("\n");
    return {
      y: linesTo.length - 1,
      x: linesTo[linesTo.length - 1].length
    };
  }
  setCursor(x, y) {
    this.cursorIndex = this.cursorCoordsToIndex({ x, y });
  }
  setHighlight(x, y) {
    this.highlightIndex = this.cursorCoordsToIndex({ x, y });
  }
  /**
   *
   * @param {{x:Number,y:Number}} coords
   * @return {Number}
   */
  cursorCoordsToIndex(coords) {
    const { x, y } = coords;
    const lines = this.buffer.split("\n").slice(0, y);
    return lines.reduce((c, l) => c + 1 + l.length, 0) + x;
  }
  /**
   *
   * @param {String} ch
   * @param {String} key
   * @return {SimpleTextEditor}
   */
  onKey(ch, key) {
    switch (key.name) {
      case "up":
        this.moveCursorUp();
        break;
      case "down":
        this.moveCursorDown();
        break;
      case "left":
        this.moveCursorLeft();
        break;
      case "right":
        this.moveCursorRight();
        break;
      case "home":
        this.toHome();
        break;
      case "end":
        this.toEnd();
        break;
      case "backspace":
        this.backspace();
        break;
      case "delete":
        this.delete();
        break;
      case "return":
        this.insert("\n");
        this.moveCursorDown();
        break;
      case "tab":
        this.insert("	");
        break;
      default:
        if (ch && ch.length > 0) {
          if (key.name && key.name.length === 1) {
            this.insert(key.sequence);
          } else {
            this.insert(ch);
          }
        }
    }
    this.slideViewportToCursor();
    return this;
  }
  tokenUnderCursor(x, y, tokenizer) {
    const lines = this.renderToLines();
    const line = lines[y];
    const tokens = tokenizer(line, y);
    tokens.map((v) => v.type);
    const tokenUnderCursor = tokens.find((v, i, a) => {
      return v.start <= x && v.end >= x;
    });
    return tokenUnderCursor;
  }
  /**
   *
   * @param lpos
   * @param {Screen} screenEvent
   * @param tokenizer
   * @return {EditorEvent}
   */
  getEvent(lpos, screenEvent, tokenizer) {
    const { xi, yi } = lpos;
    const { x, y } = screenEvent;
    const cursor = this.cursorCoords();
    const lines = this.renderToLines();
    const line = lines[cursor.y];
    const tokens = tokenizer(line, y);
    const phrase = tokens.map((v) => v.type);
    const tokenUnderCursor = tokens.find((v, i, a) => {
      return v.start <= cursor.x && v.end >= cursor.x;
    });
    return {
      event: screenEvent,
      parentPos: { x: xi, y: yi },
      lines,
      line,
      visibleLines: lines,
      cursor,
      cursorScreen: { x: cursor.x - this.viewportX, y: cursor.y - this.viewportY },
      buffer: this.buffer,
      visibleBuffer: this.buffer,
      index: this.cursorIndex,
      tokens,
      tokenUnderCursor,
      phrase
    };
  }
  /**
   *
   * @return {SimpleTextEditor}
   */
  moveCursorUp() {
    let { x, y } = this.cursorIndexToCoords(this.cursorIndex);
    if (y > 0) {
      this.cursorIndex = this.cursorCoordsToIndex({ x, y: y - 1 });
      this._dispatchEvents("cursorChanged", this);
    }
    return this;
  }
  /**
   *
   * @return {SimpleTextEditor}
   */
  moveCursorDown() {
    let { x, y } = this.cursorIndexToCoords(this.cursorIndex);
    const lines = this.buffer.split("\n");
    if (y < lines.length - 1) {
      this.cursorIndex = this.cursorCoordsToIndex({ x, y: y + 1 });
      this._dispatchEvents("cursorChanged", this);
    }
    return this;
  }
  /**
   *
   * @return {SimpleTextEditor}
   */
  moveCursorLeft() {
    if (this.cursorIndex > 0) {
      this.cursorIndex -= 1;
      this._dispatchEvents("cursorChanged", this);
    }
    return this;
  }
  /**
   *
   * @return {SimpleTextEditor}
   */
  moveCursorRight() {
    if (this.cursorIndex < this.buffer.length) {
      this.cursorIndex += 1;
      this._dispatchEvents("cursorChanged", this);
    }
    return this;
  }
  /**
   *
   * @return {SimpleTextEditor}
   */
  toHome() {
    let { x, y } = this.cursorIndexToCoords(this.cursorIndex);
    this.cursorIndex = this.cursorCoordsToIndex({ x: 0, y });
    this._dispatchEvents("cursorChanged", this);
    return this;
  }
  /**
   *
   * @return {SimpleTextEditor}
   */
  toEnd() {
    let { x, y } = this.cursorIndexToCoords(this.cursorIndex);
    const line = this.buffer.split("\n")[y];
    this.cursorIndex = this.cursorCoordsToIndex({ x: line.length, y });
    this._dispatchEvents("cursorChanged", this);
    return this;
  }
  /**
   *
   * @return {SimpleTextEditor}
   */
  backspace() {
    if (this.cursorIndex > 0) {
      this.cursorIndex -= 1;
      this._dispatchEvents("cursorChanged", this);
      const before = this.buffer.substring(0, this.cursorIndex);
      const after = this.buffer.substring(this.cursorIndex + 1);
      this.buffer = before + after;
      this._dispatchEvents("bufferChanged", this);
    }
    return this;
  }
  /**
   *
   * @return {SimpleTextEditor}
   */
  delete() {
    const before = this.buffer.substring(0, this.cursorIndex + 1);
    const after = this.buffer.substring(this.cursorIndex + 2);
    this.buffer = before + after;
    this._dispatchEvents("bufferChanged", this);
    return this;
  }
  /**
   *
   * @return {SimpleTextEditor}
   */
  insert(ch) {
    this.cursorIndex += 1;
    const before = this.buffer.substring(0, this.cursorIndex - 1);
    const after = this.buffer.substring(this.cursorIndex - 1);
    this.buffer = before + ch + after;
    this._dispatchEvents("bufferChanged", this);
    this._dispatchEvents("cursorChanged", this);
    return this;
  }
  /**
   *
   * @return {SimpleTextEditor}
   */
  copy() {
    const newSimpleTextBuffer = new SimpleTextEditor();
    newSimpleTextBuffer.buffer = this.buffer;
    newSimpleTextBuffer.cursorIndex = this.cursorIndex;
    newSimpleTextBuffer.highlightIndex = this.highlightIndex;
    newSimpleTextBuffer.viewportHeight = this.viewportHeight;
    newSimpleTextBuffer.viewportWidth = this.viewportWidth;
    newSimpleTextBuffer.viewportX = this.viewportX;
    newSimpleTextBuffer.viewportY = this.viewportY;
    return newSimpleTextBuffer;
  }
}
function ListComponent({
  lines,
  editable = false,
  defaultText: defaultText2 = "...",
  onLineClick = (editorEvent) => {
  },
  onTokenClick = (editorEvent) => {
  },
  onLineHover = (editorEvent) => {
  },
  onTokenHover = (editorEvent) => {
  },
  tokenizerDef,
  children,
  ...boxProps
}) {
  const boxRef = React.useRef(null);
  const [editor2, setEditor2] = React.useState(null);
  const [size, setSize] = React.useState({ rows: 10, cols: 30 });
  let changedTimeout = 0;
  React.useEffect(() => {
    let newEditor = editor2;
    if (!newEditor) {
      newEditor = new SimpleTextEditor(lines.join("\n") || defaultText2);
    }
    if ((lines.join("\n") || defaultText2).substring(newEditor.cursorIndex) !== newEditor.buffer.substring(newEditor.cursorIndex)) {
      newEditor.slideViewportToCursor();
    }
    newEditor.buffer = lines.join("\n") || defaultText2;
    newEditor.viewportHeight = size.rows - 1;
    newEditor.viewportWidth = size.cols;
    setEditor2(newEditor.copy());
  }, [lines]);
  React.useEffect(() => {
    const box2 = boxRef.current;
    if (!box2) return;
    const update = () => {
      setSize({ cols: box2.width, rows: box2.height - 2 });
    };
    update();
    box2.on("resize", update);
    return () => box2.removeListener("resize", update);
  }, []);
  React.useEffect(() => {
    if (editor2) {
      editor2.viewportWidth = size.cols;
      editor2.viewportHeight = size.rows;
      setEditor2(editor2.copy());
    }
  }, [size]);
  const internalOnKeyPress = (ch, key) => {
    if (editable) {
      editor2.onKey(ch, key);
      clearTimeout(changedTimeout);
      changedTimeout = setTimeout(() => {
        setEditor2(editor2.copy());
      }, 80);
    } else if (key in ["up", "down"]) {
      editor2.onKey(ch, key);
      changedTimeout = setTimeout(() => {
        setEditor2(editor2.copy());
      }, 80);
    }
  };
  const getEvent = (screenEvent) => {
    if (!editor2) {
      return;
    }
    const tokenizer = getTokenizer(tokenizerDef || {
      name: "words",
      flags: "mg",
      definitions: {
        Whitespace: { style: { fg: "red" }, pattern: /\s+/gi },
        Word: { style: { fg: "green" }, pattern: /\b.+?\b/gi }
      }
    });
    const evt = editor2.getEvent(boxRef.current.lpos, screenEvent, tokenizer);
    return evt;
  };
  const mouseAction = (screenEvent) => {
    switch (screenEvent.action) {
      case "mousemove":
        {
          const newEvent = getEvent(screenEvent);
          editor2.setHighlight(newEvent.cursorScreen.x + editor2.viewportX, newEvent.cursorScreen.y + editor2.viewportY);
          setEditor2(editor2.copy());
          setTimeout(() => {
            onLineHover(newEvent);
            onTokenHover(newEvent);
          }, 1);
        }
        break;
      case "mousedown":
        {
          const newEvent = getEvent(screenEvent);
          setTimeout(() => {
            editor2.setCursor(screenEvent.x - boxRef.current.lpos.xi + editor2.viewportX, screenEvent.y - boxRef.current.lpos.yi + editor2.viewportY);
            editor2.setHighlight(newEvent.cursorScreen.x + editor2.viewportX, newEvent.cursorScreen.y + editor2.viewportY);
            setEditor2(editor2.copy());
          }, 1);
        }
        break;
      case "mouseup":
        {
          const newEvent = getEvent(screenEvent);
          const { x, y } = screenEvent;
          setTimeout(() => {
            editor2.setHighlight(null);
            editor2.setCursor(screenEvent.x - boxRef.current.lpos.xi + editor2.viewportX, screenEvent.y - boxRef.current.lpos.yi + editor2.viewportY);
            editor2.setHighlight(newEvent.cursorScreen.x + editor2.viewportX, newEvent.cursorScreen.y + editor2.viewportY);
            onLineClick(newEvent);
            onTokenClick(newEvent);
            setEditor2(editor2.copy());
          }, 1);
        }
        break;
      case "wheelup":
        {
          getEvent(screenEvent);
          editor2.moveCursorUp().slideViewportToCursor();
          setTimeout(() => {
            editor2.setHighlight(null);
            setEditor2(editor2.copy());
          }, 1);
        }
        break;
      case "wheeldown":
        {
          getEvent(screenEvent);
          editor2.moveCursorDown().slideViewportToCursor();
          setTimeout(() => {
            editor2.setHighlight(null);
            setEditor2(editor2.copy());
          }, 1);
        }
        break;
      default:
        throw new Error(safeStringify(screenEvent));
    }
  };
  const renderLines = () => {
    if (!editor2) {
      return;
    }
    const { viewportY: vy, viewportHeight: vh } = editor2;
    return editor2.renderToLines().filter((l, y) => {
      return y >= vy && y <= vy + vh;
    }).flatMap((line, index, arr) => {
      const renderables = [
        /* @__PURE__ */ jsxRuntime_js.jsx(
          "box",
          {
            top: index,
            left: 0,
            height: 1,
            width: line.length || 1,
            content: line
          },
          `listc-line-${index}-${Date.now}`
        )
      ];
      const tokenizer = getTokenizer(tokenizerDef || {
        name: "words",
        flags: "mg",
        definitions: {
          Whitespace: { style: { fg: "red" }, pattern: /\s+/mig },
          Word: { style: { fg: "green" }, pattern: /\b.+?\b/mig }
        }
      });
      const tokens = tokenizer(line, index);
      tokens.forEach((token, j) => {
        renderables.push(
          /* @__PURE__ */ jsxRuntime_js.jsx(
            "box",
            {
              top: index,
              left: token.start,
              height: 1,
              width: token.text.length || 1,
              content: token.text,
              style: token.style
            },
            `listc-line-${index}-token-${j}-${Date.now}`
          )
        );
      });
      return renderables;
    });
  };
  const renderCursor = () => {
    if (!editor2) {
      return;
    }
    const i = editor2.cursorIndex;
    const { x, y } = editor2.cursorCoords();
    const { cursorIndex: ci, viewportX: vx, viewportY: vy, viewportHeight: vh, viewportWidth: vw } = editor2;
    return /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        top: y - vy,
        left: x - vx,
        width: 1,
        height: 1,
        style: { inverse: true },
        content: editor2.buffer.substring(i, i + 1)
      },
      `editor-cursor-${Date.now()}`
    );
  };
  const renderHighlight = () => {
    if (!editor2) {
      return;
    }
    editor2.cursorIndex;
    const { x, y } = editor2.highlightCoords();
    const { cursorIndex: ci, viewportX: vx, viewportY: vy, viewportHeight: vh, viewportWidth: vw } = editor2;
    const tokenizer = getTokenizer(tokenizerDef || {
      name: "words",
      flags: "mg",
      definitions: {
        Whitespace: { style: { fg: "red" }, pattern: /\s+/mig },
        Word: { style: { fg: "green" }, pattern: /\b.+?\b/mig }
      }
    });
    const tokenUnderCursor = editor2.tokenUnderCursor(x, y, tokenizer);
    if (tokenUnderCursor) {
      return /* @__PURE__ */ jsxRuntime_js.jsx(
        "box",
        {
          top: y - vy,
          left: tokenUnderCursor.start,
          width: tokenUnderCursor.text.length,
          height: 1,
          style: { ...tokenUnderCursor.style, inverse: true },
          content: tokenUnderCursor.text
        },
        `editor-highlight-${Date.now()}`
      );
    } else {
      return [];
    }
  };
  const renderScrollbar = () => {
    const barElements = [/* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        right: 0,
        width: 1,
        mouse: true,
        keys: true,
        input: true,
        clickable: true,
        focused: true,
        style: { fg: "cyan", bg: "grey" }
      },
      `scrollbar-bg-${Date.now()}`
    )];
    if (!editor2) {
      return barElements;
    }
    const th = editor2.renderToLines().length;
    const { cursorIndex: ci, viewportX: vx, viewportY: vy, viewportHeight: vh, viewportWidth: vw } = editor2;
    const sh = Math.floor(vh * vh / th) + 1;
    const sy = Math.floor(vy * vh / th) + 1;
    barElements.push(/* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        right: 0,
        width: 1,
        top: sy,
        height: sh,
        mouse: true,
        keys: true,
        input: true,
        clickable: true,
        focused: true,
        style: { fg: "cyan", bg: "cyan" }
      },
      `scrollbar-btn-${Date.now()}`
    ));
    return barElements;
  };
  const renderStatus = () => {
    if (!editor2) {
      return;
    }
    const { viewportX: vx, viewportY: vy, viewportHeight: vh, viewportWidth: vw } = editor2;
    const t = JSON.stringify(editor2.cursorCoords()).replace(/"/gi, "");
    return /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        mouse: true,
        keys: true,
        top: -1,
        left: vw - 11,
        width: t.length,
        height: 1,
        style: { inverse: true },
        content: t
      },
      `editor-status-${Date.now()}`
    );
  };
  return /* @__PURE__ */ jsxRuntime_js.jsxs(
    "box",
    {
      ref: boxRef,
      ...boxProps,
      mouse: true,
      keys: true,
      input: true,
      clickable: true,
      focused: true,
      style: { border: { fg: "cyan" } },
      tags: false,
      scrollable: false,
      onKeypress: internalOnKeyPress,
      onMouse: mouseAction,
      children: [
        renderLines(),
        renderCursor(),
        renderScrollbar(),
        children || [],
        renderHighlight(),
        renderStatus()
      ]
    }
  );
}
const listingTokenizerDefinition$1 = {
  name: "listing",
  flags: "mg",
  definitions: {
    "Whitespace": { style: { fg: "white" }, pattern: /\s+/mgi },
    "Folder": { style: { fg: "white" }, pattern: new RegExp("(?<=\\[[-+]])\\S+", "mgi") },
    "OpenButton": { style: { fg: "yellow" }, pattern: /\[\+]/mgi },
    "CloseButton": { style: { fg: "yellow" }, pattern: /\[-]/mgi },
    "AddDirButton": { style: { fg: "cyan" }, pattern: /\[\+D]/mgi },
    "AddFileButton": { style: { fg: "magenta" }, pattern: /\[\+F]/mgi },
    "RenameButton": { style: { fg: "blue" }, pattern: /\[r]/mgi },
    "DeleteButton": { style: { fg: "red" }, pattern: /\[x]/mgi },
    "NodeName": { style: { fg: "green" }, pattern: /[a-zA-Z0-9_={}\[\]%*()m,.:;!?@~-]+/mgi },
    "Word": { style: { fg: "green" }, pattern: /\s.+?\s/mgi }
  }
};
function FileTree({
  children,
  rootDir,
  onDirSelect,
  onFileSelect,
  label,
  inodeFilter = (inode, index, nodes, parent) => {
    return true;
  },
  cursor = true,
  ...boxProps
}) {
  const boxRef = React.useRef();
  const [message, setMessage] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const [cursorData, setCursorData] = React.useState(null);
  const [workspace, setWorkspace] = React.useState(new Workspace(inodeFilter));
  React.useEffect(() => {
    const node = boxRef.current;
    if (node) node.focus();
    workspace.init(rootDir).then((wk) => workspace.open(workspace.rootNode)).then((wk) => {
      setTimeout(() => {
        setWorkspace(wk.copy());
      }, 100);
    });
  }, [rootDir]);
  let baseLevel = rootDir.split("/").length * 2;
  if (baseLevel > 0) {
    baseLevel = baseLevel - 1;
  }
  let lines = () => {
    try {
      const lpos = boxRef.current.lpos;
      const treeData = workspace.flatten().filter(inodeFilter);
      return (treeData || []).map((v, i, a) => {
        const lineBuffer = " ".repeat(lpos.width);
        const t = v.toText().substring(baseLevel);
        let rr = insertAt(lineBuffer, 0, t);
        switch (v.type.substring(0, 1)) {
          case "d":
            rr = insertAt(rr, lpos.width - 17, "[+D][+F][r][x]");
            return rr;
          default:
            rr = insertAt(rr, lpos.width - 9, "[r][x]");
            return rr;
        }
      });
    } catch (err) {
      return [];
    }
  };
  const onTokenClick = (eventData) => {
    const treeData = workspace.flatten().filter(inodeFilter);
    const { lines: lines2, visibleLines, line, cursor: { x, y }, cursorScreen, buffer, visibleBuffer, index, tokens, tokenUnderCursor, phrase } = eventData;
    const node = treeData[y];
    switch (phrase.filter((v) => v !== "Whitespace").join(",")) {
      case "Whitespace,NodeName":
      case "NodeName,RenameButton,DeleteButton":
        switch ((tokenUnderCursor || { type: "undefined" }).type) {
          case "NodeName":
            setSelected(node);
            onFileSelect(node);
            break;
          case "RenameButton":
            setMessage(`Rename
${node.fullPath}`);
            break;
          case "DeleteButton":
            setMessage(`Delete
${node.fullPath}`);
            break;
        }
        break;
      case "Whitespace,OpenButton,Whitespace,NodeName":
      case "Whitespace,CloseButton,Whitespace,NodeName":
      case "OpenButton,NodeName,AddDirButton,AddFileButton,RenameButton,DeleteButton":
      case "CloseButton,NodeName,AddDirButton,AddFileButton,RenameButton,DeleteButton":
        switch ((tokenUnderCursor || { type: "undefined" }).type) {
          case "OpenButton":
            node.open(workspace.rootDir, workspace.ig).then((n) => {
              const wk2 = workspace.copy();
              wk2.flatten().filter(inodeFilter);
              setWorkspace(wk2);
            });
            break;
          case "CloseButton":
            node.close();
            const wk = workspace.copy();
            wk.flatten().filter(inodeFilter);
            setWorkspace(wk);
            break;
          case "NodeName":
            setSelected(node);
            onDirSelect(node);
            break;
          case "AddDirButton":
            setMessage(`AddDir
${node.fullPath}`);
            break;
          case "AddFileButton":
            setMessage(`AddFile
${node.fullPath}`);
            break;
          case "RenameButton":
            setMessage(`Rename
${node.fullPath}`);
            break;
          case "DeleteButton":
            setMessage(`Delete
${node.fullPath}`);
            break;
        }
        break;
      default:
        throw new Error(`Unexpected phrase Structure '${phrase}'`);
    }
  };
  const cursorExtra = () => {
    if (!cursorData) return /* @__PURE__ */ jsxRuntime_js.jsx("box", { top: 0, left: 0, width: 1, height: 1, content: " " });
    const { cursor: cursor2, cursorScreen, content } = cursorData;
    return /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        top: cursorScreen.y,
        left: cursorScreen.x,
        width: content.length,
        height: 1,
        style: { inverse: true },
        content
      },
      `xcursor-${Math.random()}-${Date.now()}`
    );
  };
  return /* @__PURE__ */ jsxRuntime_js.jsxs(jsxRuntime_js.Fragment, { children: [
    /* @__PURE__ */ jsxRuntime_js.jsxs("box", { ...boxProps, ref: boxRef, children: [
      /* @__PURE__ */ jsxRuntime_js.jsx(
        ListComponent,
        {
          scrollbar: { ch: "=", track: { fg: "blue", bg: "grey" } },
          top: 0,
          bottom: 2,
          lines: lines(),
          keys: true,
          mouse: true,
          style: { selected: { bg: "blue" } },
          onTokenClick,
          tokenizerDef: listingTokenizerDefinition$1
        }
      ),
      children || [],
      cursor ? cursorExtra() : []
    ] }),
    message && /* @__PURE__ */ jsxRuntime_js.jsx(
      ModalDialog,
      {
        label: "Message",
        title: "Message",
        onClose: () => setMessage(false),
        children: /* @__PURE__ */ jsxRuntime_js.jsx("text", { children: message })
      }
    )
  ] });
}
function FolderPickerDialog({
  title = "Dialog",
  width = "50%",
  height = "50%",
  onFolderSelect
}) {
  const [selected, setSelected] = React.useState(null);
  return /* @__PURE__ */ jsxRuntime_js.jsxs(
    FileTree,
    {
      top: "center",
      left: "center",
      border: { type: "line" },
      style: { bg: "black", fg: "white" },
      keys: true,
      mouse: true,
      clickable: true,
      onKey: (ch, key) => {
        if (key.name === "escape") onFolderSelect(null);
      },
      label: selected ? selected.fullName : "Pick Workspace",
      rootDir: "/",
      inodeFilter: (inode, index, nodes, parent) => {
        return inode.type.indexOf("d") > -1;
      },
      onDirSelect: (selectDir) => {
        setSelected(selectDir);
      },
      onFileSelect: () => {
      },
      children: [
        /* @__PURE__ */ jsxRuntime_js.jsx(
          "button",
          {
            mouse: true,
            keys: true,
            input: true,
            clickable: true,
            focused: true,
            left: 0,
            bottom: 0,
            height: 3,
            width: "45%",
            valign: "middle",
            align: "center",
            style: { bg: "#ffaa00", fg: "#333333", hover: { bg: "#ffdd88", fg: "#333333" } },
            onClick: () => {
              onFolderSelect(selected);
            },
            content: "select"
          }
        ),
        /* @__PURE__ */ jsxRuntime_js.jsx(
          "button",
          {
            mouse: true,
            keys: true,
            input: true,
            clickable: true,
            focused: true,
            right: 0,
            bottom: 0,
            height: 3,
            valign: "middle",
            align: "center",
            width: "45%",
            style: { bg: "#ffaa00", fg: "#333333", hover: { bg: "#ffdd88", fg: "#333333" } },
            onClick: () => {
              onFolderSelect(null);
            },
            content: "cancel"
          }
        )
      ]
    }
  );
}
function VTabs({ children, ...boxProps }) {
  const tabs = React.Children.toArray(children).filter((child) => React.isValidElement(child) && child.props.name);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const tabSelectorStyle = { fg: "#ffaa00", bg: "#333333", hover: { bg: "#ffdd88", fg: "#333333" } };
  return /* @__PURE__ */ jsxRuntime_js.jsx("box", { ...boxProps, children: /* @__PURE__ */ jsxRuntime_js.jsxs(reactBlessedContrib17.Grid, { rows: 1, cols: 6, hideBorder: true, children: [
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { row: 0, col: 0, rowSpan: 1, colSpan: 1, children: tabs.map((tab, i) => {
      return /* @__PURE__ */ jsxRuntime_js.jsx(
        "box",
        {
          top: i * 3,
          height: 3,
          tags: false,
          mouse: true,
          clickable: true,
          onClick: () => {
            setActiveIndex(i);
            try {
              tabs[i].props.onTabClick();
            } catch (err) {
            }
          },
          style: { ...tabSelectorStyle, inverse: activeIndex == i },
          content: "\n " + tab.props.name
        },
        tab.props.name
      );
    }) }),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { row: 0, col: 1, rowSpan: 1, colSpan: 5, children: tabs[activeIndex].props.children })
  ] }) });
}
function Tab({ children }) {
  return /* @__PURE__ */ jsxRuntime_js.jsx(jsxRuntime_js.Fragment, { children });
}
class CursorPoint {
  x = -1;
  y = -1;
  char = "-";
  style = {};
  constructor(x, y, char, style) {
    this.x = x || -1;
    this.y = y || -1;
    this.char = char || "-";
    this.style = style || {};
  }
}
class CodeBufferEditor {
  /**
   * @param {string} filePath
   * @param {{rows:number, cols:number}} windowSize
   */
  constructor(filePath, windowSize) {
    this.filePath = filePath;
    this.viewportY = 0;
    this.viewportX = 0;
    this.viewportHeight = windowSize.rows;
    this.viewportWidth = windowSize.cols;
    this.lines = [];
    this.tokens = [];
    this.tokenizer = function(line, lineNumber) {
      return line.split(" ").flatMap((n) => [n, " "]);
    };
    this._tout000 = 0;
    this._saved = "";
    this.setFilePath(filePath);
    this.cursors = [];
    this.selections = [];
  }
  setFilePath(filePath) {
    const ps = this.filePath.split(".");
    this.tokenizer = getNamedTokenizer(ps[ps.length - 1]);
    this.filePath = filePath;
    this.lines = fs.readFileSync(filePath, { encoding: "utf-8" }).split("\n");
    this.updateTokens();
  }
  save() {
    clearTimeout(this._tout000);
    this._tout000 = setTimeout(() => {
      fs.writeFileSync(this.filePath, this.lines.join("\n"));
      this._saved = `saved ${(/* @__PURE__ */ new Date()).toISOString()}`;
    }, 1e3);
  }
  // ── private ────────────────────────────────────────────────────────────
  _ensureCursorInView(cursor) {
    if (cursor.y < this.viewportY) {
      this.viewportY = cursor.y;
    } else if (cursor.y >= this.viewportY + this.viewportHeight) {
      this.viewportY = cursor.y - this.viewportHeight;
    }
    if (cursor.x < this.viewportX) {
      this.viewportX = cursor.x;
    } else if (cursor.x >= this.viewportX + this.viewportWidth) {
      this.viewportX = cursor.x - this.viewportWidth;
    }
  }
  /**
   *
   * @param lineNumber
   */
  updateTokensLine(lineNumber) {
    this.tokens[lineNumber] = this.tokenizer(this.lines[lineNumber], lineNumber);
  }
  /**
   *
   */
  updateTokens() {
    this.tokens = [];
    this.lines.forEach((line, lineNumber) => {
      this.updateTokensLine(lineNumber);
    });
  }
  /**
   *
   * @param x
   * @param y
   * @returns {CursorPoint}
   */
  getCursor({ x, y }) {
    let crs = new CursorPoint();
    crs.x = x;
    crs.y = y;
    const line = this.lines[y];
    const ps = this.filePath.split(".");
    const lineNumber = parseInt(y);
    const tokenizer = getNamedTokenizer(ps[ps.length - 1]);
    let tokens = null;
    try {
      tokens = tokenizer(line, lineNumber);
    } catch (err) {
      tokens = this.tokens[y];
    }
    let col = 0;
    crs.char = (this.lines[y] || "x")[x] || "y";
    for (const tok of tokens) {
      if (x >= tok.start && x < tok.end) {
        crs.style = tok.style;
        break;
      }
      col += tok.text.length;
    }
    if (crs.style) {
      const last = tokens.slice(-1)[0];
      crs.style = last ? last.style : {};
    }
    return crs;
  }
  /**
  * @param {(code:string)=>TokenizerToken[]} tokenizer
  * @returns {{[lineNumber:string]:TokenizerToken[]}}
  *
  * */
  renderViewport() {
    return Object.keys(this.tokens).reduce(
      (visible, lineId) => {
        const lineNumber = parseInt(lineId);
        if (lineNumber >= this.viewportY && lineNumber <= this.viewportY + this.viewportHeight) {
          visible[lineId] = this.tokens[lineId];
        }
        return visible;
      },
      {}
    );
  }
  onMouse(screenEvent, viewportPosition) {
    const THIS = this;
    let hasChanged = false;
    switch (screenEvent.action) {
      case "mousemove":
        break;
      case "mousedown":
        const padLength = Math.ceil(Math.log10(this.viewportHeight + this.viewportY)) + 1;
        const { xi, yi } = viewportPosition;
        const { x, y } = screenEvent;
        const cursor = { x: x - xi - padLength - 1 - 1 - 1 + this.viewportX, y: y - yi - 1 + this.viewportY };
        const crs = this.getCursor(cursor);
        if (screenEvent.meta) {
          this.cursors.push(crs);
        } else {
          this.cursors = [crs];
        }
        hasChanged = true;
        break;
      case "mouseup":
        break;
      case "wheelup":
        this.cursors = this.cursors.map((crs2) => THIS.moveCursorUp(crs2));
        break;
      case "wheeldown":
        this.cursors = this.cursors.map((crs2) => THIS.moveCursorDown(crs2));
        break;
      default:
        throw new Error(safeStringify(screenEvent));
    }
    return hasChanged;
  }
  onKey(ch, key, onChange = () => {
  }) {
    const THIS = this;
    let hasChanged = false;
    switch (key.name) {
      case "up":
        this.cursors = this.cursors.map((crs) => THIS.moveCursorUp(crs));
        break;
      case "down":
        this.cursors = this.cursors.map((crs) => THIS.moveCursorDown(crs));
        break;
      case "left":
        this.cursors = this.cursors.map((crs) => THIS.moveCursorLeft(crs));
        break;
      case "right":
        this.cursors = this.cursors.map((crs) => THIS.moveCursorRight(crs));
        break;
      case "home":
        this.cursors = this.cursors.map((crs) => THIS.getCursor({ x: 0, y: crs.y }));
        break;
      case "end":
        this.cursors = this.cursors.map((crs) => THIS.getCursor({ x: this.lines[crs.y].length, y: crs.y }));
        break;
      case "pageup":
        this.moveCursorVertically(-this.viewportHeight);
        break;
      case "pagedown":
        this.moveCursorVertically(this.viewportHeight);
        break;
      case "backspace":
        this.cursors.forEach((crs) => THIS.backspace(crs));
        this.save();
        hasChanged = true;
        break;
      case "delete":
        this.cursors.forEach((crs) => THIS.delete(crs));
        this.save();
        hasChanged = true;
        break;
      case "return":
        this.cursors.toSorted((a, b) => a.y - b.y).forEach((crs, y) => {
          crs.y += y;
          THIS.insert("\n", crs);
          crs.y += 1;
          crs.x = 0;
        });
        this.save();
        hasChanged = true;
        break;
      case "tab":
        this.cursors.toSorted((a, b) => a.y - b.y).forEach((crs, y) => {
          THIS.insert("	", crs);
        });
        this.save();
        hasChanged = true;
        break;
      default:
        if (ch && ch.length > 0 && !key.ctrl && !key.meta) {
          if (key.sequence && key.sequence.length === 1) {
            this.cursors.forEach((crs) => THIS.insert(key.sequence, crs));
            this.save();
            hasChanged = true;
          } else if (key.name && key.name.length === 1) {
            this.cursors.forEach((crs) => THIS.insert(key.name, crs));
            this.save();
            hasChanged = true;
          } else {
            this.cursors.forEach((crs) => THIS.insert(ch, crs));
            hasChanged = true;
          }
        }
    }
    return hasChanged;
  }
  /**
   *
   * @param {CursorPoint} cursor
   * @returns {CursorPoint}
   */
  moveCursorUp(cursor) {
    if (cursor.y > 0) {
      cursor.y--;
      const line = this.lines[cursor.y];
      if (cursor.x >= line.length) {
        cursor.x = line.length;
      }
      this._ensureCursorInView(cursor);
    }
    return cursor;
  }
  /**
   *
   * @param {CursorPoint} cursor
   * @returns {CursorPoint}
   */
  moveCursorDown(cursor) {
    if (cursor.y + 1 < this.lines.length) {
      if (cursor.x >= this.lines[cursor.y + 1].length) {
        cursor.x = this.lines[cursor.y + 1].length;
      }
      cursor.y++;
      this._ensureCursorInView(cursor);
    }
    return cursor;
  }
  /**
   *
   * @param {CursorPoint} cursor
   * @returns {CursorPoint}
   */
  moveCursorLeft(cursor) {
    if (cursor.x > 0) {
      cursor.x--;
      this._ensureCursorInView(cursor);
    }
    return cursor;
  }
  /**
   *
   * @param {CursorPoint} cursor
   * @returns {CursorPoint}
   */
  moveCursorRight(cursor) {
    const line = this.lines[cursor.y];
    if (cursor.x < line.length) {
      cursor.x++;
    } else {
      cursor.x = line.length;
    }
    this._ensureCursorInView(cursor);
    return cursor;
  }
  moveCursorVertically(n, cursor) {
    if (n > 0) {
      for (let i = 0; i < n; i++) {
        this.moveCursorDown(cursor);
      }
    } else if (n < 0) {
      for (let i = n; i <= 0; i++) {
        this.moveCursorUp(cursor);
      }
    }
  }
  moveCursorHorizontally(n, cursor) {
    if (n > 0) {
      for (let i = 0; i < n; i++) {
        this.moveCursorRight(cursor);
      }
    } else if (n < 0) {
      for (let i = n; i <= 0; i++) {
        this.moveCursorLeft(cursor);
      }
    }
  }
  // ── edits ───────────────────────────────────────────────────────────────
  insert(text, cursor) {
    const oldLine = this.lines[cursor.y];
    const before = oldLine.substring(0, cursor.x);
    const after = oldLine.substring(cursor.x);
    const newLine = before + text + after;
    let newLines = this.lines.slice(0, cursor.y);
    let oldLinesAfter = this.lines.slice(cursor.y + 1);
    this.lines = newLines.concat(newLine.split("\n")).concat(oldLinesAfter);
    this.updateTokensLine(cursor.y);
    cursor.x++;
    this._ensureCursorInView(cursor);
    return this;
  }
  delete(cursor) {
    const oldLine = this.lines[cursor.y];
    const before = oldLine.substring(0, cursor.x);
    const after = oldLine.substring(cursor.x + 1);
    const newLine = before + after;
    let newLines = this.lines.slice(0, cursor.y);
    let oldLinesAfter = this.lines.slice(cursor.y + 1);
    this.lines = newLines.concat(newLine.split("\n")).concat(oldLinesAfter);
    this.updateTokensLine(cursor.y);
    this._ensureCursorInView(cursor);
    return this;
  }
  backspace(cursor) {
    if (cursor.x > 0) {
      cursor.x--;
      this.delete(cursor);
    } else if (cursor.y > 0) {
      const newCol = this.lines[cursor.y - 1].length;
      cursor.y--;
      cursor.x = newCol;
      this.delete(cursor);
      this.updateTokensLine(cursor.y);
    }
    this._ensureCursorInView(cursor);
    return this;
  }
  // ── clone ──────────────────────────────────────────────────────────────
  /** return a new instance with identical state */
  copy() {
    const clone = new CodeBufferEditor(this.filePath, {
      rows: this.viewportHeight,
      cols: this.viewportWidth
    });
    clone.filePath = this.filePath;
    clone.viewportY = this.viewportY;
    clone.viewportX = this.viewportX;
    clone.lines = this.lines;
    clone.cursors = this.cursors;
    clone.tokens = this.tokens;
    clone.tokenizer = this.tokenizer;
    clone.selections = this.selections;
    clone._saved = this._saved;
    return clone;
  }
  getStatus() {
    const range = Object.keys(this.renderViewport());
    const json = {
      cursor: this.cursors,
      v: { x: this.viewportX, y: this.viewportY, w: this.viewportWidth, h: this.viewportHeight },
      s: this._saved,
      l: range[0] + " ... " + range[range.length - 1]
    };
    return JSON.stringify(json).replace(/"/gi, "");
  }
}
function CodeBufferEditorComponent({
  filePath,
  onKeypress = (ch, key) => {
  },
  onChange = ({ editor: editor2, ch, key, screenEvent, viewport }) => {
  },
  ...boxProps
}) {
  const boxRef = React.useRef();
  const [editor2, setEditor2] = React.useState(null);
  const [size, setSize] = React.useState({ rows: 10, cols: 30 });
  const [lastEvent, setLastEvent] = React.useState({ editor: null, ch: null, key: null, screenEvent: null, viewport: null });
  React.useEffect(() => {
    if (filePath) {
      const ed = new CodeBufferEditor(filePath, { rows: size.rows, cols: size.cols });
      ed.viewportHeight = size.rows - 1;
      ed.viewportWidth = size.cols;
      setEditor2(ed);
    } else {
      setEditor2(null);
    }
  }, [filePath]);
  React.useEffect(() => {
    const box2 = boxRef.current;
    if (!box2) return;
    const update = () => {
      setSize({ cols: box2.width, rows: box2.height - 2 });
    };
    update();
    box2.on("resize", update);
    return () => box2.removeListener("resize", update);
  }, []);
  React.useEffect(() => {
    if (editor2) {
      editor2.viewportWidth = size.cols;
      editor2.viewportHeight = size.rows;
      setEditor2(editor2.copy());
    }
  }, [size]);
  const cursors = () => {
    if (!editor2) {
      return /* @__PURE__ */ jsxRuntime_js.jsx(
        "box",
        {
          left: 4,
          top: 1,
          width: 1,
          height: 1,
          style: { blink: true },
          content: "_"
        },
        `0-1-no-file`
      );
    }
    const padLength = Math.ceil(Math.log10(editor2.viewportHeight + editor2.viewportY)) + 1;
    return [...editor2.cursors].filter((cursor, y) => {
      return cursor.y >= editor2.viewportY && cursor.y <= editor2.viewportY + editor2.viewportHeight;
    }).map((crs, id) => {
      const cursor = editor2.getCursor({ ...crs });
      return /* @__PURE__ */ jsxRuntime_js.jsx(
        "box",
        {
          left: cursor.x - editor2.viewportX + padLength + 1 + 1,
          top: cursor.y - editor2.viewportY,
          width: 1,
          height: 1,
          style: { ...cursor.style, underline: true, bold: true, inverse: true },
          tags: false,
          content: cursor.char
        },
        `cursor-${id}-${Date.now()}`
      );
    });
  };
  const tokenList = () => {
    if (!editor2) {
      return /* @__PURE__ */ jsxRuntime_js.jsx(
        "box",
        {
          mouse: true,
          keys: true,
          input: true,
          clickable: true,
          focused: true,
          left: (size.cols >> 1) - 8,
          top: (size.rows >> 1) - 1,
          width: 16,
          height: 3,
          style: { bg: "#eeee00", fg: "#111111" },
          content: "\n No File Loaded"
        },
        `0-0-no-file`
      );
    }
    const padLength = Math.ceil(Math.log10(editor2.viewportHeight + editor2.viewportY)) + 1;
    const lines = editor2.renderViewport();
    return Object.keys(lines).flatMap((lineNumber, k) => {
      const line = lines[lineNumber];
      const lineNumberText = `${String(lineNumber).padStart(padLength, " ")}`;
      const lineNumberBox = /* @__PURE__ */ jsxRuntime_js.jsx(
        "box",
        {
          left: 0,
          top: k,
          width: padLength + 1,
          height: 1,
          style: { bg: "#222222", fg: "#33aabb", inverse: editor2.cursors.map((c) => c.y).indexOf(lineNumber) > -1 },
          content: lineNumberText + "│"
        },
        `${lineNumber}-lineNumber-${Date.now}`
      );
      return line.reduce((a, t) => {
        a.push(
          /* @__PURE__ */ jsxRuntime_js.jsx(
            "box",
            {
              left: t.x + padLength + 1 + 1,
              top: t.y - editor2.viewportY,
              width: t.text.length,
              height: 1,
              style: t.style,
              content: t.text
            },
            `${t.x}-${t.y}-${Date.now()}`
          )
        );
        return a;
      }, [
        lineNumberBox
        /*,
        <box
          key={`terminator-${lineNumber}-${Date.now()}`}
          left={padLength + 1 + line.length} top={lineNumber - editor.viewportY} width={1} height={1}
          style={{bg:"#113311",fg:"#555555"}}
          content={'¬'}
        />*/
      ]);
    });
  };
  const internalOnKeypress = (ch, key) => {
    onKeypress(ch, key);
    if (editor2 == null || filePath == null) {
      return;
    }
    const hasChanged = editor2.onKey(ch, key);
    if (hasChanged) {
      const newLastEvent = { ...lastEvent, editor: editor2, ch, key, viewport: boxRef.current.lpos };
      onChange(newLastEvent);
      setLastEvent(newLastEvent);
    }
    setEditor2(editor2.copy());
  };
  const mouseAction = (screenEvent) => {
    if (!editor2) {
      return;
    }
    const mustChange = editor2.onMouse(screenEvent, boxRef.current.lpos);
    if (mustChange) {
      const newLastEvent = { ...lastEvent, editor: editor2, screenEvent, viewport: boxRef.current.lpos };
      onChange(newLastEvent);
      setLastEvent(newLastEvent);
      setEditor2(editor2.copy());
    }
  };
  return /* @__PURE__ */ jsxRuntime_js.jsxs(
    "box",
    {
      ref: boxRef,
      ...boxProps,
      mouse: true,
      keys: true,
      input: true,
      clickable: true,
      focused: true,
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
      tags: false,
      scrollable: false,
      onKeypress: internalOnKeypress,
      onMouse: mouseAction,
      label: `Editing: ${filePath}`,
      children: [
        tokenList(),
        /* @__PURE__ */ jsxRuntime_js.jsx(
          "box",
          {
            top: size.rows,
            left: 2,
            width: size.cols - 6,
            height: 1,
            content: editor2?.getStatus(),
            tags: false,
            style: { fg: "black", bg: "yellow" }
          },
          `status`
        ),
        cursors()
      ]
    }
  );
}
const util = require("util");
const cp = require("child_process");
const exec = util.promisify(cp.exec);
async function getStatus(cwd) {
  const { stdout } = await exec(`git status --porcelain`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
async function getCommits(cwd) {
  const { stdout } = await exec(`git log --pretty=format:"%h %s" --abbrev=40 | tee`, { cwd });
  const lines = stdout.split("\n").filter(Boolean);
  return await Promise.all(lines.map(async (v) => {
    const id = v.substring(0, 40);
    const message = v.substring(41);
    const { stdout: tags } = await exec(`git tag --points-at ${id}`, { cwd });
    return `${id.substring(0, 8)}│${(tags ? tags.trim("\n") : "").padEnd(9, " ")}│${message}`;
  }));
}
async function getBranch(cwd) {
  const { stdout } = await exec(`git branch --show-current`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
async function getCurrentTag(cwd) {
  const { stdout } = await exec(`git describe --tags --exact-match 2>/dev/null || echo "none"`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
async function getRemotes(cwd) {
  const { stdout } = await exec(`git remote -v`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
async function getTags(cwd) {
  const { stdout } = await exec(`git tag | tee`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
async function gitStage(cwd, filePath) {
  const { stdout } = await exec(`git add -f "${filePath}"`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
async function gitUnstage(cwd, filePath) {
  const { stdout } = await exec(`git restore --staged "${filePath}"`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
async function gitCommit(cwd, commitMessage) {
  const { stdout } = await exec(`git commit -m "${commitMessage}"`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
async function gitTag(cwd, tag) {
  const { stdout } = await exec(`git tag "${tag}"`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
async function gitPush(cwd, remote, branch) {
  const { stdout } = await exec(`git push "${remote}" "${branch}" --tags`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
const defaultText = "...".split(",").join("\n");
function SimpleTextEditorComponent({ initialText, onChange, ...boxProps }) {
  const boxRef = React.useRef(null);
  const [editor2, setEditor2] = React.useState(null);
  const [mouseCoords, setMouseCoords] = React.useState({ x: 0, y: 0 });
  const [size, setSize] = React.useState({ rows: 10, cols: 30 });
  let changedTimeout = 0;
  React.useEffect(() => {
    let newEditor = editor2;
    if (!newEditor) {
      newEditor = new SimpleTextEditor(initialText || defaultText);
    }
    if ((initialText || defaultText).substring(newEditor.cursorIndex) !== newEditor.buffer.substring(newEditor.cursorIndex)) {
      newEditor.cursorIndex = 0;
      newEditor.slideViewportToCursor();
    }
    newEditor.buffer = initialText || defaultText;
    newEditor.viewportHeight = size.rows - 1;
    newEditor.viewportWidth = size.cols;
    setEditor2(newEditor.copy());
  }, [initialText]);
  React.useEffect(() => {
    const box2 = boxRef.current;
    if (!box2) return;
    const update = () => {
      setSize({ cols: box2.width, rows: box2.height - 2 });
    };
    update();
    box2.on("resize", update);
    return () => box2.removeListener("resize", update);
  }, []);
  React.useEffect(() => {
    if (editor2) {
      editor2.viewportWidth = size.cols;
      editor2.viewportHeight = size.rows;
      setEditor2(editor2.copy());
    }
  }, [size]);
  const internalOnKeyPress = (ch, key) => {
    editor2.onKey(ch, key);
    clearTimeout(changedTimeout);
    changedTimeout = setTimeout(() => {
      onChange(editor2);
      setEditor2(editor2.copy());
    }, 80);
  };
  const setCursorPosition = (screenEvent) => {
    if (!editor2) {
      return;
    }
    const { xi, yi } = boxRef.current.lpos;
    const { x, y } = screenEvent;
    editor2.setCursor(x - xi - 1 + editor2.viewportX, y - yi - 1 + editor2.viewportY);
    setEditor2(editor2.copy());
  };
  const mouseAction = (event) => {
    const { x, y } = event;
  };
  const renderLines = () => {
    if (!editor2) {
      return;
    }
    const { viewportY: vy, viewportHeight: vh } = editor2;
    return editor2.renderToLines().filter((l, y) => {
      return y >= vy && y <= vy + vh;
    }).map((line, index) => {
      return /* @__PURE__ */ jsxRuntime_js.jsx(
        "box",
        {
          top: index,
          left: 0,
          height: 1,
          width: line.length || 1,
          content: line
        },
        `commit-editor-line-${index}`
      );
    });
  };
  const renderCursor = () => {
    if (!editor2) {
      return;
    }
    const i = editor2.cursorIndex;
    const { x, y } = editor2.cursorCoords();
    const { cursorIndex: ci, viewportX: vx, viewportY: vy, viewportHeight: vh, viewportWidth: vw } = editor2;
    const content = editor2.buffer.substring(i, i + 1);
    return /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        top: y - vy,
        left: x - vx,
        width: 1,
        height: 1,
        style: { inverse: true, underline: true },
        content
      },
      `editor-cursor-${Date.now()}`
    );
  };
  const renderStatus = () => {
    if (!editor2) {
      return;
    }
    const { cursorIndex: ci, viewportX: vx, viewportY: vy, viewportHeight: vh, viewportWidth: vw } = editor2;
    const { x: cx, y: cy } = editor2.cursorCoords();
    const { x: mx, y: my } = mouseCoords;
    let cursorContent = editor2.buffer.substring(ci, ci + 1);
    let content = cursorContent;
    if (boxRef.current && boxRef.current.lpos) {
      const { xi, yi } = boxRef.current.lpos;
      const feedback = {
        C: `${cx},${cy},[${ci}]=${cursorContent}`,
        B: `${xi},${yi}`,
        V: `${vx},${vy},${vw},${vh}`,
        M: `A${mx},${my}R${mx - xi - 1},${my - yi - 1}`
      };
      content = safeStringify(feedback).replace(/[{} "]/gi, "");
    }
    return /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        top: 7,
        left: 2,
        width: content.length,
        height: 1,
        style: { inverse: true, underline: true },
        content
      },
      `editor-status-${Date.now()}`
    );
  };
  return /* @__PURE__ */ jsxRuntime_js.jsxs(
    "box",
    {
      ref: boxRef,
      ...boxProps,
      mouse: true,
      keys: true,
      input: true,
      clickable: true,
      focused: true,
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
      tags: false,
      scrollable: false,
      onKeypress: internalOnKeyPress,
      onClick: setCursorPosition,
      onMouse: mouseAction,
      children: [
        renderLines(),
        renderCursor(),
        renderStatus()
      ]
    }
  );
}
class Semver {
  major = 0;
  minor = 0;
  patch = 0;
  /**
   *
   * @param {string} v
   * @return {Semver}
   */
  static from(v) {
    try {
      const [major, minor, patch] = (v || "0.0.0").split(".");
      return new Semver(major, minor, patch);
    } catch (e) {
      const [major, minor, patch] = "0.0.0".split(".");
      return new Semver(major, minor, patch);
    }
  }
  constructor(major, minor, patch) {
    this.major = major;
    this.minor = minor;
    this.patch = patch;
  }
  /**
   *
   * @return {Semver}
   */
  nextMajor() {
    return new Semver((parseInt(this.major) + 1).toString(), "0", "0");
  }
  prevMajor() {
    let v = parseInt(this.major);
    v = v > 0 ? v - 1 : v;
    return new Semver(v.toString(), "0", "0");
  }
  /**
   *
   * @return {Semver}
   */
  nextMinor() {
    return new Semver(this.major, (parseInt(this.minor) + 1).toString(), "0");
  }
  prevMinor() {
    let v = parseInt(this.minor);
    v = v > 0 ? v - 1 : v;
    return new Semver(this.major, v.toString(), "0");
  }
  /**
   *
   * @return {Semver}
   */
  nextPatch() {
    return new Semver(this.major, this.minor, (parseInt(this.patch) + 1).toString());
  }
  prevPatch() {
    let v = parseInt(this.patch);
    v = v > 0 ? v - 1 : v;
    return new Semver(this.major, this.minor, v.toString());
  }
  toString() {
    return `${this.major}.${this.minor}.${this.patch}`;
  }
  copy() {
    return new Semver(this.major, this.minor, this.patch);
  }
}
function SemverControl({ initial, onChange, ...boxProps }) {
  const [semver, setSemver] = React.useState(Semver.from(initial));
  React.useEffect(() => {
    setSemver(Semver.from(initial));
  }, [initial]);
  const decMajor = () => {
    const newSemver = semver.prevMajor();
    onChange(newSemver);
    setSemver(newSemver);
  };
  const incMajor = () => {
    const newSemver = semver.nextMajor();
    onChange(newSemver);
    setSemver(newSemver);
  };
  const decMinor = () => {
    const newSemver = semver.prevMinor();
    onChange(newSemver);
    setSemver(newSemver);
  };
  const incMinor = () => {
    const newSemver = semver.nextMinor();
    onChange(newSemver);
    setSemver(newSemver);
  };
  const decPatch = () => {
    const newSemver = semver.prevPatch();
    onChange(newSemver);
    setSemver(newSemver);
  };
  const incPatch = () => {
    const newSemver = semver.nextPatch();
    onChange(newSemver);
    setSemver(newSemver);
  };
  return /* @__PURE__ */ jsxRuntime_js.jsxs("box", { ...boxProps, children: [
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { mouse: true, focused: true, clickable: true, onClick: decMajor, left: 1, height: 1, width: 1, content: "v" }),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { mouse: true, focused: true, clickable: true, onClick: incMajor, left: 2, height: 1, width: semver.major.length, content: semver.major }),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { mouse: true, focused: true, clickable: true, onClick: decMinor, left: 2 + semver.major.length, height: 1, width: 1, content: "." }),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { mouse: true, focused: true, clickable: true, onClick: incMinor, left: 3 + semver.major.length, height: 1, width: semver.minor.length, content: semver.minor }),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { mouse: true, focused: true, clickable: true, onClick: decPatch, left: 3 + semver.major.length + semver.minor.length, height: 1, width: 1, content: "." }),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { mouse: true, focused: true, clickable: true, onClick: incPatch, left: 4 + semver.major.length + semver.minor.length, height: 1, width: semver.patch.length, content: semver.patch })
  ] });
}
function GitComponent({
  rootDir,
  onFileSelect,
  ...boxProps
}) {
  const [message, setMessage] = React.useState(false);
  const [gitStatus, setGitStatus] = React.useState([]);
  const [gitCommits, setGitCommits] = React.useState([]);
  const [gitBranch, setGitBranch] = React.useState("");
  const [gitCurrentTag, setGitCurrentTag] = React.useState("");
  const [gitTags, setGitTags] = React.useState([]);
  const [gitRemotes, setGitRemotes] = React.useState([]);
  const [commitMessage, setCommitMessage] = React.useState(null);
  const [mouseCoords, setMouseCoords] = React.useState({ x: 0, y: 0 });
  const sortFilesFn = (a, b) => a.substring(3) > b.substring(3) ? 1 : a.substring(3) === b.substring(3) ? 0 : -1;
  async function refreshAll() {
    const result = await Promise.all([
      getStatus(rootDir),
      getCommits(rootDir),
      getBranch(rootDir),
      getCurrentTag(rootDir),
      getRemotes(rootDir),
      getTags(rootDir)
    ]);
    setGitStatus(Array.from(result[0]).toSorted(sortFilesFn));
    setGitCommits(result[1]);
    setGitBranch(result[2]);
    setGitCurrentTag(result[3]);
    setGitRemotes(Array.from(result[4]).map((v) => {
      const tk = v.split(/\s+/gi);
      return {
        name: tk[0],
        url: tk[1],
        kind: tk[2]
      };
    }));
    setGitTags(result[5]);
  }
  React.useEffect(() => {
    refreshAll();
  }, []);
  const onFilePathSelect = (event) => {
    const staged = event.content.substring(0, 1);
    const changed = event.content.substring(1, 2);
    const { x, y } = mouseCoords;
    const file = event.content.substring(3);
    if (staged === " " || staged === "?" || changed !== " " && staged === changed) {
      gitStage(rootDir, file).then((result) => {
        return getStatus(rootDir);
      }).then((result) => {
        setGitStatus(result.toSorted(sortFilesFn));
      }).catch((error) => {
        setMessage(`git stage "${file} error (${error})"`);
      });
    } else if (changed === " " || changed === "?") {
      gitUnstage(rootDir, file).then((result) => {
        return getStatus(rootDir);
      }).then((result) => {
        setGitStatus(result.toSorted(sortFilesFn));
      }).catch((error) => {
        setMessage(`git unstaged "${file} error (${error})"`);
      });
    }
  };
  const onCommitSelect = (event) => {
    const tag = event.content.substring(9, 18).trim();
    const msg = event.content.substring(19);
    setCommitMessage(msg);
    if (tag.length >= 5) {
      setGitCurrentTag(tag);
    }
  };
  const commitStagedFiles = (event) => {
    if (commitMessage.trim() === "") {
      setMessage(`commit message cannot be empty`);
    } else {
      gitCommit(rootDir, commitMessage).then((result) => {
        return refreshAll();
      }).then((result) => {
        setMessage(`git commit -m "${commitMessage}"`);
      });
    }
  };
  const tagLastCommit = (event) => {
    gitTag(rootDir, gitCurrentTag).then((result) => {
      return refreshAll();
    }).then((result) => {
      setMessage(`git tag -m "${gitCurrentTag}"`);
    });
  };
  const pushCommits = (event) => {
    setMessage(`git push "${gitRemotes[0].name}" "${gitBranch}"`);
    gitPush(rootDir, gitRemotes[0].name, gitBranch).then((result) => {
      setMessage(`git push "${gitRemotes[0].name}" "${gitBranch}"`);
    });
    setMessage(`commit selected ${event.content} ${process.cwd()}`);
  };
  const commitMessageChanged = (bufferEditor) => {
    setCommitMessage(bufferEditor.buffer);
  };
  const mouseAction = (event) => {
    const { x, y } = event;
    switch (event.action) {
      case "mousemove":
        break;
      case "mousedown":
        break;
      case "mouseup":
        break;
      case "wheelup":
        editor.moveCursorUp().slideViewportToCursor();
        setEditor(editor.copy());
        break;
      case "wheeldown":
        editor.moveCursorDown().slideViewportToCursor();
        setEditor(editor.copy());
        break;
      default:
        throw new Error(safeStringify(event));
    }
    setMouseCoords({ x, y });
  };
  const status = `{cyan-fg}${(gitRemotes[0] || {}).name}{/cyan-fg}/{red-fg}${gitBranch}{/red-fg}({yellow-fg}${gitCurrentTag}{/yellow-fg})`;
  const statusLen = `${(gitRemotes[0] || {}).name}/${gitBranch}(${gitCurrentTag})`.length;
  return /* @__PURE__ */ jsxRuntime_js.jsxs("box", { ...boxProps, children: [
    /* @__PURE__ */ jsxRuntime_js.jsxs("box", { label: ``, height: 9, border: { type: "line" }, children: [
      /* @__PURE__ */ jsxRuntime_js.jsx(
        "list",
        {
          mouse: true,
          keys: true,
          input: true,
          clickable: true,
          focused: true,
          scrollbar: { ch: "=", track: { fg: "blue", bg: "grey" } },
          items: gitStatus,
          style: { selected: { bg: "blue" } },
          onSelect: onFilePathSelect,
          onSelectItem: onFilePathSelect,
          onMouse: mouseAction
        }
      ),
      /* @__PURE__ */ jsxRuntime_js.jsx("box", { top: -1, left: 25, width: 7, height: 1, content: `{${mouseCoords.x},${mouseCoords.y}}` })
    ] }),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { content: status, top: 0, left: 3, width: statusLen, height: 1, tags: true }),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { content: rootDir, top: 8, left: 3, width: rootDir.length, height: 1 }),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      SimpleTextEditorComponent,
      {
        top: 9,
        height: 9,
        label: "Message",
        initialText: commitMessage,
        border: { type: "line" },
        onChange: commitMessageChanged
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      SemverControl,
      {
        top: 9,
        left: 31,
        width: 9,
        height: 1,
        initial: gitCurrentTag,
        onChange: (s) => {
          setGitCurrentTag(s.toString());
        }
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      "button",
      {
        top: 18,
        left: "0%",
        height: 3,
        width: "30%",
        mouse: true,
        keys: true,
        input: true,
        clickable: true,
        focused: true,
        valign: "middle",
        align: "center",
        style: { bg: "#ffaa00", fg: "#333333", hover: { bg: "#ffdd88", fg: "#333333" } },
        onClick: commitStagedFiles,
        content: "\ncommit\n"
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      "button",
      {
        top: 18,
        left: "35%",
        height: 3,
        width: "30%",
        mouse: true,
        keys: true,
        input: true,
        clickable: true,
        focused: true,
        valign: "middle",
        align: "center",
        style: { bg: "#ffaa00", fg: "#333333", hover: { bg: "#ffdd88", fg: "#333333" } },
        onClick: tagLastCommit,
        content: `
tag ${gitCurrentTag}
`
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      "button",
      {
        top: 18,
        left: "70%",
        height: 3,
        width: "30%",
        mouse: true,
        keys: true,
        input: true,
        clickable: true,
        focused: true,
        valign: "middle",
        align: "center",
        style: { bg: "#ffaa00", fg: "#333333", hover: { bg: "#ffdd88", fg: "#333333" } },
        onClick: pushCommits,
        content: "\npush\n"
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { label: "Commits", top: 21, border: { type: "line" }, onMouse: (event) => {
      const { x, y } = event;
      setCommitMessage(safeStringify({ x, y }));
    }, children: /* @__PURE__ */ jsxRuntime_js.jsx(
      "list",
      {
        mouse: true,
        keys: true,
        input: true,
        clickable: true,
        focused: true,
        scrollbar: { ch: "=", track: { fg: "blue", bg: "grey" } },
        items: gitCommits,
        style: { selected: { bg: "blue" } },
        onSelect: onCommitSelect,
        onSelectItem: onCommitSelect,
        label: "Status"
      }
    ) }),
    message && /* @__PURE__ */ jsxRuntime_js.jsx(
      ModalDialog,
      {
        title: "Message",
        onClose: () => setMessage(false),
        children: /* @__PURE__ */ jsxRuntime_js.jsx("text", { children: message })
      }
    )
  ] });
}
function ErrorFallback({ error, resetErrorBoundary }) {
  return /* @__PURE__ */ jsxRuntime_js.jsxs(
    "box",
    {
      top: "center",
      left: "center",
      width: "75%",
      height: "75%",
      border: { type: "line" },
      style: { fg: "red" },
      children: [
        /* @__PURE__ */ jsxRuntime_js.jsx(
          "button",
          {
            right: 0,
            top: 0,
            width: 9,
            height: 1,
            mouse: true,
            clickable: true,
            onPress: resetErrorBoundary,
            valign: "middle",
            align: "center",
            style: { bg: "#ffaa00", fg: "#333333", hover: { bg: "#ffdd88", fg: "#333333" } },
            content: "close"
          }
        ),
        /* @__PURE__ */ jsxRuntime_js.jsx("box", { top: 2, left: 0, children: `Something went wrong:
${error.message}
${error.stack}` })
      ]
    }
  );
}
const listingTokenizerDefinition = {
  name: "listing",
  flags: "mg",
  definitions: {
    "Whitespace": { style: { fg: "white" }, pattern: /\s+/mgi },
    "CloseButton": { style: { fg: "red" }, pattern: /\[x]/mgi },
    "NodeName": { style: { fg: "green" }, pattern: /[/a-zA-Z0-9_={}\[\]%*()m,.:;!?@~-]+/mgi },
    "Word": { style: { fg: "yellow" }, pattern: /\s.+?\s/mgi }
  }
};
function App(props) {
  const openedFilesRef = React.useRef(null);
  const [message, setMessage] = React.useState(false);
  const [pickFolder, setPickFolder] = React.useState(false);
  const [currentEditorText, setCurrentEditorText] = React.useState("");
  const [selectedFile, setSelectedFile] = React.useState(null);
  const [openedFiles, setOpenedFiles] = React.useState({});
  const [fileContent, setFileContent] = React.useState("");
  const [rootDir, setRootDir] = React.useState(process.cwd());
  const [gitStatus, setGitStatus] = React.useState([]);
  const selectFile = (node) => {
    setSelectedFile(node.fullPath);
    const newOpenedFiles = { ...openedFiles };
    newOpenedFiles[node.fullPath.replace(rootDir, "")] = node;
    setOpenedFiles(newOpenedFiles);
    setFileContent(`Loading ${node.relPath}`);
    node.readFile(node.fullPath).then(setFileContent);
  };
  const selectDir = async (dir) => {
    setMessage(`dir selected ${Object.keys(dir)}`);
  };
  const onCurrentEditorChange = ({ editor: editor2, ch, key, screenEvent, viewport }) => {
    setCurrentEditorText(safeStringify({ editor: { cursors: editor2.cursors }, viewport, ch, key, screenEvent }));
  };
  const onCodeEditKeyPress = (ch, key) => {
  };
  const debugView = () => {
    const content = `Debug:
${"parsed some text"}`;
    return /* @__PURE__ */ jsxRuntime_js.jsx("box", { content });
  };
  const listOpenedFiles = () => {
    if (openedFilesRef === null) {
      return [];
    }
    if (openedFilesRef.current === null) {
      return [];
    }
    const lpos = openedFilesRef.current.lpos;
    return Object.keys(openedFiles).map(
      (k) => {
        return k.padEnd(lpos.width - 6, " ") + "[x]";
      }
    );
  };
  const onTokenClick = (eventData) => {
    listOpenedFiles();
    const { lines, visibleLines, line, cursor: { x, y }, cursorScreen, buffer, visibleBuffer, index, tokens, tokenUnderCursor, phrase } = eventData;
    let k = Object.keys(openedFiles)[y];
    let node = openedFiles[k];
    switch (phrase.filter((v) => v !== "Whitespace").join(",")) {
      case "Whitespace,NodeName":
      case "NodeName,CloseButton":
        switch ((tokenUnderCursor || { type: "undefined" }).type) {
          case "NodeName":
            selectFile(node);
            break;
          case "CloseButton":
            const newOpenedFiles = { ...openedFiles };
            delete newOpenedFiles[k];
            setOpenedFiles(newOpenedFiles);
            setMessage(`Close
${node.fullPath} selectedFile:${selectedFile} node.fullPath:${node.fullPath} `);
            if (selectedFile === node.fullPath) {
              k = Object.keys(openedFiles)[y - 1];
              node = openedFiles[k];
              setSelectedFile(node.fullPath);
            }
            break;
        }
        break;
      default:
        throw new Error(`Unexpected phrase Structure '${phrase}'`);
    }
  };
  return /* @__PURE__ */ jsxRuntime_js.jsxs(jsxRuntime_js.Fragment, { children: [
    /* @__PURE__ */ jsxRuntime_js.jsxs(reactBlessedContrib17.Grid, { rows: 8, cols: 15, hideBorder: true, children: [
      /* @__PURE__ */ jsxRuntime_js.jsxs(VTabs, { row: 0, col: 0, rowSpan: 8, colSpan: 5, children: [
        /* @__PURE__ */ jsxRuntime_js.jsx(Tab, { name: "Project", children: /* @__PURE__ */ jsxRuntime_js.jsxs(reactBlessedContrib17.Grid, { rows: 8, cols: 1, children: [
          /* @__PURE__ */ jsxRuntime_js.jsx(
            "box",
            {
              row: 0,
              col: 0,
              rowSpan: 3,
              colSpan: 1,
              label: "opened Files",
              ref: openedFilesRef,
              children: /* @__PURE__ */ jsxRuntime_js.jsx(
                ListComponent,
                {
                  lines: listOpenedFiles(),
                  defaultText: "",
                  keys: true,
                  mouse: true,
                  scroll: true,
                  style: { selected: { bg: "blue" } },
                  scrollbar: { ch: "=", track: { fg: "blue", bg: "grey" } },
                  onTokenClick,
                  tokenizerDef: listingTokenizerDefinition
                }
              )
            },
            1
          ),
          /* @__PURE__ */ jsxRuntime_js.jsx(
            "box",
            {
              row: 3,
              col: 0,
              rowSpan: 5,
              colSpan: 1,
              label: "Project",
              children: /* @__PURE__ */ jsxRuntime_js.jsx(
                FileTree,
                {
                  top: 0,
                  bottom: 0,
                  rootDir,
                  onDirSelect: selectDir,
                  onFileSelect: selectFile,
                  label: "Project",
                  children: /* @__PURE__ */ jsxRuntime_js.jsx(
                    "button",
                    {
                      mouse: true,
                      keys: true,
                      input: true,
                      clickable: true,
                      focused: true,
                      bottom: 0,
                      height: 3,
                      valign: "middle",
                      align: "center",
                      style: { bg: "#ffaa00", fg: "#333333", hover: { bg: "#ffdd88", fg: "#333333" } },
                      onClick: () => {
                        setPickFolder(true);
                      },
                      content: "workspace"
                    }
                  )
                }
              )
            },
            2
          )
        ] }) }),
        /* @__PURE__ */ jsxRuntime_js.jsx(Tab, { name: "Git", children: /* @__PURE__ */ jsxRuntime_js.jsx(GitComponent, { rootDir, row: 0, col: 1, rowSpan: 1, colSpan: 5 }) }),
        /* @__PURE__ */ jsxRuntime_js.jsx(Tab, { name: "Debug", children: /* @__PURE__ */ jsxRuntime_js.jsx("box", { children: debugView() }) }),
        /* @__PURE__ */ jsxRuntime_js.jsx(Tab, { name: "Quit", onTabClick: () => {
          process.exit(0);
        }, children: /* @__PURE__ */ jsxRuntime_js.jsx("box", { onTabClick: () => {
          process.exit(0);
        }, children: debugView() }) })
      ] }),
      /* @__PURE__ */ jsxRuntime_js.jsx(
        CodeBufferEditorComponent,
        {
          row: 0,
          col: 5,
          rowSpan: 6,
          colSpan: 10,
          border: { type: "line" },
          label: (selectedFile || "No file selected").replace(rootDir, ""),
          filePath: selectedFile || null,
          onKeypress: onCodeEditKeyPress,
          onChange: onCurrentEditorChange
        }
      ),
      /* @__PURE__ */ jsxRuntime_js.jsx(
        "box",
        {
          row: 6,
          col: 5,
          rowSpan: 2,
          colSpan: 10,
          border: { type: "line" },
          scrollable: true,
          clickable: true,
          mouse: true,
          keys: true,
          label: "Terminal",
          overflow: "scroll",
          children: currentEditorText
        }
      )
    ] }),
    message && /* @__PURE__ */ jsxRuntime_js.jsx(
      ModalDialog,
      {
        label: "Message",
        title: "Message",
        onClose: () => setMessage(false),
        children: /* @__PURE__ */ jsxRuntime_js.jsx("text", { children: message })
      }
    ),
    pickFolder && /* @__PURE__ */ jsxRuntime_js.jsx(
      reactErrorBoundary.ErrorBoundary,
      {
        FallbackComponent: ErrorFallback,
        onReset: () => {
          setPickFolder(false);
        },
        onClose: () => setPickFolder(false),
        children: /* @__PURE__ */ jsxRuntime_js.jsx(
          FolderPickerDialog,
          {
            title: "Pick Folder",
            onFolderSelect: (inode) => {
              setPickFolder(false);
              if (inode) {
                setMessage(`selected folder ${inode.fullPath}`);
                setRootDir(inode.fullPath);
              }
            }
          }
        )
      }
    )
  ] });
}
const screen = blessed.screen({
  smartCSR: true,
  autoPadding: true,
  title: "React-Blessed IDE",
  dump: "terminal-dump.log"
});
screen.key(["C-q", "f12"], () => process.exit(0));
screen.key(["C-s", "C-S-s", "f8"], () => {
  const dump = screen.screenshot();
  fs.writeFileSync("buffer.sgr", dump, "utf8");
  console.log("Wrote SGR dump to buffer.sgr");
});
screen.enableMouse();
reactBlessed.render(/* @__PURE__ */ jsxRuntime_js.jsx(App, {}), screen);
