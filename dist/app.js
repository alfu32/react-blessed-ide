#!/usr/bin/env node
"use strict";
const jsxRuntime_js = require("react/jsx-runtime.js");
require("raf/polyfill.js");
const blessed = require("neo-blessed");
const reactBlessed = require("react-blessed");
const React = require("react");
const ignore = require("ignore");
const reactBlessedContrib17 = require("react-blessed-contrib-17");
const fs = require("fs");
const path = require("path");
const copyPaste = require("copy-paste");
require("vite");
const reactErrorBoundary = require("react-error-boundary");
require("neo-blessed/lib/widgets/node.js");
require("neo-blessed/lib/widgets/element.js");
require("neo-blessed/lib/widgets/screen.js");
require("neo-blessed/lib/blessed.js");
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
class Rectangle {
  x = -1;
  y = -1;
  w = -1;
  h = -1;
  /**
   *
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   */
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }
  /**
   *
   * @param {CodeBufferEditor} editor
   */
  static fromEditor(editor2) {
    return new Rectangle(editor2.viewportX, editor2.viewportY, editor2.viewportWidth, editor2.viewportHeight);
  }
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
  lookup(tokens) {
    const lineOfTokens = tokens[this.y];
    const tk = lineOfTokens.match((tk2) => tk2.start <= this.x && this.x <= tk2.end);
    return tk;
  }
  /**
   *
   * @param {Rectangle} visibleArea
   * @returns boolean
   */
  isVisible(visibleArea) {
    return this.x >= visibleArea.x && this.x <= visibleArea.x + visibleArea.w && this.y >= visibleArea.y && this.y <= visibleArea.y + visibleArea.h;
  }
  copy() {
    const cp2 = new CursorPoint();
    cp2.x = this.x;
    cp2.y = this.y;
    cp2.char = this.char;
    cp2.style = { ...this.style };
    return cp2;
  }
}
class CodeBufferEditorSelection {
  start = new CursorPoint();
  end = new CursorPoint();
  /**
   *
   * @param {CursorPoint} start
   */
  constructor(start) {
    this.start = start.copy();
  }
  /**
   *
   * @param {Rectangle} visibleArea
   * @returns boolean
   */
  isVisible(visibleArea) {
    return this.start.isVisible(visibleArea) || this.end.isVisible(visibleArea);
  }
  /**
   *
   * @param {CursorPoint} val
   */
  setEnd(val) {
    this.end = val;
    return this;
  }
  copy() {
    const cp2 = new CodeBufferEditorSelection(this.start.copy());
    cp2.setEnd(this.end);
    return cp2;
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
    this.selectStart = null;
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
  scrollViewport(n) {
    let nextY = this.viewportY + n;
    let maxY = this.lines.length - 1;
    if (nextY < 0) {
      this.viewportY = 0;
    } else if (nextY + this.viewportHeight > maxY) {
      this.viewportY = maxY - this.viewportHeight;
    } else {
      this.viewportY = nextY;
    }
  }
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
    this.tokens = this.lines.map((line, lineNumber) => {
      return this.tokenizer(line, lineNumber);
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
    y = y < 0 ? 0 : y > this.lines.length - 1 ? this.lines.length - 1 : y;
    const line = this.lines[y];
    x = x < 0 ? 0 : x > line.length ? line.length : x;
    x = parseInt(x);
    y = parseInt(y);
    crs.x = x;
    crs.y = y;
    const tokens = [...this.tokens[y]];
    if (tokens.length === 0 || x === line.length) {
      crs.char = " ";
      crs.style = { fg: "#ff0000", bg: "#ffff44" };
      return crs;
    }
    crs.char = this.lines[y][x];
    const tkLookup = tokens.filter((t) => x >= parseInt(t.start) && x <= parseInt(t.end));
    if (tkLookup.length === 0) {
      crs.style = { fg: "#ff0000", bg: "#ffff44" };
      throw new Error(safeStringify({ msg: "no token", x, y, tkLookup, tokens }));
    } else {
      try {
        crs.style = tkLookup[0].style;
      } catch (e) {
        throw new Error(safeStringify({ msg: "no token style", x, y, tkLookup, tokens }));
      }
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
    let hasChanged = false;
    let mustRender = false;
    const clicks = Array.from(screenEvent.buf || []).filter((v) => v === 77).length;
    switch (screenEvent.action) {
      case "mousedown":
        {
          const padLength = Math.ceil(Math.log10(this.viewportHeight + this.viewportY)) + 1;
          const { xi, yi } = viewportPosition;
          const { x, y } = screenEvent;
          const cursor = { x: x - xi - padLength - 1 - 1 - 1 + this.viewportX, y: y - yi - 1 + this.viewportY };
          const crs = this.getCursor(cursor);
          this.selectStart = new CodeBufferEditorSelection(crs);
          this.selectStart.setEnd(crs);
          if (screenEvent.meta) {
            this.cursors.push(crs);
          } else {
            this.cursors = [crs];
          }
          hasChanged = true;
        }
        break;
      case "mousemove":
        {
          const padLength = Math.ceil(Math.log10(this.viewportHeight + this.viewportY)) + 1;
          const { xi, yi } = viewportPosition;
          const { x, y } = screenEvent;
          const cursor = { x: x - xi - padLength - 1 - 1 - 1 + this.viewportX, y: y - yi - 1 + this.viewportY };
          const crs = this.getCursor(cursor);
          if (this.selectStart) {
            this.selectStart.setEnd(crs);
          }
          mustRender = true;
        }
        break;
      case "mouseup":
        {
          if (this.selectStart) {
            if (screenEvent.meta) {
              this.selections.push(this.selectStart.copy());
            } else {
              this.selections = [this.selectStart.copy()];
            }
          }
          hasChanged = true;
          this.selectStart = null;
        }
        break;
      case "wheelup":
        this.scrollViewport(-clicks);
        mustRender = true;
        break;
      case "wheeldown":
        this.scrollViewport(clicks);
        mustRender = true;
        break;
      default:
        throw new Error(safeStringify(screenEvent));
    }
    return [hasChanged, mustRender];
  }
  onKey(ch, key, onChange = () => {
  }) {
    const THIS = this;
    let hasChanged = false;
    let mustRender = false;
    switch (key.full) {
      case "up":
        this.cursors = this.cursors.map((crs) => THIS.moveCursorUp(crs));
        mustRender = true;
        break;
      case "down":
        this.cursors = this.cursors.map((crs) => THIS.moveCursorDown(crs));
        mustRender = true;
        break;
      case "left":
        if (key.ctrl) {
          this.cursors = this.cursors.map((crs) => {
            const line = this.lines[crs.y];
            if (crs.x - 1 > 0 && line[crs.x - 1] === " ") {
              crs.x -= 2;
              return crs;
            }
            while (crs.x >= 0) {
              if (line[crs.x] === " " || crs.x === 0) {
                crs.x += crs.x === 0 ? 0 : 1;
                break;
              }
              crs.x -= 1;
            }
            return crs;
          });
        } else {
          this.cursors = this.cursors.map((crs) => THIS.moveCursorLeft(crs));
        }
        mustRender = true;
        break;
      case "right":
        if (key.ctrl) {
          this.cursors = this.cursors.map((crs) => {
            const line = this.lines[crs.y];
            if (crs.x + 1 < line.length && line[crs.x + 1] === " ") {
              crs.x += 2;
              return crs;
            }
            while (crs.x < line.length) {
              if (line[crs.x] === " ") {
                crs.x -= 1;
                break;
              }
              crs.x += 1;
            }
            return crs;
          });
        } else {
          this.cursors = this.cursors.map((crs) => THIS.moveCursorRight(crs));
        }
        mustRender = true;
        break;
      case "home":
        this.cursors = this.cursors.map((crs) => THIS.getCursor({ x: 0, y: crs.y }));
        mustRender = true;
        break;
      case "end":
        this.cursors = this.cursors.map((crs) => THIS.getCursor({ x: this.lines[crs.y].length, y: crs.y }));
        mustRender = true;
        break;
      case "pageup":
        this.scrollViewport(-this.viewportHeight);
        mustRender = true;
        break;
      case "pagedown":
        this.scrollViewport(this.viewportHeight);
        mustRender = true;
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
      case "C-c":
        {
          copyPaste.copy(this.selections.flatMap((s) => {
            const lines = [];
            for (let y = s.start.y; y <= s.end.y; y++) {
              lines.push(this.lines[y].substring(s.start.x, s.end.x + 1));
            }
            return lines;
          }).join("\n"), (err, text) => {
          });
        }
        break;
      case "C-p": {
        throw new Error("paste operation not implemented");
      }
      default:
        if (ch && ch.length > 0) {
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
    return [hasChanged, mustRender];
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
    if (newLine.indexOf("\n") > -1) {
      this.updateTokens();
    } else {
      this.updateTokensLine(cursor.y);
    }
    cursor.x++;
    this._ensureCursorInView(cursor);
    return this;
  }
  delete(cursor) {
    if (cursor.x === this.lines[cursor.y].length) {
      let newLines = this.lines.slice(0, cursor.y);
      let currentLine = this.lines[cursor.y];
      const nextLine = this.lines[cursor.y + 1];
      let restLines = this.lines.slice(cursor.y + 2);
      this.lines = newLines.concat([currentLine + nextLine]).concat(restLines);
      this.updateTokens();
    } else {
      let newLines = this.lines.slice(0, cursor.y);
      const oldLine = this.lines[cursor.y];
      const before = oldLine.substring(0, cursor.x);
      const after = oldLine.substring(cursor.x + 1);
      const newLine = before + after;
      let oldLinesAfter = this.lines.slice(cursor.y + 1);
      this.lines = newLines.concat(newLine.split("\n")).concat(oldLinesAfter);
      this.updateTokensLine(cursor.y);
    }
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
    clone.selectStart = this.selectStart;
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
  onEvent = ({ editor: editor2, ch, key, screenEvent, viewport }) => {
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
  const renderCursors = () => {
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
  const renderSelections = () => {
    if (!editor2) {
      return [];
    }
    const padLength = Math.ceil(Math.log10(editor2.viewportHeight + editor2.viewportY)) + 1;
    const visibleArea = Rectangle.fromEditor(editor2);
    return [...editor2.selections].concat([editor2.selectStart]).filter((selection, y) => {
      return selection !== null && selection.isVisible(visibleArea);
    }).flatMap((s) => {
      const lines = [];
      for (let y = s.start.y; y <= s.end.y; y++) {
        lines.push({
          x: s.start.x - editor2.viewportX + padLength + 1 + 1,
          y: y - editor2.viewportY,
          style: s.start.style,
          content: editor2.lines[y].substring(s.start.x, s.end.x + 1)
        });
      }
      return lines;
    }).map((rs, id) => {
      return /* @__PURE__ */ jsxRuntime_js.jsx(
        "box",
        {
          left: rs.x,
          top: rs.y,
          width: rs.content.length,
          height: 1,
          style: { ...rs.style, underline: true, bold: true, inverse: true },
          tags: false,
          content: rs.content
        },
        `selection-${id}-${Date.now()}`
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
      const plainLineText = /* @__PURE__ */ jsxRuntime_js.jsx(
        "box",
        {
          left: padLength + 1 + 1,
          top: k,
          width: editor2.lines[lineNumber].length,
          height: 1,
          style: { bg: "#222222", fg: "#33aabb", inverse: editor2.cursors.map((c) => c.y).indexOf(lineNumber) > -1 },
          content: editor2.lines[lineNumber]
        },
        `code-${lineNumber}-${Date.now()}`
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
        lineNumberBox,
        plainLineText
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
    const [hasChanged, mustRender] = editor2.onKey(ch, key);
    if (hasChanged) {
      const newLastEvent = { ...lastEvent, editor: editor2, ch, key, viewport: boxRef.current.lpos };
      onChange(newLastEvent);
      setLastEvent(newLastEvent);
      setEditor2(editor2.copy());
    } else if (mustRender) {
      const newLastEvent = { ...lastEvent, editor: editor2, ch, key, viewport: boxRef.current.lpos };
      onEvent(newLastEvent);
      setLastEvent(newLastEvent);
      setEditor2(editor2.copy());
    }
  };
  const mouseAction = (screenEvent) => {
    if (!editor2) {
      return;
    }
    const [mustChange, mustRender] = editor2.onMouse(screenEvent, boxRef.current.lpos);
    if (mustChange) {
      const newLastEvent = { ...lastEvent, editor: editor2, screenEvent, viewport: boxRef.current.lpos };
      onChange(newLastEvent);
      setLastEvent(newLastEvent);
      setEditor2(editor2.copy());
    } else if (mustRender) {
      const newLastEvent = { ...lastEvent, editor: editor2, screenEvent, viewport: boxRef.current.lpos };
      onEvent(newLastEvent);
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
        renderCursors(),
        renderSelections()
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
async function gitTag(cwd, tag2) {
  const { stdout } = await exec(`git tag "${tag2}"`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
async function gitPush(cwd, remote, branch2) {
  const { stdout } = await exec(`git push "${remote}" "${branch2}" --tags`, { cwd });
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
    const tag2 = event.content.substring(9, 18).trim();
    const msg = event.content.substring(19);
    setCommitMessage(msg);
    if (tag2.length >= 5) {
      setGitCurrentTag(tag2);
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
          onChange: onCurrentEditorChange,
          onEvent: onCurrentEditorChange
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
const tag = "2.5.0";
const commit = "e069f96a7c8cb950c0f838a121c8896f29c05b3b";
const branch = "work";
const time = "2025-08-25 12:37:34";
const version = {
  tag,
  commit,
  branch,
  time
};
const screen = blessed.screen({
  smartCSR: true,
  autoPadding: true,
  title: `React-Blessed IDE ${version.tag} ${version.branch} ${version.commit} ${version.time}`,
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlcyI6WyIuLi9zcmMvV29ya3NwYWNlLmpzIiwiLi4vc3JjL01vZGFsRGlhbG9nLmpzeCIsIi4uL3NyYy91dGlsLmpzIiwiLi4vc3JjL3Rva2VuaXplci5qcyIsIi4uL3NyYy9TaW1wbGVUZXh0RWRpdG9yLmpzIiwiLi4vc3JjL0xpc3RDb21wb25lbnQuanN4IiwiLi4vc3JjL0ZpbGVUcmVlLmpzeCIsIi4uL3NyYy9Gb2xkZXJQaWNrZXJEaWFsb2cuanN4IiwiLi4vc3JjL1ZUYWJzLmpzeCIsIi4uL3NyYy9Db2RlQnVmZmVyRWRpdG9yLmpzIiwiLi4vc3JjL0NvZGVCdWZmZXJFZGl0b3IuanN4IiwiLi4vc3JjL0dpdENvbXBvbmVudC5zZXJ2aWNlLmpzIiwiLi4vc3JjL1NpbXBsZVRleHRFZGl0b3IuanN4IiwiLi4vc3JjL1NlbXZlci5qcyIsIi4uL3NyYy9TZW12ZXIuanN4IiwiLi4vc3JjL0dpdENvbXBvbmVudC5qc3giLCIuLi9zcmMvRXJyb3JGYWxsYmFjay5qc3giLCIuLi9zcmMvQXBwLmpzeCIsIi4uL2luZGV4LmpzeCJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBzZXJ2aWNlcy9Xb3Jrc3BhY2UuanNcblxuaW1wb3J0IHsgcHJvbWlzZXMgYXMgZnMgfSBmcm9tICdmcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBpZ25vcmUgZnJvbSAnaWdub3JlJztcblxuY29uc3QgaW5vZGVTb3J0Qnk9KG5vZGUpPT4ge1xuICBjb25zdCBtYXBwaW5nPXtcbiAgICAnZCc6MSwvLyBEaXJlY3RvcnlcbiAgICAnZic6MiwvLyBGaWxlXG4gICAgJ2wnOjIsLy8gU3ltYm9saWNMaW5rXG4gICAgJ2InOjIsLy8gQmxvY2tEZXZpY2VcbiAgICAnYyc6MiwvLyBDaGFyYWN0ZXJEZXZpY2VcbiAgICAncCc6MiwvLyBGSUZPXG4gICAgJ3MnOjIsLy8gU29ja2V0XG4gIH1cbiAgY29uc3QgbnQ9bm9kZS50eXBlLnJlcGxhY2UoLy0vZ2ksJycpXG4gIHJldHVybiBgJHtub2RlLnBhcmVudEZ1bGxOYW1lKCkuc3BsaXQoJy8nKS5tYXAobm4gPT4gYDF8JHtubn1gKS5qb2luKFwiL1wiKX0vJHttYXBwaW5nW250XX18JHtub2RlLm5hbWV9YFxufVxuY29uc3QgY29tcGFyZUlub2Rlcz0obmEsbmIpID0+IHtcbiAgY29uc3Qgc2EgPSBpbm9kZVNvcnRCeShuYSlcbiAgY29uc3Qgc2I9aW5vZGVTb3J0QnkobmIpXG4gIHJldHVybiBzYTxzYj8tMTooc2E9PT1zYik/MDoxXG59XG5cbmV4cG9ydCBjbGFzcyBJTm9kZXtcbiAgaWQ9MCAgICAgICAgLy8vIChmaWxlIHN0YXQgaW5vKVxuICB0eXBlPScnICAgICAgLy8vICAoIG9uZSBvZiAnZCcsJ2YnLCdsJywncCcsJ2MnLCdwJywncycpXG4gIG5hbWU9XCJcIiAgICAgIC8vLyAgZmlsZSBuYW1lXG4gIGZ1bGxQYXRoPVwiXCIgIC8vLyBcbiAgcmVsUGF0aD1cIlwiICAvLy8gXG4gIGlzT3Blbj1mYWxzZSAgICAvLy8gKGRlZmF1bHQgZmFsc2UpXG4gIGNoaWxkcmVuPVtdICAvLy8gW11JTm9kZVxuICBlbnRyaWVzPVtdICAvLy8gW11JTm9kZVxuXG4gIGFzeW5jIHJlYWRGaWxlKCkge1xuICAgIHJldHVybiBmcy5yZWFkRmlsZSh0aGlzLmZ1bGxQYXRoLCAndXRmOCcpO1xuICB9XG4gIGRlcHRoKCl7XG4gICAgcmV0dXJuIHRoaXMuZnVsbFBhdGguc3BsaXQoXCIvXCIpLmxlbmd0aFxuICB9XG4gIHBhcmVudEZ1bGxOYW1lKCl7XG4gICAgcmV0dXJuIHRoaXMuZnVsbFBhdGgucmVwbGFjZShgLyR7dGhpcy5uYW1lfWAsJycpXG4gIH1cbiAgdG9UZXh0KCl7XG5cbiAgICBjb25zdCBudD10aGlzLnR5cGUucmVwbGFjZSgvLS9naSwnJylcbiAgICBjb25zdCBtYXJrZXIgPSB0aGlzLnR5cGUuaW5kZXhPZignZCcpPi0xXG4gICAgICA/ICh0aGlzLmlzT3BlbiA/ICcgWy1dJyA6ICcgWytdJylcbiAgICAvLyAgOiBgIFske250fV1gO1xuICAgICAgOiBgYDtcbiAgICByZXR1cm4gYCR7JyAnLnJlcGVhdCh0aGlzLmRlcHRoKCkqMil9JHttYXJrZXJ9ICR7dGhpcy5uYW1lfWBcbiAgfVxuICB0b1RleHQyKCl7XG4gICAgcmV0dXJuIGlub2RlU29ydEJ5KHRoaXMpXG4gIH1cblxuICAvKipcbiAgICpcbiAgICogQHJldHVybnMge0lOb2RlW119XG4gICAqL1xuICBmbGF0dGVuICgpe1xuICAgIGxldCBvdXQgPVtdXG4gICAgb3V0LnB1c2godGhpcyk7XG4gICAgaWYgKHRoaXMuaXNPcGVuKSB7XG4gICAgICBjb25zdCBvID0gdGhpcy5jaGlsZHJlbi5mbGF0TWFwKGNoaWxkID0+IGNoaWxkLmZsYXR0ZW4oKSk7XG4gICAgICBvLmZvckVhY2gobiA9PiBvdXQucHVzaChuKSlcbiAgICB9XG4gICAgcmV0dXJuIG91dDtcbiAgfVxuICBcbiAgLyoqXG4gICAqIFxuICAgKiBAcGFyYW0ge3N0cmluZ30gcm9vdERpciBcbiAgICogQHBhcmFtIHtzdHJpbmd9IGN1cnJlbnRQYXRoIFxuICAgKiBAcGFyYW0ge2lnbm9yZWRQYXRoc30gaWcgXG4gICAqIEByZXR1cm5zIHtJTm9kZX0gc2VsZlxuICAgKi9cbiAgYXN5bmMgaW5pdChyb290RGlyLCBpZywgY3VycmVudFBhdGgpe1xuICAgIHRoaXMuZnVsbFBhdGg9Y3VycmVudFBhdGhcbiAgICBsZXQgc3RhdCA9IGF3YWl0IGZzLnN0YXQodGhpcy5mdWxsUGF0aCk7XG4gICAgdGhpcy5pZD1zdGF0Lmlub1xuICAgIHRoaXMudHlwZT1bXG4gICAgICBzdGF0LmlzRGlyZWN0b3J5KCk/J2QnOictJyxcbiAgICAgIHN0YXQuaXNGaWxlKCk/J2YnOictJyxcbiAgICAgIHN0YXQuaXNTeW1ib2xpY0xpbmsoKT8nbCc6Jy0nLFxuICAgICAgc3RhdC5pc0Jsb2NrRGV2aWNlKCk/J2InOictJyxcbiAgICAgIHN0YXQuaXNDaGFyYWN0ZXJEZXZpY2UoKT8nYyc6Jy0nLFxuICAgICAgc3RhdC5pc0ZJRk8oKT8ncCc6Jy0nLFxuICAgICAgc3RhdC5pc1NvY2tldCgpPydzJzonLScsXG4gICAgXS5qb2luKFwiXCIpXG4gICAgdGhpcy5uYW1lID0gcGF0aC5iYXNlbmFtZSh0aGlzLmZ1bGxQYXRoKTtcbiAgICB0aGlzLnJlbFBhdGggPSBwYXRoLnJlbGF0aXZlKHJvb3REaXIsIHRoaXMuZnVsbFBhdGgpO1xuICAgIHRoaXMuaXNPcGVuPWZhbHNlXG4gICAgdGhpcy5jaGlsZHJlbj1bXVxuICAgIGlmKHRoaXMudHlwZS5pbmRleE9mKCdkJyk+LTEpe1xuICAgICAgdHJ5e1xuICAgICAgICB0aGlzLmVudHJpZXMgPSBhd2FpdCBmcy5yZWFkZGlyKHRoaXMuZnVsbFBhdGgpXG4gICAgICB9Y2F0Y2goZXJyKXtcbiAgICAgICAgdGhpcy5lbnRyaWVzPVtdXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZW50cmllcz1bXVxuICAgIH1cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSByb290RGlyXG4gICAqIEBwYXJhbSBpZ1xuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJTm9kZT59XG4gICAqL1xuICBhc3luYyBvcGVuKHJvb3REaXIsaWcpe1xuICAgIHRoaXMuaXNPcGVuPXRydWU7XG4gICAgdGhpcy5jaGlsZHJlbj0oYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIHRoaXMuZW50cmllcy5tYXAoZW50cnkgPT4ge1xuICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgIGNvbnN0IGlub2RlMSA9IG5ldyBJTm9kZSgpXG4gICAgICAgICAgICBpbm9kZTEuZnVsbFBhdGggPSBwYXRoLmpvaW4odGhpcy5mdWxsUGF0aCwgZW50cnkpXG4gICAgICAgICAgICByZXR1cm4gaW5vZGUxLmluaXQocm9vdERpciwgaWcsIGlub2RlMS5mdWxsUGF0aClcbiAgICAgICAgICB9Y2F0Y2goZXJyKXtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobnVsbClcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgKSkuZmlsdGVyKGsgPT4gayAhPT0gbnVsbClcbiAgICB0aGlzLmNoaWxkcmVuLnNvcnQoY29tcGFyZUlub2RlcylcbiAgICByZXR1cm4gdGhpc1xuICB9XG4gIGFzeW5jIGNsb3NlKHJvb3REaXIsaWcpe1xuICAgIHRoaXMuaXNPcGVuPWZhbHNlO1xuICAgIHRoaXMuY2hpbGRyZW49W11cbiAgfVxuICAvKipcbiAgICogXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjdXJyZW50UGF0aCBcbiAgICogQHBhcmFtIHtzdHJpbmd9IHJvb3REaXIgXG4gICAqIEBwYXJhbSB7aWdub3JlZFBhdGhzfSBpZyBcbiAgICogQHJldHVybnMge0lOb2RlfSBzZWxmXG4gICAqL1xuICBhc3luYyByZWZyZXNoKHJvb3REaXIsaWcpe1xuXG4gICAgdGhpcy5uYW1lID0gcGF0aC5iYXNlbmFtZSh0aGlzLmZ1bGxQYXRoKTtcbiAgICB0aGlzLnJlbFBhdGggPSBwYXRoLnJlbGF0aXZlKHJvb3REaXIsIHRoaXMuZnVsbFBhdGgpO1xuXG4gICAgLy8gc2tpcCBhbnl0aGluZyB0aGUgLmdpdGlnbm9yZSBzYXlzIHRvIGlnbm9yZVxuICAgIGlmICh0aGlzLnJlbFBhdGggJiYgKGlnLmlnbm9yZXModGhpcy5yZWxQYXRoKSB8fCB0aGlzLm5hbWUgPT09IFwiLmdpdFwiKSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIC8vIGxldCBpbm9kZSA9bmV3IElOb2RlKClcbiAgICAvLyBhd2FpdCB0aGlzLmluaXQocm9vdERpciwgaWcsIHRoaXMuZnVsbFBhdGgpXG5cbiAgICBpZiAodGhpcy50eXBlLmluZGV4T2YoJ2QnKT4tMSkge1xuICAgICAgY29uc3QgZW50cmllcyA9IGF3YWl0IGZzLnJlYWRkaXIodGhpcy5mdWxsUGF0aCk7XG4gICAgICB0aGlzLmVudHJpZXM9ZW50cmllc1xuICAgICAgbGV0IGNoaWxkcmVuID0gKGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICBlbnRyaWVzLm1hcChlbnRyeSA9PiB7XG4gICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgY29uc3QgaW5vZGUxID0gbmV3IElOb2RlKClcbiAgICAgICAgICAgIGlub2RlMS5mdWxsUGF0aCA9IHBhdGguam9pbih0aGlzLmZ1bGxQYXRoLCBlbnRyeSlcbiAgICAgICAgICAgIGlub2RlMS5pbml0KHJvb3REaXIsIGlnLCB0aGlzLmZ1bGxQYXRoKVxuICAgICAgICAgICAgcmV0dXJuIGlub2RlMS5yZWZyZXNoKHJvb3REaXIsIGlnKVxuICAgICAgICAgIH1jYXRjaCAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShudWxsKVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICkpLmZpbHRlciggayA9PiBrIT09bnVsbClcbiAgICAgIGNoaWxkcmVuPWNoaWxkcmVuLmZpbHRlcih4ID0+IHghPT0gbnVsbClcbiAgICAgICAgLnNvcnQoY29tcGFyZUlub2RlcylcbiAgICAgIHRoaXMuY2hpbGRyZW49Y2hpbGRyZW5cbiAgICB9XG4gICAgcmV0dXJuIHRoaXNcblxuICB9XG59XG5cblxuXG5leHBvcnQgY2xhc3MgV29ya3NwYWNle1xuICByb290RGlyPVwiXCJcbiAgcm9vdE5vZGU9bmV3IElOb2RlKClcbiAgbm9kZUZpbHRlcj0oaW5vZGUsaW5kZXgsbm9kZXMscGFyZW50KT0+e3JldHVybiB0cnVlfVxuICBjb25zdHJ1Y3Rvcihub2RlRmlsdGVyPShpbm9kZSxpbmRleCxub2RlcyxwYXJlbnQpPT57fSl7XG4gICAgdGhpcy5ub2RlRmlsdGVyPW5vZGVGaWx0ZXI7XG4gIH1cbiAgYXN5bmMgbG9hZElnbm9yZSgpIHtcbiAgICBjb25zdCBpZyA9IGlnbm9yZSgpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBnaXRpZ25vcmUgPSBhd2FpdCBmcy5yZWFkRmlsZShwYXRoLmpvaW4odGhpcy5yb290RGlyLCAnLmdpdGlnbm9yZScpLCAndXRmOCcpO1xuICAgICAgaWcuYWRkKGdpdGlnbm9yZS5zcGxpdCgvXFxyP1xcbi8pKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAvLyBubyAuZ2l0aWdub3JlIOKAlCBub3RoaW5nIHRvIGlnbm9yZVxuICAgIH1cbiAgICByZXR1cm4gaWc7XG4gIH1cbiAgLyoqXG4gICAqIFxuICAgKiBAcGFyYW0ge3N0cmluZ30gcm9vdERpciBcbiAgICogQHJldHVybnMge1dvcmtzcGFjZX1cbiAgICovXG4gIGFzeW5jIGluaXQocm9vdERpcikge1xuICAgIHRoaXMuaWcgPSBhd2FpdCB0aGlzLmxvYWRJZ25vcmUoKTtcbiAgICB0aGlzLnJvb3REaXI9cm9vdERpclxuICAgIHRoaXMucm9vdE5vZGUuZnVsbFBhdGggPSByb290RGlyXG4gICAgYXdhaXQgdGhpcy5yb290Tm9kZS5pbml0KHRoaXMucm9vdERpcix0aGlzLmlnLHRoaXMucm9vdERpcilcbiAgICBhd2FpdCB0aGlzLnJvb3ROb2RlLnJlZnJlc2godGhpcy5yb290RGlyLHRoaXMuaWcpXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuICBhc3luYyByZWZyZXNoKCl7XG4gICAgYXdhaXQgdGhpcy5yb290Tm9kZS5yZWZyZXNoKHRoaXMucm9vdERpcix0aGlzLmlnKVxuICB9XG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0ge0lOb2RlfSBub2RlXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFdvcmtzcGFjZT59XG4gICAqL1xuICBhc3luYyBvcGVuKG5vZGUpe1xuICAgIG5vZGUuaXNPcGVuPXRydWU7XG4gICAgbm9kZS5jaGlsZHJlbj1hd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgbm9kZS5lbnRyaWVzLm1hcChlbnRyeSA9PiB7XG4gICAgICAgICAgY29uc3QgaW5vZGUxID1uZXcgSU5vZGUoKVxuICAgICAgICAgIGlub2RlMS5mdWxsUGF0aD1wYXRoLmpvaW4obm9kZS5mdWxsUGF0aCwgZW50cnkpXG4gICAgICAgICAgcmV0dXJuIGlub2RlMS5pbml0KHRoaXMucm9vdERpciwgdGhpcy5pZywgaW5vZGUxLmZ1bGxQYXRoKVxuICAgICAgICB9KVxuICAgIClcbiAgICBub2RlLmNoaWxkcmVuPW5vZGUuY2hpbGRyZW4uZmlsdGVyKCh2LGksYSk9PiB7XG4gICAgICByZXR1cm4gdGhpcy5ub2RlRmlsdGVyKHYsaSxhLG5vZGUpXG4gICAgfSlcbiAgICByZXR1cm4gdGhpc1xuICB9XG4gIGZsYXR0ZW4oKXtcblxuICAgIC8vIHRocm93IEpTT04uc3RyaW5naWZ5KHdrLG51bGwsJyAnKVxuICAgIGxldCBmbWFwID0gdGhpcy5yb290Tm9kZS5mbGF0dGVuKClcbiAgICBmbWFwLnNvcnQoY29tcGFyZUlub2RlcylcbiAgICByZXR1cm4gZm1hcFxuICB9XG4gIC8vIGJ1aWxkIGEgZmxhdCBsaXN0IG9mIHZpc2libGUgbm9kZXNcbiAgLyoqXG4gICAqXG4gICAqIEByZXR1cm5zIHtXb3Jrc3BhY2V9XG4gICAqL1xuICBjb3B5KCl7XG4gICAgbGV0IHdrcyA9IG5ldyBXb3Jrc3BhY2UoKVxuICAgIHdrcy5yb290RGlyPXRoaXMucm9vdERpclxuICAgIHdrcy5yb290Tm9kZT10aGlzLnJvb3ROb2RlXG4gICAgd2tzLmlnPXRoaXMuaWdcbiAgICB3a3Mubm9kZUZpbHRlcj10aGlzLm5vZGVGaWx0ZXJcbiAgICByZXR1cm4gd2tzXG4gIH1cbn1cblxuIiwiLy8gY29tcG9uZW50cy9Nb2RhbERpYWxvZy5qc1xuaW1wb3J0IFJlYWN0LCB7IHVzZUVmZmVjdCwgdXNlUmVmIH0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHsgQm94RWxlbWVudCBhcyBib3gsIFRleHRFbGVtZW50IGFzIHRleHQgfSBmcm9tICdyZWFjdC1ibGVzc2VkJztcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gTW9kYWxEaWFsb2coe1xuICAgIHRpdGxlID0gJ0RpYWxvZycsXG4gICAgd2lkdGggPSAnNTAlJyxcbiAgICBoZWlnaHQgPSAnNTAlJyxcbiAgICBvbkNsb3NlLFxuICAgIGNoaWxkcmVuXG59KSB7XG4gICAgY29uc3QgYm94UmVmID0gdXNlUmVmKCk7XG5cbiAgICAvLyBmb2N1cyB0aGUgbW9kYWwgc28gaXQgY2FuIGNhdGNoIGtleXByZXNzZXNcbiAgICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgICAgICBjb25zdCBub2RlID0gYm94UmVmLmN1cnJlbnQ7XG4gICAgICAgIGlmIChub2RlKSBub2RlLmZvY3VzKCk7XG4gICAgfSwgW10pO1xuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveFxuICAgICAgICAgICAgcmVmPXtib3hSZWZ9XG4gICAgICAgICAgICB0b3A9XCJjZW50ZXJcIlxuICAgICAgICAgICAgbGVmdD1cImNlbnRlclwiXG4gICAgICAgICAgICB3aWR0aD17d2lkdGh9XG4gICAgICAgICAgICBoZWlnaHQ9e2hlaWdodH1cbiAgICAgICAgICAgIGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX1cbiAgICAgICAgICAgIHN0eWxlPXt7IGJnOiAnYmxhY2snLCBmZzogJ3doaXRlJyB9fVxuICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgLy8gY2xvc2Ugb24gRVNDXG4gICAgICAgICAgICBvbktleT17KGNoLCBrZXkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoa2V5Lm5hbWUgPT09ICdlc2NhcGUnKSBvbkNsb3NlKCk7XG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICB7LyogSGVhZGVyIHdpdGggdGl0bGUgYW5kIGNsb3NlIGJ1dHRvbiAqL31cbiAgICAgICAgICAgIDxib3ggaGVpZ2h0PXsxfSB3aWR0aD1cIjEwMCVcIiBzdHlsZT17eyBmZzogJ2dyZWVuJyB9fT5cbiAgICAgICAgICAgICAgICA8dGV4dCBib2xkPntgICR7dGl0bGV9YH0gPC90ZXh0PlxuICAgICAgICAgICAgICAgIDx0ZXh0XG4gICAgICAgICAgICAgICAgICAgIHJpZ2h0PXswfVxuICAgICAgICAgICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICAgICAgdW5kZXJsaW5lXG4gICAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9e29uQ2xvc2V9XG4gICAgICAgICAgICAgICAgPlvDl108L3RleHQ+XG4gICAgICAgICAgICA8L2JveD5cblxuICAgICAgICAgICAgey8qIENvbnRlbnQgYXJlYSAqL31cbiAgICAgICAgICAgIDxib3ggdG9wPXsyfSBsZWZ0PXsxfSByaWdodD17MX0gYm90dG9tPXsxfSBzY3JvbGxhYmxlIGtleXMgbW91c2UgYWx3YXlzU2Nyb2xsPlxuICAgICAgICAgICAgICAgIHtjaGlsZHJlbn1cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L2JveD5cbiAgICApO1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIHNhZmVTdHJpbmdpZnkob2JqLHNwYWNlPXVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgV2Vha1NldCgpO1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShvYmosIChrZXksIHZhbHVlKSA9PiB7XG4gICAgICAgIHN3aXRjaChrZXkpe1xuICAgICAgICAgICAgLy8gY2FzZSBcImNvbnRlbnRcIjogcmV0dXJuIFwiW2NvbnRlbnRdXCJcbiAgICAgICAgICAgIGNhc2UgXCJzY3JlZW5cIjogcmV0dXJuIFwiW3NjcmVlbl1cIlxuICAgICAgICAgICAgY2FzZSBcInBhcmVudFwiOiByZXR1cm4gXCJbcGFyZW50XVwiXG4gICAgICAgICAgICBjYXNlIFwibGluZXNcIjogcmV0dXJuIFwiW2xpbmVzXVwiXG4gICAgICAgICAgICBjYXNlIFwiY2hpbGRyZW5cIjogcmV0dXJuIFwiW2NoaWxkcmVuXVwiXG4gICAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChzZWVuLmhhcyh2YWx1ZSkpIHtcbiAgICAgICAgICByZXR1cm47ICAgICAgICAgICAgLy8gRHVwbGljYXRlL2NpcmN1bGFyIHJlZmVyZW5jZSDihpIgb21pdFxuICAgICAgICB9XG4gICAgICAgIHNlZW4uYWRkKHZhbHVlKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9LHNwYWNlKTtcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBpbnNlcnRBdChkZXN0aW5hdGlvbixpbmRleCxzb3VyY2Upe1xuICAgIGxldCBmaXJzdCA9IGRlc3RpbmF0aW9uLnN1YnN0cmluZygwLGluZGV4KTtcblxuICAgIGxldCBsYXN0ID0gZGVzdGluYXRpb24uc3Vic3RyaW5nKGluZGV4K3NvdXJjZS5sZW5ndGgpO1xuICAgIHJldHVybiAoZmlyc3Qrc291cmNlK2xhc3QpLnN1YnN0cmluZygwLGRlc3RpbmF0aW9uLmxlbmd0aClcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBkZWJvdW5jZWQoZm4sZGVsYXk9NTApe1xuICAgIGxldCB0bz0wXG4gICAgcmV0dXJuIGZ1bmN0aW9uKC4uLmFyZ3Mpe1xuICAgICAgICBjbGVhclRpbWVvdXQodG8pXG4gICAgICAgIHRvPXNldFRpbWVvdXQoKCk9PntcbiAgICAgICAgICAgIGZuKC4uLmFyZ3MpXG4gICAgICAgIH0sZGVsYXkpXG4gICAgfVxuICB9IiwiXG5cblxuLyoqXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxpbmVcbiAqIEByZXR1cm4geyBUb2tlbml6ZXJUb2tlbltdIH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGhpZ2hsaWdodChsaW5lKSB7XG4gICAgY29uc3QgdG9rZW5pemVyPWdldE5hbWVkVG9rZW5pemVyKCdqc3gnKVxuICAgIHJldHVybiB0b2tlbml6ZXIobGluZSlcbiAgfVxuZXhwb3J0IGNsYXNzIFRva2VuaXplck1hdGNoZXJEZWZ7XG4gICAgc3R5bGUgPSB7fVxuICAgIHBhdHRlcm4gPSAnJ1xufVxuZXhwb3J0IGNsYXNzIFRva2VuaXplckRlZntcbiAgICBuYW1lID0gJyc7XG4gICAgZmxhZ3M9J21naSdcbiAgICAvKipcbiAgICAgKlxuICAgICAqIEB0eXBlIHt7W25hbWU6c3RyaW5nXTpUb2tlbml6ZXJEZWZ9fVxuICAgICAqL1xuICAgIGRlZmluaXRpb25zID0ge31cbn1cbmV4cG9ydCBjbGFzcyBUb2tlbml6ZXJUb2tlbntcbiAgICB0b2tlbml6ZXJOYW1lPScnXG4gICAgdHlwZT0nJ1xuICAgIHN0eWxlPXt9XG4gICAgc3RhcnQ9MFxuICAgIGVuZD0wXG4gICAgeT0wXG4gICAgeD0wXG4gICAgdGV4dD0nJ1xuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1JlZ0V4cEV4ZWNBcnJheX0gbVxuICAgICAqIEBwYXJhbSB0b2tlbml6ZXJEZWZcbiAgICAgKiBAcmV0dXJuIHt7bmFtZTogdm9pZCB8IHN0cmluZywgdGV4dDogKiwgdHlwZTogc3RyaW5nLCBzdHlsZSwgc3RhcnQsIGVuZDogKn19XG4gICAgICovXG4gICAgc3RhdGljIGZyb21SZWdleHBNYXRjaChtLHRva2VuaXplckRlZix0b2tlbml6ZXJOYW1lLGxpbmVOdW1iZXIpe1xuICAgICAgICBjb25zdCBncm91cHMgPSBtLmdyb3VwcztcbiAgICAgICAgY29uc3QgdHlwZSA9IE9iamVjdC5rZXlzKGdyb3VwcykuZmluZChrZXkgPT4gZ3JvdXBzW2tleV0gIT09IHVuZGVmaW5lZCk7XG4gICAgICAgIGNvbnN0IHRva2VuRGVmID0gdG9rZW5pemVyRGVmLmRlZmluaXRpb25zW3R5cGVdXG4gICAgICAgIGNvbnN0IHR0ID0gbmV3IFRva2VuaXplclRva2VuKClcbiAgICAgICAgdHQudG9rZW5pemVyTmFtZT10b2tlbml6ZXJOYW1lXG4gICAgICAgIHR0LnRleHQ9IG1bMF1cbiAgICAgICAgdHQudHlwZT10eXBlXG4gICAgICAgIHR0LnN0eWxlPXRva2VuRGVmLnN0eWxlXG4gICAgICAgIHR0LnN0YXJ0PW0uaW5kZXhcbiAgICAgICAgdHQuZW5kPW0uaW5kZXgrbVswXS5sZW5ndGhcbiAgICAgICAgdHQueT1saW5lTnVtYmVyXG4gICAgICAgIHR0Lng9dHQuc3RhcnRcbiAgICAgICAgcmV0dXJuIHR0XG4gICAgfVxufVxuLyoqXG4gKiBAY29uc3RcbiAqIEB0eXBlIHtNYXA8c3RyaW5nLFRva2VuaXplck1hdGNoZXJEZWY+fX0gbmFtZWRUb2tlbml6ZXJzXG4gKi9cbmV4cG9ydCBjb25zdCBuYW1lZFRva2VuaXplcnM9e1xuICAgIGFueTp7bmFtZTonYW55JyxkZWZpbml0aW9uczp7XG4gICAgICAgIE51bWJlcjogICAgICAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1xcZCsoPzpcXC5cXGQrKT8vbWlnfSxcbiAgICAgICAgSWRlbnRpZmllcjogICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9bQS1aYS16X11cXHcqL21pZ30sXG4gICAgICAgIFN0cmluZzogICAgICAge3N0eWxlOiB7Zmc6J3llbGxvdyd9LHBhdHRlcm46L1wiKD86XFxcXC58W15cIl0pKlwifCcoPzpcXFxcLnxbXiddKSonL21pZ30sXG4gICAgICAgIE9wZXJhdG9yOiAgICAge3N0eWxlOiB7Zmc6J2N5YW4nfSxwYXR0ZXJuOi89PXwhPXw8PXw+PXxbK1xcLSovPTw+XS9taWd9LFxuICAgICAgICBwdW5jdHVhdGlvbjogIHtzdHlsZToge2ZnOidjeWFuJ30scGF0dGVybjovWygpXFxbXFxde30uLDs6P1xcXl0vbWlnfSxcbiAgICAgICAgV2hpdGVzcGFjZTogICB7c3R5bGU6IHtmZzond2hpdGUnfSxwYXR0ZXJuOi9cXHMrL21pZ30sXG4gICAgICAgIE90aGVyczogICAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovLio/L21pZ30sXG4gICAgfX0sXG4gICAganM6e25hbWU6J2pzJyxmbGFnczonbWcnLGRlZmluaXRpb25zOntcbiAgICAgICAgS2V5d29yZDogICAgICB7c3R5bGU6IHtmZzonbWFnZW50YSd9LHBhdHRlcm46L1xcYihhc3xmcm9tfGRlZmF1bHR8dGhpc3xjb25zdHxjb25zdHJ1Y3RvcnxsZXR8dmFyfGZ1bmN0aW9ufGlmfGVsc2V8Zm9yfHdoaWxlfHJldHVybnxjbGFzc3xpbXBvcnR8ZXhwb3J0fG5ld3xhd2FpdHxhc3luY3x0cnl8Y2F0Y2h8dGhyb3d8c3dpdGNofGNhc2V8YnJlYWt8Y29udGludWUpXFxiL21pZ30sXG4gICAgICAgIE51bWJlcjogICAgICAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1xcZCsoPzpcXC5cXGQrKT8vbWlnfSxcbiAgICAgICAgQ29tbWVudDogICAgICB7c3R5bGU6IHtmZzonIzc3OTk3Nyd9LHBhdHRlcm46L1xcL1xcLy4qJC9taWd9LFxuICAgICAgICAvLyBNQ29tbWVudDogICAgIHtzdHlsZToge2ZnOicjNzc5OTk5J30scGF0dGVybjonL1xcXFwqLipcXFxcKi8nfSxcbiAgICAgICAgU3RyaW5nOiAgICAgICB7c3R5bGU6IHtmZzoneWVsbG93J30scGF0dGVybjovXCIoPzpcXFxcLnxbXlwiXSkqXCJ8Jyg/OlxcXFwufFteJ10pKicvbWlnfSxcbiAgICAgICAgT3BlcmF0b3I6ICAgICB7c3R5bGU6IHtmZzonY3lhbid9LHBhdHRlcm46Lz09fCE9fDw9fD49fFsrXFwtKi89PD4lfCZcdTAwMWJdL21pZ30sXG4gICAgICAgIFB1bmN0dWF0aW9uOiAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1tcXFxcKClcXFtcXF17fS4sOzo/XiRdL21pZ30sXG4gICAgICAgIFdoaXRlc3BhY2U6ICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovXFxzKy9zbWlnfSxcbiAgICAgICAgSWRlbnRpZmllcjogICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9bQS1aYS16X11cXHcqL21pZ30sXG4gICAgICAgIE90aGVyczogICAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovW15dL3NtaWd9LFxuICAgIH19LFxuICAgIGpzeDp7bmFtZTonanN4JyxmbGFnczonbWcnLGRlZmluaXRpb25zOntcbiAgICAgICAgUmVhY3RUb2tlbjogICB7c3R5bGU6IHtmZzonI0ZGREQwMCd9LHBhdHRlcm46L1xcYnVzZVtBLVpdW2Etel0qXFxiL21pZ30sXG4gICAgICAgIEtleXdvcmQ6ICAgICAge3N0eWxlOiB7Zmc6J21hZ2VudGEnfSxwYXR0ZXJuOi9cXGIoYXN8ZnJvbXxkZWZhdWx0fGNvbnN0fGxldHx2YXJ8ZnVuY3Rpb258aWZ8ZWxzZXxmb3J8d2hpbGV8cmV0dXJufGNsYXNzfGltcG9ydHxleHBvcnR8bmV3fGF3YWl0fGFzeW5jfHRyeXxjYXRjaHx0aHJvd3xzd2l0Y2h8Y2FzZXxicmVha3xjb250aW51ZSlcXGIvbWlnfSxcbiAgICAgICAgSnN4VGFnOiAgICAgICB7c3R5bGU6IHtmZzonI0ZGREQwMCd9LHBhdHRlcm46LzwoXFwvKT9bYS16QS1aLV0qPi9taWd9LFxuICAgICAgICBDb21tZW50OiAgICAgIHtzdHlsZToge2ZnOicjNzc5OTc3J30scGF0dGVybjovXFwvXFwvLiokL21pZ30sXG4gICAgICAgIC8vIE1Db21tZW50OiAgICAge3N0eWxlOiB7Zmc6JyM3Nzk5OTknfSxwYXR0ZXJuOicvXFxcXCouKlxcXFwqLyd9LFxuICAgICAgICBOdW1iZXI6ICAgICAgIHtzdHlsZToge2ZnOidyZWQnfSxwYXR0ZXJuOi9cXGQrKD86XFwuXFxkKyk/L21pZ30sXG4gICAgICAgIFB1bmN0dWF0aW9uOiAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1tcXFxcKClcXFtcXF17fS4sOzo/XiRdL21pZ30sXG4gICAgICAgIE9wZXJhdG9yOiAgICAge3N0eWxlOiB7Zmc6J2N5YW4nfSxwYXR0ZXJuOi89PXwhPXw8PXw+PXxbK1xcLSovPTw+XS9taWd9LFxuICAgICAgICBXaGl0ZXNwYWNlOiAgIHtzdHlsZToge2ZnOid3aGl0ZSd9LHBhdHRlcm46L1xccysvbWlnfSxcbiAgICAgICAgSWRlbnRpZmllcjogICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9bQS1aYS16X11cXHcqL21pZ30sXG4gICAgICAgIE90aGVyczogICAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovLio/L21pZ30sXG4gICAgfX0sXG4gICAgYzp7bmFtZTonYycsZmxhZ3M6J21nJyxkZWZpbml0aW9uczp7XG4gICAgICAgIEtleXdvcmQ6ICAgICAge3N0eWxlOiB7Zmc6J21hZ2VudGEnfSxwYXR0ZXJuOi9cXGIoaW50fGNvbnN0fGNoYXJ8bG9uZ3xpZnxlbHNlfGZvcnx3aGlsZXxyZXR1cm58c3dpdGNofGNhc2V8YnJlYWt8Y29udGludWUpXFxiL21pZ30sXG4gICAgICAgIE51bWJlcjogICAgICAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1xcZCsoPzpcXC5cXGQrKT8vbWlnfSxcbiAgICAgICAgQ29tbWVudDogICAgICB7c3R5bGU6IHtmZzonIzc3OTk3Nyd9LHBhdHRlcm46L1xcL1xcLy4qJC9taWd9LFxuICAgICAgICAvLyBNQ29tbWVudDogICAgIHtzdHlsZToge2ZnOicjNzc5OTk5J30scGF0dGVybjonL1xcXFwqLipcXFxcKi8nfSxcbiAgICAgICAgU3RyaW5nOiAgICAgICB7c3R5bGU6IHtmZzoneWVsbG93J30scGF0dGVybjovXCIoPzpcXFxcLnxbXlwiXSkqXCJ8Jyg/OlxcXFwufFteJ10pKicvbWlnfSxcbiAgICAgICAgT3BlcmF0b3I6ICAgICB7c3R5bGU6IHtmZzonY3lhbid9LHBhdHRlcm46Lz09fCE9fDw9fD49fFsrXFwtKi89PD5dL21pZ30sXG4gICAgICAgIFB1bmN0dWF0aW9uOiAge3N0eWxlOiB7Zmc6J2N5YW4nfSxwYXR0ZXJuOi89PXwhPXw8PXw+PXxbK1xcLSovPTw+XS9taWd9LFxuICAgICAgICBXaGl0ZXNwYWNlOiAgIHtzdHlsZToge2ZnOid3aGl0ZSd9LHBhdHRlcm46L1xccysvbWlnfSxcbiAgICAgICAgSWRlbnRpZmllcjogICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9bQS1aYS16X11cXHcqL21pZ30sXG4gICAgICAgIE90aGVyczogICAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovLio/L21pZ30sXG4gICAgfX0sXG4gICAgd29yZHM6e25hbWU6J2MnLGZsYWdzOidtZycsZGVmaW5pdGlvbnM6e1xuICAgICAgICBXaGl0ZXNwYWNlOiAgICAgICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovXFxzKy9taWd9LFxuICAgICAgICBXb3JkOiAgICAgICAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9cXGIuKz9cXGIvbWlnfSxcbiAgICB9fSxcbiAgfVxuXG4vKipcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSBsYW5ndWFnZSBuYW1lXG4gKiBAcmV0dXJuIHtmdW5jdGlvbiAoY29kZTpzdHJpbmcsbGluZU51bWJlcjppbnQpOiBBcnJheTxUb2tlbml6ZXJUb2tlbj59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXROYW1lZFRva2VuaXplcihuYW1lKSB7XG4gICAgY29uc3QgdG9rZW5pemVyRGVmID0gbmFtZWRUb2tlbml6ZXJzW25hbWVdfHxuYW1lZFRva2VuaXplcnNbJ2FueSddXG4gICAgcmV0dXJuIGdldFRva2VuaXplcih0b2tlbml6ZXJEZWYpXG59XG4vKipcbiAqXG4gKiBAcGFyYW0ge1Rva2VuaXplckRlZn0gdG9rZW5pemVyRGVmIGxhbmd1YWdlIG5hbWVcbiAqIEByZXR1cm4ge2Z1bmN0aW9uIChjb2RlOnN0cmluZyxsaW5lTnVtYmVyOmludCk6IEFycmF5PFRva2VuaXplclRva2VuPn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFRva2VuaXplcih0b2tlbml6ZXJEZWYpIHtcbiAgICB0b2tlbml6ZXJEZWZbJ0FueSddPXtzdHlsZToge2ZnOicjZWVlZWVlJ30scGF0dGVybjovKFxcYnxeKS4rPyhcXGJ8JCkvc21pZ31cbiAgICBjb25zdCB0b2tlblJlZ2V4ID0gbmV3IFJlZ0V4cChcbiAgICAgICAgT2JqZWN0LmVudHJpZXModG9rZW5pemVyRGVmLmRlZmluaXRpb25zKVxuICAgICAgICAgICAgLm1hcCgoW25hbWUsIGRlZmluaXRpb25dKSA9PiBgKD88JHtuYW1lfT4ke2RlZmluaXRpb24ucGF0dGVybi5zb3VyY2V9KWApXG4gICAgICAgICAgICAuam9pbignfCcpLFxuICAgICAgICB0b2tlbml6ZXJEZWYuZmxhZ3N8fCdnJ1xuICAgICk7XG4gICAgLyoqXG4gICAgICogQHBhcmFtIHtUb2tlbml6ZXJNYXRjaGVyRGVmfSBjb2RlXG4gICAgICogQHJldHVybiB7QXJyYXk8VG9rZW5pemVyVG9rZW4+fVxuICAgICAqL1xuICAgIHJldHVybiBmdW5jdGlvbiB0b2tlbml6ZXIoY29kZSxsaW5lTnVtYmVyKXtcbiAgICAgICAgY29uc3QgdG9rZW5zPVtdXG4gICAgICAgIGZvciAoY29uc3QgbSBvZiAoY29kZSApLm1hdGNoQWxsKHRva2VuUmVnZXgpKSB7XG4gICAgICAgICAgICBjb25zdCBncm91cHMgPSBtLmdyb3VwcztcbiAgICAgICAgICAgIGNvbnN0IHR5cGUgPSBPYmplY3Qua2V5cyhncm91cHMpLmZpbmQoa2V5ID0+IGdyb3Vwc1trZXldICE9PSB1bmRlZmluZWQpO1xuICAgICAgICAgICAgY29uc3QgdG9rZW5EZWYgPSB0b2tlbml6ZXJEZWYuZGVmaW5pdGlvbnNbdHlwZV1cbiAgICAgICAgICAgIHRva2Vucy5wdXNoKFRva2VuaXplclRva2VuLmZyb21SZWdleHBNYXRjaChtLHRva2VuaXplckRlZix0b2tlbml6ZXJEZWYubmFtZSxsaW5lTnVtYmVyKSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdG9rZW5zXG4gICAgfVxufSIsIi8vIGltcG9ydCB7U2NyZWVuRXZlbnR9IGZyb20gJ3JlYWN0LWJsZXNzZWQnXG5pbXBvcnQge2dldFRva2VuaXplciwgVG9rZW5pemVyVG9rZW59IGZyb20gJy4vdG9rZW5pemVyLmpzJ1xuLyoqXG4gKlxuICogQHBhcmFtIHtTaW1wbGVUZXh0RWRpdG9yfSBldmVudERhdGFcbiAqIEByZXR1cm4geyhmdW5jdGlvbigpKXx1bmRlZmluZWR9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBMaXN0ZW5lcihldmVudERhdGEpe3JldHVybiAoKT0+e319XG5cblxuZXhwb3J0IGNsYXNzIEVkaXRvckV2ZW50IHtcbiAgICAvKipcbiAgICAgKiBAdHlwZSB7U2NyZWVuRXZlbnR9XG4gICAgICovXG4gICAgc2NyZWVuPSB7fVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3N0cmluZ1tdfVxuICAgICAqL1xuICAgIGxpbmVzPVtdXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7c3RyaW5nfVxuICAgICAqL1xuICAgIGxpbmU9XCJcIlxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3N0cmluZ1tdfVxuICAgICAqL1xuICAgIHZpc2libGVMaW5lcz1bXVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3t4OiBudW1iZXIsIHk6IG51bWJlcn19XG4gICAgICovXG4gICAgY3Vyc29yPXt4OjAseTowfVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3t4OiBudW1iZXIsIHk6IG51bWJlcn19XG4gICAgICovXG4gICAgY3Vyc29yU2NyZWVuPXt4OjAseTowfVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3N0cmluZ31cbiAgICAgKi9cbiAgICBidWZmZXI9XCJcIlxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3N0cmluZ31cbiAgICAgKi9cbiAgICB2aXNpYmxlQnVmZmVyPVwiXCJcbiAgICAvKipcbiAgICAgKlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgaW5kZXg9MFxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge1Rva2VuaXplclRva2VuW119XG4gICAgICovXG4gICAgdG9rZW5zPVtdXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7VG9rZW5pemVyVG9rZW59XG4gICAgICovXG4gICAgdG9rZW5VbmRlckN1cnNvcj1udWxsXG4gICAgcGhyYXNlPVwiXCJcbn1cblxuZXhwb3J0IGNsYXNzIFNpbXBsZVRleHRFZGl0b3Ige1xuICAgIGJ1ZmZlcj1cIlwiXG4gICAgY3Vyc29ySW5kZXg9MFxuICAgIGhpZ2hsaWdodEluZGV4PTBcbiAgICBsaXN0ZW5lcnM9e1wiY3Vyc29yQ2hhbmdlZFwiOltdLFwiYnVmZmVyQ2hhbmdlZFwiOltdfVxuICAgIHZpZXdwb3J0SGVpZ2h0PTdcbiAgICB2aWV3cG9ydFdpZHRoPTMwXG4gICAgdmlld3BvcnRYPTBcbiAgICB2aWV3cG9ydFk9MFxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gYnVmZmVyXG4gICAgICovXG4gICAgY29uc3RydWN0b3IoYnVmZmVyKSB7XG4gICAgICAgIHRoaXMuYnVmZmVyID0gYnVmZmVyfHxcIlwiO1xuICAgIH1cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7XCJjdXJzb3JDaGFuZ2VkXCJ8XCJidWZmZXJDaGFuZ2VkXCJ9IGV2ZW50VHlwZVxuICAgICAqIEBwYXJhbSB7KGV2ZW50RGF0YTpTaW1wbGVUZXh0RWRpdG9yKT0+KCgpPT52b2lkKX0gbGlzdGVuZXJcbiAgICAgKi9cbiAgICBvbihldmVudFR5cGUsbGlzdGVuZXIpe1xuICAgICAgICB0aGlzLmxpc3RlbmVyc1tldmVudFR5cGVdPWxpc3RlbmVyXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1wiY3Vyc29yQ2hhbmdlZFwifFwiYnVmZmVyQ2hhbmdlZFwifSBldmVudFR5cGVcbiAgICAgKiBAcGFyYW0ge1NpbXBsZVRleHRFZGl0b3J9IHBheWxvYWRcbiAgICAgKi9cbiAgICBfZGlzcGF0Y2hFdmVudHMoZXZlbnRUeXBlLHBheWxvYWQpe1xuICAgICAgICBjb25zdCB0b0tlZXA9W11cbiAgICAgICAgZm9yKGxldCBsaXN0ZW5lciBvZiB0aGlzLmxpc3RlbmVyc1tldmVudFR5cGVdKXtcbiAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICBjb25zdCB1bnN1YnNjcmliZT1saXN0ZW5lcihwYXlsb2FkKVxuICAgICAgICAgICAgICAgIGlmKHR5cGVvZih1bnN1YnNjcmliZSkgPT09IFwiZnVuY3Rpb25cIil7XG4gICAgICAgICAgICAgICAgICAgIHVuc3Vic2NyaWJlKClcbiAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgdG9LZWVwLnB1c2gobGlzdGVuZXIpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfWNhdGNoKGVycil7XG5cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxpc3RlbmVyc1tldmVudFR5cGVdPXRvS2VlcFxuICAgIH1cbiAgICBzbGlkZVZpZXdwb3J0VG9DdXJzb3IoKXtcbiAgICAgICAgbGV0IHt4LHl9ID0gdGhpcy5jdXJzb3JDb29yZHMoKVxuICAgICAgICBsZXQge3ZpZXdwb3J0SGVpZ2h0OnZoLCB2aWV3cG9ydFdpZHRoOnZ3LCB2aWV3cG9ydFg6dngsIHZpZXdwb3J0WTp2eX09dGhpc1xuICAgICAgICBpZiAoeTx2eSl7XG4gICAgICAgICAgICB2eT15XG4gICAgICAgIH1cbiAgICAgICAgaWYoeT4odnkrdmgpKXtcbiAgICAgICAgICAgIHZ5Kz0xXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy52aWV3cG9ydFk9dnlcbiAgICB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtzdHJpbmdbXX1cbiAgICAgKi9cbiAgICByZW5kZXJUb0xpbmVzKHN0YXJ0PTAsaGVpZ2h0KXtcbiAgICAgICAgY29uc3QgbGluZXMgPSB0aGlzLmJ1ZmZlci5zcGxpdChcIlxcblwiKTtcbiAgICAgICAgY29uc3QgZT1zdGFydCsoaGVpZ2h0fHxsaW5lcy5sZW5ndGgpO1xuICAgICAgICByZXR1cm4gbGluZXMuc2xpY2Uoc3RhcnQsZSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge3t5OiBudW1iZXIsIHg6IG51bWJlcn19XG4gICAgICovXG4gICAgY3Vyc29yQ29vcmRzKCl7XG4gICAgICAgIHJldHVybiB0aGlzLmN1cnNvckluZGV4VG9Db29yZHModGhpcy5jdXJzb3JJbmRleClcbiAgICB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHt7eTogbnVtYmVyLCB4OiBudW1iZXJ9fVxuICAgICAqL1xuICAgIGhpZ2hsaWdodENvb3Jkcygpe1xuICAgICAgICByZXR1cm4gdGhpcy5jdXJzb3JJbmRleFRvQ29vcmRzKHRoaXMuaGlnaGxpZ2h0SW5kZXgpXG4gICAgfVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IGluZGV4XG4gICAgICogQHJldHVybiB7e3k6IG51bWJlciwgeDogbnVtYmVyfX1cbiAgICAgKi9cbiAgICBjdXJzb3JJbmRleFRvQ29vcmRzKGluZGV4KXtcbiAgICAgICAgY29uc3QgbGluZXNUbz10aGlzLmJ1ZmZlci5zdWJzdHJpbmcoMCxwYXJzZUludChpbmRleCkpLnNwbGl0KFwiXFxuXCIpO1xuICAgICAgICAvL2NvbnNvbGUubG9nKHtsaW5lc1RvfSlcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHk6bGluZXNUby5sZW5ndGgtMSxcbiAgICAgICAgICAgIHg6bGluZXNUb1tsaW5lc1RvLmxlbmd0aC0xXS5sZW5ndGhcbiAgICAgICAgfVxuICAgIH1cbiAgICBzZXRDdXJzb3IoeCx5KXtcbiAgICAgICAgdGhpcy5jdXJzb3JJbmRleD10aGlzLmN1cnNvckNvb3Jkc1RvSW5kZXgoe3gseX0pXG4gICAgfVxuICAgIHNldEhpZ2hsaWdodCh4LHkpe1xuICAgICAgICB0aGlzLmhpZ2hsaWdodEluZGV4PXRoaXMuY3Vyc29yQ29vcmRzVG9JbmRleCh7eCx5fSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7e3g6TnVtYmVyLHk6TnVtYmVyfX0gY29vcmRzXG4gICAgICogQHJldHVybiB7TnVtYmVyfVxuICAgICAqL1xuICAgIGN1cnNvckNvb3Jkc1RvSW5kZXgoY29vcmRzKXtcbiAgICAgICAgY29uc3Qge3gseX0gPSBjb29yZHNcbiAgICAgICAgY29uc3QgbGluZXM9dGhpcy5idWZmZXIuc3BsaXQoXCJcXG5cIikuc2xpY2UoMCx5KTtcbiAgICAgICAgLy9jb25zb2xlLmxvZyh7bGluZXN9KVxuICAgICAgICByZXR1cm4gbGluZXMucmVkdWNlKChjLGwpPT5jKzErbC5sZW5ndGgsMCkgKyB4O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IGNoXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IGtleVxuICAgICAqIEByZXR1cm4ge1NpbXBsZVRleHRFZGl0b3J9XG4gICAgICovXG4gICAgb25LZXkoY2gsa2V5KXtcbiAgICAgICAgc3dpdGNoIChrZXkubmFtZSkge1xuICAgICAgICAgICAgY2FzZSAndXAnOiAgICAgIHRoaXMubW92ZUN1cnNvclVwKCk7ICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2Rvd24nOiAgICB0aGlzLm1vdmVDdXJzb3JEb3duKCk7ICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2xlZnQnOiAgICB0aGlzLm1vdmVDdXJzb3JMZWZ0KCk7ICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ3JpZ2h0JzogICB0aGlzLm1vdmVDdXJzb3JSaWdodCgpOyBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2hvbWUnOiAgICB0aGlzLnRvSG9tZSgpOyA7YnJlYWs7XG4gICAgICAgICAgICBjYXNlICdlbmQnOiAgICAgIHRoaXMudG9FbmQoKTsgO2JyZWFrO1xuICAgICAgICAgICAgY2FzZSAnYmFja3NwYWNlJzogdGhpcy5iYWNrc3BhY2UoKTsgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnZGVsZXRlJzogICAgdGhpcy5kZWxldGUoKTsgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAncmV0dXJuJzogICAgdGhpcy5pbnNlcnQoXCJcXG5cIik7dGhpcy5tb3ZlQ3Vyc29yRG93bigpOyBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ3RhYic6ICAgIHRoaXMuaW5zZXJ0KFwiXFx0XCIpOyAgYnJlYWs7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIGlmIChjaCAmJiBjaC5sZW5ndGggPiAwKXtcbiAgICAgICAgICAgICAgICAgICAgaWYoa2V5Lm5hbWUgJiYga2V5Lm5hbWUubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmluc2VydChrZXkuc2VxdWVuY2UpXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmluc2VydChjaCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5zbGlkZVZpZXdwb3J0VG9DdXJzb3IoKVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cbiAgICB0b2tlblVuZGVyQ3Vyc29yKHgseSx0b2tlbml6ZXIpe1xuICAgICAgICBjb25zdCBsaW5lcyA9IHRoaXMucmVuZGVyVG9MaW5lcygpXG4gICAgICAgIGNvbnN0IGxpbmUgPSBsaW5lc1t5XTtcbiAgICAgICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemVyKGxpbmUseSlcbiAgICAgICAgY29uc3QgcGhyYXNlID0gdG9rZW5zLm1hcCh2PT52LnR5cGUpXG4gICAgICAgIGNvbnN0IHRva2VuVW5kZXJDdXJzb3IgPSB0b2tlbnMuZmluZCgodixpLGEpPT57XG4gICAgICAgICAgICByZXR1cm4gdi5zdGFydDw9eCAmJiB2LmVuZD49eDtcbiAgICAgICAgfSlcbiAgICAgICAgcmV0dXJuIHRva2VuVW5kZXJDdXJzb3JcbiAgICB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0gbHBvc1xuICAgICAqIEBwYXJhbSB7U2NyZWVufSBzY3JlZW5FdmVudFxuICAgICAqIEBwYXJhbSB0b2tlbml6ZXJcbiAgICAgKiBAcmV0dXJuIHtFZGl0b3JFdmVudH1cbiAgICAgKi9cbiAgICBnZXRFdmVudChscG9zLHNjcmVlbkV2ZW50LHRva2VuaXplcikge1xuICAgICAgICBjb25zdCB7eGkseWl9ID0gbHBvcztcbiAgICAgICAgY29uc3Qge3gseX0gPSBzY3JlZW5FdmVudDtcbiAgICAgICAgY29uc3QgY3Vyc29yID0gdGhpcy5jdXJzb3JDb29yZHMoKVxuICAgICAgICBjb25zdCBsaW5lcyA9IHRoaXMucmVuZGVyVG9MaW5lcygpXG4gICAgICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tjdXJzb3IueV07XG4gICAgICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplcihsaW5lLHkpXG4gICAgICAgIGNvbnN0IHBocmFzZSA9IHRva2Vucy5tYXAodj0+di50eXBlKVxuICAgICAgICBjb25zdCB0b2tlblVuZGVyQ3Vyc29yID0gdG9rZW5zLmZpbmQoKHYsaSxhKT0+e1xuICAgICAgICAgICAgcmV0dXJuIHYuc3RhcnQ8PWN1cnNvci54ICYmIHYuZW5kPj1jdXJzb3IueDtcbiAgICAgICAgfSlcbiAgICAgICAgLy90aGlzLnNldEN1cnNvcih4LXhpK3RoaXMudmlld3BvcnRYLHkteWkrdGhpcy52aWV3cG9ydFkpXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBldmVudDpzY3JlZW5FdmVudCxcbiAgICAgICAgICAgIHBhcmVudFBvczp7eDp4aSx5OnlpfSxcbiAgICAgICAgICAgIGxpbmVzOmxpbmVzLFxuICAgICAgICAgICAgbGluZSxcbiAgICAgICAgICAgIHZpc2libGVMaW5lczpsaW5lcyxcbiAgICAgICAgICAgIGN1cnNvcixcbiAgICAgICAgICAgIGN1cnNvclNjcmVlbjp7eDpjdXJzb3IueC10aGlzLnZpZXdwb3J0WCx5OmN1cnNvci55LXRoaXMudmlld3BvcnRZfSxcbiAgICAgICAgICAgIGJ1ZmZlcjp0aGlzLmJ1ZmZlcixcbiAgICAgICAgICAgIHZpc2libGVCdWZmZXI6dGhpcy5idWZmZXIsXG4gICAgICAgICAgICBpbmRleDp0aGlzLmN1cnNvckluZGV4LFxuICAgICAgICAgICAgdG9rZW5zLFxuICAgICAgICAgICAgdG9rZW5VbmRlckN1cnNvcixcbiAgICAgICAgICAgIHBocmFzZSxcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2ltcGxlVGV4dEVkaXRvcn1cbiAgICAgKi9cbiAgICBtb3ZlQ3Vyc29yVXAoKXtcbiAgICAgICAgbGV0IHt4LHl9ID0gdGhpcy5jdXJzb3JJbmRleFRvQ29vcmRzKHRoaXMuY3Vyc29ySW5kZXgpXG4gICAgICAgIGlmICh5PjApIHtcbiAgICAgICAgICAgIHRoaXMuY3Vyc29ySW5kZXg9dGhpcy5jdXJzb3JDb29yZHNUb0luZGV4KHt4OngseTp5LTF9KVxuICAgICAgICAgICAgdGhpcy5fZGlzcGF0Y2hFdmVudHMoXCJjdXJzb3JDaGFuZ2VkXCIsdGhpcylcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2ltcGxlVGV4dEVkaXRvcn1cbiAgICAgKi9cbiAgICBtb3ZlQ3Vyc29yRG93bigpe1xuICAgICAgICBsZXQge3gseX0gPSB0aGlzLmN1cnNvckluZGV4VG9Db29yZHModGhpcy5jdXJzb3JJbmRleClcbiAgICAgICAgY29uc3QgbGluZXM9dGhpcy5idWZmZXIuc3BsaXQoXCJcXG5cIilcbiAgICAgICAgaWYgKHk8KGxpbmVzLmxlbmd0aC0xKSkge1xuICAgICAgICAgICAgdGhpcy5jdXJzb3JJbmRleD10aGlzLmN1cnNvckNvb3Jkc1RvSW5kZXgoe3g6eCx5OnkrMX0pXG4gICAgICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIix0aGlzKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIG1vdmVDdXJzb3JMZWZ0KCl7XG4gICAgICAgIGlmKHRoaXMuY3Vyc29ySW5kZXg+MCl7XG4gICAgICAgICAgICB0aGlzLmN1cnNvckluZGV4LT0xXG4gICAgICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIix0aGlzKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIG1vdmVDdXJzb3JSaWdodCgpe1xuICAgICAgICBpZih0aGlzLmN1cnNvckluZGV4PHRoaXMuYnVmZmVyLmxlbmd0aCl7XG4gICAgICAgICAgICB0aGlzLmN1cnNvckluZGV4Kz0xXG4gICAgICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIix0aGlzKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIHRvSG9tZSgpe1xuICAgICAgICBsZXQge3gseX0gPSB0aGlzLmN1cnNvckluZGV4VG9Db29yZHModGhpcy5jdXJzb3JJbmRleClcbiAgICAgICAgdGhpcy5jdXJzb3JJbmRleD10aGlzLmN1cnNvckNvb3Jkc1RvSW5kZXgoe3g6MCx5Onl9KVxuICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIix0aGlzKVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2ltcGxlVGV4dEVkaXRvcn1cbiAgICAgKi9cbiAgICB0b0VuZCgpe1xuICAgICAgICBsZXQge3gseX0gPSB0aGlzLmN1cnNvckluZGV4VG9Db29yZHModGhpcy5jdXJzb3JJbmRleClcbiAgICAgICAgY29uc3QgbGluZT10aGlzLmJ1ZmZlci5zcGxpdChcIlxcblwiKVt5XVxuICAgICAgICB0aGlzLmN1cnNvckluZGV4PXRoaXMuY3Vyc29yQ29vcmRzVG9JbmRleCh7eDpsaW5lLmxlbmd0aCx5Onl9KVxuICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIix0aGlzKVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2ltcGxlVGV4dEVkaXRvcn1cbiAgICAgKi9cbiAgICBiYWNrc3BhY2UoKXtcbiAgICAgICAgaWYodGhpcy5jdXJzb3JJbmRleD4wKXtcbiAgICAgICAgICAgIHRoaXMuY3Vyc29ySW5kZXggLT0gMVxuICAgICAgICAgICAgdGhpcy5fZGlzcGF0Y2hFdmVudHMoXCJjdXJzb3JDaGFuZ2VkXCIsIHRoaXMpXG4gICAgICAgICAgICBjb25zdCBiZWZvcmU9dGhpcy5idWZmZXIuc3Vic3RyaW5nKDAsdGhpcy5jdXJzb3JJbmRleClcbiAgICAgICAgICAgIGNvbnN0IGFmdGVyPXRoaXMuYnVmZmVyLnN1YnN0cmluZyh0aGlzLmN1cnNvckluZGV4KzEpXG4gICAgICAgICAgICB0aGlzLmJ1ZmZlcj1iZWZvcmUrYWZ0ZXJcbiAgICAgICAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnRzKFwiYnVmZmVyQ2hhbmdlZFwiLHRoaXMpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIGRlbGV0ZSgpe1xuICAgICAgICBjb25zdCBiZWZvcmU9dGhpcy5idWZmZXIuc3Vic3RyaW5nKDAsdGhpcy5jdXJzb3JJbmRleCsxKVxuICAgICAgICBjb25zdCBhZnRlcj10aGlzLmJ1ZmZlci5zdWJzdHJpbmcodGhpcy5jdXJzb3JJbmRleCsyKVxuICAgICAgICB0aGlzLmJ1ZmZlcj1iZWZvcmUrYWZ0ZXJcbiAgICAgICAgdGhpcy5fZGlzcGF0Y2hFdmVudHMoXCJidWZmZXJDaGFuZ2VkXCIsdGhpcylcbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIGluc2VydChjaCl7XG4gICAgICAgIHRoaXMuY3Vyc29ySW5kZXgrPTFcbiAgICAgICAgY29uc3QgYmVmb3JlPXRoaXMuYnVmZmVyLnN1YnN0cmluZygwLHRoaXMuY3Vyc29ySW5kZXgtMSlcbiAgICAgICAgY29uc3QgYWZ0ZXI9dGhpcy5idWZmZXIuc3Vic3RyaW5nKHRoaXMuY3Vyc29ySW5kZXgtMSlcbiAgICAgICAgdGhpcy5idWZmZXI9YmVmb3JlK2NoK2FmdGVyXG4gICAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnRzKFwiYnVmZmVyQ2hhbmdlZFwiLHRoaXMpXG4gICAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnRzKFwiY3Vyc29yQ2hhbmdlZFwiLHRoaXMpXG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIGNvcHkoKXtcbiAgICAgICAgY29uc3QgbmV3U2ltcGxlVGV4dEJ1ZmZlcj0gbmV3IFNpbXBsZVRleHRFZGl0b3IoKVxuICAgICAgICBuZXdTaW1wbGVUZXh0QnVmZmVyLmJ1ZmZlciA9IHRoaXMuYnVmZmVyXG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIuY3Vyc29ySW5kZXggPSB0aGlzLmN1cnNvckluZGV4XG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIuaGlnaGxpZ2h0SW5kZXggPSB0aGlzLmhpZ2hsaWdodEluZGV4XG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIudmlld3BvcnRIZWlnaHQ9dGhpcy52aWV3cG9ydEhlaWdodFxuICAgICAgICBuZXdTaW1wbGVUZXh0QnVmZmVyLnZpZXdwb3J0V2lkdGg9dGhpcy52aWV3cG9ydFdpZHRoXG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIudmlld3BvcnRYPXRoaXMudmlld3BvcnRYXG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIudmlld3BvcnRZPXRoaXMudmlld3BvcnRZXG4gICAgICAgIHJldHVybiBuZXdTaW1wbGVUZXh0QnVmZmVyXG4gICAgfVxufSIsImltcG9ydCBSZWFjdCwge3VzZUVmZmVjdCwgdXNlUmVmLCB1c2VTdGF0ZX0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQge1xuICAgIExpc3RFbGVtZW50IGFzIGxpc3QsXG4gICAgQm94RWxlbWVudCBhcyBib3gsXG4gICAgQnV0dG9uRWxlbWVudCBhcyBidXR0b24sXG4gICAgVGV4dGFyZWFFbGVtZW50IGFzIHRleHRhcmVhLFxuICAgIFRleHRFbGVtZW50IGFzIHRleHRcbn0gZnJvbSAncmVhY3QtYmxlc3NlZCc7XG5pbXBvcnQge1NpbXBsZVRleHRFZGl0b3IsRWRpdG9yRXZlbnR9IGZyb20gXCIuL1NpbXBsZVRleHRFZGl0b3IuanNcIjtcbmltcG9ydCB7ZGVib3VuY2VkLCBzYWZlU3RyaW5naWZ5fSBmcm9tIFwiLi91dGlsXCI7XG5pbXBvcnQge2dldE5hbWVkVG9rZW5pemVyLCBnZXRUb2tlbml6ZXJ9IGZyb20gXCIuL3Rva2VuaXplclwiO1xuaW1wb3J0IHtTY3JlZW5FdmVudH0gZnJvbSBcInJlYWN0LWJsZXNzZWRcIjtcblxuXG4vKipcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBsaW5lc1xuICogQHBhcmFtIHtib29sZWFufSBlZGl0YWJsZVxuICogQHBhcmFtIHsoZWRpdG9yRXZlbnQ6RWRpdG9yRXZlbnQpPT52b2lkfSBvbkNsaWNrXG4gKiBAcGFyYW0geyhlZGl0b3JFdmVudDpFZGl0b3JFdmVudCk9PnZvaWR9IG9uTGluZUNsaWNrXG4gKiBAcGFyYW0geyhlZGl0b3JFdmVudDpFZGl0b3JFdmVudCk9PnZvaWR9IG9uTGluZUhvdmVyXG4gKiBAcGFyYW0geyhlZGl0b3JFdmVudDpFZGl0b3JFdmVudCk9PnZvaWR9IG9uVG9rZW5DbGlja1xuICogQHBhcmFtIHsoZWRpdG9yRXZlbnQ6RWRpdG9yRXZlbnQpPT52b2lkfSBvblRva2VuSG92ZXJcbiAqIEBwYXJhbSB7VG9rZW5pemVyRGVmfSB0b2tlbml6ZXJEZWZcbiAqIEBwYXJhbSB7Tm9kZVdpdGhFdmVudHNbXX0gY2hpbGRyZW5cbiAqIEBwYXJhbSB7YW55W119IGJveFByb3BzXG4gKiBAcmV0dXJuIHtFbGVtZW50fVxuICovXG5leHBvcnQgZnVuY3Rpb24gTGlzdENvbXBvbmVudCh7XG4gIGxpbmVzLFxuICBlZGl0YWJsZSA9IGZhbHNlLFxuICBkZWZhdWx0VGV4dD0nLi4uJyxcbiAgb25MaW5lQ2xpY2s9KGVkaXRvckV2ZW50KT0+e30sXG4gIG9uVG9rZW5DbGljaz0oZWRpdG9yRXZlbnQpPT57fSxcbiAgb25MaW5lSG92ZXI9KGVkaXRvckV2ZW50KT0+e30sXG4gIG9uVG9rZW5Ib3Zlcj0oZWRpdG9yRXZlbnQpPT57fSxcbiAgdG9rZW5pemVyRGVmLFxuICBjaGlsZHJlbixcbiAgLi4uYm94UHJvcHNcbn0pIHtcbiAgICBjb25zdCBib3hSZWYgPSB1c2VSZWYobnVsbCk7XG4gICAgY29uc3QgW2VkaXRvciwgc2V0RWRpdG9yXSA9IHVzZVN0YXRlKG51bGwpO1xuICAgIGNvbnN0IFtzaXplLCBzZXRTaXplXSAgICAgPSB1c2VTdGF0ZSh7IHJvd3M6IDEwLCBjb2xzOiAzMCB9KTtcblxuICAgIGxldCBjaGFuZ2VkVGltZW91dD0wXG4gICAgdXNlRWZmZWN0KCgpPT57XG4gICAgICAgIGxldCBuZXdFZGl0b3I9ZWRpdG9yXG4gICAgICAgIGlmKCFuZXdFZGl0b3Ipe1xuICAgICAgICAgICAgbmV3RWRpdG9yID0gbmV3IFNpbXBsZVRleHRFZGl0b3IobGluZXMuam9pbihcIlxcblwiKXx8ZGVmYXVsdFRleHQpXG4gICAgICAgIH1cbiAgICAgICAgaWYoKGxpbmVzLmpvaW4oXCJcXG5cIil8fGRlZmF1bHRUZXh0KS5zdWJzdHJpbmcobmV3RWRpdG9yLmN1cnNvckluZGV4KSE9PW5ld0VkaXRvci5idWZmZXIuc3Vic3RyaW5nKG5ld0VkaXRvci5jdXJzb3JJbmRleCkpe1xuICAgICAgICAgICAgbmV3RWRpdG9yLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpXG4gICAgICAgIH1cbiAgICAgICAgbmV3RWRpdG9yLmJ1ZmZlcj1saW5lcy5qb2luKFwiXFxuXCIpfHxkZWZhdWx0VGV4dFxuICAgICAgICBuZXdFZGl0b3Iudmlld3BvcnRIZWlnaHQgPSBzaXplLnJvd3MtMTtcbiAgICAgICAgbmV3RWRpdG9yLnZpZXdwb3J0V2lkdGggPSBzaXplLmNvbHM7XG4gICAgICAgIHNldEVkaXRvcihuZXdFZGl0b3IuY29weSgpKVxuICAgIH0sW2xpbmVzXSlcblxuICAgIC8vIDIpIHVwZGF0ZSBzaXplIG9uIHJlc2l6ZVxuICAgIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgICAgIGNvbnN0IGJveCA9IGJveFJlZi5jdXJyZW50O1xuICAgICAgICBpZiAoIWJveCkgcmV0dXJuO1xuICAgICAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XG4gICAgICAgICAgICBzZXRTaXplKHsgY29sczogYm94LndpZHRoLCByb3dzOiBib3guaGVpZ2h0LTIgfSk7XG4gICAgICAgIH07XG4gICAgICAgIHVwZGF0ZSgpO1xuICAgICAgICBib3gub24oJ3Jlc2l6ZScsIHVwZGF0ZSk7XG4gICAgICAgIHJldHVybiAoKSA9PiBib3gucmVtb3ZlTGlzdGVuZXIoJ3Jlc2l6ZScsIHVwZGF0ZSk7XG4gICAgfSwgW10pO1xuXG4gICAgLy8gcnVuIG9uY2Ugb24gc2l6ZSBjaGFuZ2VcbiAgICB1c2VFZmZlY3QoKCk9PntcbiAgICAgICAgaWYoZWRpdG9yKXtcbiAgICAgICAgICAgIGVkaXRvci52aWV3cG9ydFdpZHRoID0gc2l6ZS5jb2xzO1xuICAgICAgICAgICAgZWRpdG9yLnZpZXdwb3J0SGVpZ2h0ID0gc2l6ZS5yb3dzO1xuICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgIH1cbiAgICB9LCBbc2l6ZV0pO1xuXG4gICAgY29uc3QgaW50ZXJuYWxPbktleVByZXNzPShjaCxrZXkpPT57XG4gICAgICAgIGlmKGVkaXRhYmxlKSB7XG4gICAgICAgICAgICBlZGl0b3Iub25LZXkoY2gsIGtleSlcbiAgICAgICAgICAgIGNsZWFyVGltZW91dChjaGFuZ2VkVGltZW91dClcbiAgICAgICAgICAgIGNoYW5nZWRUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gb25DaGFuZ2UoZWRpdG9yKVxuICAgICAgICAgICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgICAgICAgICAgfSwgODApXG4gICAgICAgIH1lbHNlIGlmICgga2V5IGluIFsndXAnLCdkb3duJ10gKXtcbiAgICAgICAgICAgIGVkaXRvci5vbktleShjaCwga2V5KVxuICAgICAgICAgICAgY2hhbmdlZFRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBvbkNoYW5nZShlZGl0b3IpXG4gICAgICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgICAgICB9LCA4MClcbiAgICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBnZXRFdmVudCA9IChzY3JlZW5FdmVudCkgPT4ge1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB0b2tlbml6ZXI9Z2V0VG9rZW5pemVyKHRva2VuaXplckRlZnx8e1xuICAgICAgICAgICAgbmFtZTond29yZHMnLFxuICAgICAgICAgICAgZmxhZ3M6J21nJyxcbiAgICAgICAgICAgIGRlZmluaXRpb25zOntcbiAgICAgICAgICAgICAgICBXaGl0ZXNwYWNlOiAgICAgICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovXFxzKy9naX0sXG4gICAgICAgICAgICAgICAgV29yZDogICAgICAgICAgICAge3N0eWxlOiB7Zmc6J2dyZWVuJ30scGF0dGVybjovXFxiLis/XFxiL2dpfSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgZXZ0ID0gZWRpdG9yLmdldEV2ZW50KGJveFJlZi5jdXJyZW50Lmxwb3Msc2NyZWVuRXZlbnQsdG9rZW5pemVyKTtcblxuICAgICAgICAvLyBlZGl0b3Iuc2V0Q3Vyc29yKHNjcmVlbkV2ZW50LngtYm94UmVmLmN1cnJlbnQubHBvcy54aStlZGl0b3Iudmlld3BvcnRYLHNjcmVlbkV2ZW50LnktYm94UmVmLmN1cnJlbnQubHBvcy55aStlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICByZXR1cm4gZXZ0XG4gICAgfVxuICAgIGNvbnN0IG9ubW91c2Vtb3ZlPWRlYm91bmNlZCgoc2NyZWVuRXZlbnQpPT57XG4gICAgICAgIGNvbnN0IG5ld0V2ZW50ID0gZ2V0RXZlbnQoc2NyZWVuRXZlbnQpXG4gICAgICAgIGVkaXRvci5zZXRIaWdobGlnaHQobmV3RXZlbnQuY3Vyc29yU2NyZWVuLnggKyBlZGl0b3Iudmlld3BvcnRYLCBuZXdFdmVudC5jdXJzb3JTY3JlZW4ueSArIGVkaXRvci52aWV3cG9ydFkpXG4gICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgICAgICBvbkxpbmVIb3ZlcihuZXdFdmVudCk7XG4gICAgICAgIG9uVG9rZW5Ib3ZlcihuZXdFdmVudCk7XG4gICAgfSwxMClcbiAgICBjb25zdCBtb3VzZUFjdGlvbj0oc2NyZWVuRXZlbnQpID0+e1xuXG4gICAgICAgIHN3aXRjaChzY3JlZW5FdmVudC5hY3Rpb24pe1xuICAgICAgICAgICAgY2FzZSAnbW91c2Vtb3ZlJzoge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXdFdmVudCA9IGdldEV2ZW50KHNjcmVlbkV2ZW50KVxuICAgICAgICAgICAgICAgICAgICBlZGl0b3Iuc2V0SGlnaGxpZ2h0KG5ld0V2ZW50LmN1cnNvclNjcmVlbi54ICsgZWRpdG9yLnZpZXdwb3J0WCwgbmV3RXZlbnQuY3Vyc29yU2NyZWVuLnkgKyBlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICAgICAgICAgICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKT0+e1xuICAgICAgICAgICAgICAgICAgICAgICAgb25MaW5lSG92ZXIobmV3RXZlbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2tlbkhvdmVyKG5ld0V2ZW50KTtcbiAgICAgICAgICAgICAgICAgICAgfSwxKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ21vdXNlZG93bic6IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3RXZlbnQgPSBnZXRFdmVudChzY3JlZW5FdmVudClcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGl0b3Iuc2V0Q3Vyc29yKHNjcmVlbkV2ZW50LngtYm94UmVmLmN1cnJlbnQubHBvcy54aStlZGl0b3Iudmlld3BvcnRYLHNjcmVlbkV2ZW50LnktYm94UmVmLmN1cnJlbnQubHBvcy55aStlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICAgICAgICAgICAgICAgICAgZWRpdG9yLnNldEhpZ2hsaWdodChuZXdFdmVudC5jdXJzb3JTY3JlZW4ueCArIGVkaXRvci52aWV3cG9ydFgsIG5ld0V2ZW50LmN1cnNvclNjcmVlbi55ICsgZWRpdG9yLnZpZXdwb3J0WSlcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgICAgICAgICAgICAgICAgICB9LCAxKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ21vdXNldXAnOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0V2ZW50ID0gZ2V0RXZlbnQoc2NyZWVuRXZlbnQpXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHt4LHl9ID0gc2NyZWVuRXZlbnQ7XG4gICAgICAgICAgICAgICAgICAgIC8vIHNldExhc3RFdmVudChuZXdFdmVudCk7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCk9PntcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkaXRvci5zZXRIaWdobGlnaHQobnVsbClcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkaXRvci5zZXRDdXJzb3Ioc2NyZWVuRXZlbnQueC1ib3hSZWYuY3VycmVudC5scG9zLnhpK2VkaXRvci52aWV3cG9ydFgsc2NyZWVuRXZlbnQueS1ib3hSZWYuY3VycmVudC5scG9zLnlpK2VkaXRvci52aWV3cG9ydFkpXG4gICAgICAgICAgICAgICAgICAgICAgICBlZGl0b3Iuc2V0SGlnaGxpZ2h0KG5ld0V2ZW50LmN1cnNvclNjcmVlbi54ICsgZWRpdG9yLnZpZXdwb3J0WCwgbmV3RXZlbnQuY3Vyc29yU2NyZWVuLnkgKyBlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICAgICAgICAgICAgICAgICAgb25MaW5lQ2xpY2sobmV3RXZlbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2tlbkNsaWNrKG5ld0V2ZW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgICAgICAgICAgICAgICAgICB9LDEpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnd2hlZWx1cCc6IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3RXZlbnQgPSBnZXRFdmVudChzY3JlZW5FdmVudClcbiAgICAgICAgICAgICAgICAgICAgZWRpdG9yLm1vdmVDdXJzb3JVcCgpLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpO1xuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpPT57XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGl0b3Iuc2V0SGlnaGxpZ2h0KG51bGwpXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBlZGl0b3Iuc2V0Q3Vyc29yKHNjcmVlbkV2ZW50LngtYm94UmVmLmN1cnJlbnQubHBvcy54aStlZGl0b3Iudmlld3BvcnRYLHNjcmVlbkV2ZW50LnktYm94UmVmLmN1cnJlbnQubHBvcy55aStlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgICAgICAgICAgICAgIH0sMSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICd3aGVlbGRvd24nOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0V2ZW50ID0gZ2V0RXZlbnQoc2NyZWVuRXZlbnQpXG4gICAgICAgICAgICAgICAgICAgIGVkaXRvci5tb3ZlQ3Vyc29yRG93bigpLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpO1xuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpPT57XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGl0b3Iuc2V0SGlnaGxpZ2h0KG51bGwpXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBlZGl0b3Iuc2V0Q3Vyc29yKHNjcmVlbkV2ZW50LngtYm94UmVmLmN1cnJlbnQubHBvcy54aStlZGl0b3Iudmlld3BvcnRYLHNjcmVlbkV2ZW50LnktYm94UmVmLmN1cnJlbnQubHBvcy55aStlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgICAgICAgICAgICAgIH0sMSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBkZWZhdWx0OiB0aHJvdyBuZXcgRXJyb3Ioc2FmZVN0cmluZ2lmeShzY3JlZW5FdmVudCkpOyBicmVhaztcbiAgICAgICAgfVxuICAgIH1cbiAgICBjb25zdCByZW5kZXJMaW5lcyA9ICgpID0+IHtcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qge3ZpZXdwb3J0WTp2eSx2aWV3cG9ydEhlaWdodDp2aH0gPSBlZGl0b3JcbiAgICAgICAgcmV0dXJuIGVkaXRvci5yZW5kZXJUb0xpbmVzKClcbiAgICAgICAgICAgIC5maWx0ZXIoKGwseSkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiAoeSA+PXZ5ICYmIHkgPD0gKHZ5ICsgdmgpKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAuZmxhdE1hcCgobGluZSxpbmRleCxhcnIpPT57XG4gICAgICAgICAgICAgICAgY29uc3QgcmVuZGVyYWJsZXMgPSBbXG4gICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgIGtleT17YGxpc3RjLWxpbmUtJHtpbmRleH0tJHtEYXRlLm5vd31gfVxuICAgICAgICAgICAgICAgICAgICAgICAgdG9wPXtpbmRleH0gbGVmdD17MH0gaGVpZ2h0PXsxfSB3aWR0aD17bGluZS5sZW5ndGh8fDF9XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50PXtsaW5lfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICBjb25zdCB0b2tlbml6ZXI9Z2V0VG9rZW5pemVyKHRva2VuaXplckRlZnx8e1xuICAgICAgICAgICAgICAgICAgICBuYW1lOid3b3JkcycsXG4gICAgICAgICAgICAgICAgICAgIGZsYWdzOidtZycsXG4gICAgICAgICAgICAgICAgICAgIGRlZmluaXRpb25zOntcbiAgICAgICAgICAgICAgICAgICAgICAgIFdoaXRlc3BhY2U6ICAgICAgIHtzdHlsZToge2ZnOidyZWQnfSxwYXR0ZXJuOi9cXHMrL21pZ30sXG4gICAgICAgICAgICAgICAgICAgICAgICBXb3JkOiAgICAgICAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9cXGIuKz9cXGIvbWlnfSxcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemVyKGxpbmUsaW5kZXgpXG4gICAgICAgICAgICAgICAgdG9rZW5zLmZvckVhY2goKHRva2VuLGopPT57XG4gICAgICAgICAgICAgICAgICAgIHJlbmRlcmFibGVzLnB1c2goXG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAga2V5PXtgbGlzdGMtbGluZS0ke2luZGV4fS10b2tlbi0ke2p9LSR7RGF0ZS5ub3d9YH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b3A9e2luZGV4fSBsZWZ0PXt0b2tlbi5zdGFydH0gaGVpZ2h0PXsxfSB3aWR0aD17dG9rZW4udGV4dC5sZW5ndGh8fDF9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudD17dG9rZW4udGV4dH0gc3R5bGU9e3Rva2VuLnN0eWxlfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz4pXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVuZGVyYWJsZXNcbiAgICAgICAgICAgIH0pXG4gICAgfVxuICAgIGNvbnN0IHJlbmRlckN1cnNvciA9ICgpID0+IHtcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaSA9IGVkaXRvci5jdXJzb3JJbmRleFxuICAgICAgICBjb25zdCB7eCx5fSA9IGVkaXRvci5jdXJzb3JDb29yZHMoKVxuICAgICAgICBjb25zdCB7Y3Vyc29ySW5kZXg6Y2ksdmlld3BvcnRYOnZ4LHZpZXdwb3J0WTp2eSx2aWV3cG9ydEhlaWdodDp2aCx2aWV3cG9ydFdpZHRoOnZ3fSA9IGVkaXRvcjtcbiAgICAgICAgcmV0dXJuICg8Ym94XG4gICAgICAgICAgICBrZXk9e2BlZGl0b3ItY3Vyc29yLSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgdG9wPXt5LXZ5fVxuICAgICAgICAgICAgbGVmdD17eC12eH1cbiAgICAgICAgICAgIHdpZHRoPXsxfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBzdHlsZT17e2ludmVyc2U6dHJ1ZX19XG4gICAgICAgICAgICBjb250ZW50PXtlZGl0b3IuYnVmZmVyLnN1YnN0cmluZyhpLGkrMSl9XG4gICAgICAgIC8+KVxuICAgIH1cbiAgICBjb25zdCByZW5kZXJIaWdobGlnaHQ9KCk9PntcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaSA9IGVkaXRvci5jdXJzb3JJbmRleFxuICAgICAgICBjb25zdCB7eCx5fSA9IGVkaXRvci5oaWdobGlnaHRDb29yZHMoKVxuICAgICAgICBjb25zdCB7Y3Vyc29ySW5kZXg6Y2ksdmlld3BvcnRYOnZ4LHZpZXdwb3J0WTp2eSx2aWV3cG9ydEhlaWdodDp2aCx2aWV3cG9ydFdpZHRoOnZ3fSA9IGVkaXRvcjtcbiAgICAgICAgY29uc3QgdG9rZW5pemVyPWdldFRva2VuaXplcih0b2tlbml6ZXJEZWZ8fHtcbiAgICAgICAgICAgIG5hbWU6J3dvcmRzJyxcbiAgICAgICAgICAgIGZsYWdzOidtZycsXG4gICAgICAgICAgICBkZWZpbml0aW9uczp7XG4gICAgICAgICAgICAgICAgV2hpdGVzcGFjZTogICAgICAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1xccysvbWlnfSxcbiAgICAgICAgICAgICAgICBXb3JkOiAgICAgICAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9cXGIuKz9cXGIvbWlnfSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgdG9rZW5VbmRlckN1cnNvcj1lZGl0b3IudG9rZW5VbmRlckN1cnNvcih4LHksdG9rZW5pemVyKVxuICAgICAgICBpZih0b2tlblVuZGVyQ3Vyc29yKSB7XG4gICAgICAgICAgICByZXR1cm4gKDxib3hcbiAgICAgICAgICAgICAgICBrZXk9e2BlZGl0b3ItaGlnaGxpZ2h0LSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgICAgIHRvcD17eSAtIHZ5fVxuICAgICAgICAgICAgICAgIGxlZnQ9e3Rva2VuVW5kZXJDdXJzb3Iuc3RhcnR9XG4gICAgICAgICAgICAgICAgd2lkdGg9e3Rva2VuVW5kZXJDdXJzb3IudGV4dC5sZW5ndGh9IGhlaWdodD17MX1cbiAgICAgICAgICAgICAgICBzdHlsZT17ey4uLnRva2VuVW5kZXJDdXJzb3Iuc3R5bGUsIGludmVyc2U6IHRydWV9fVxuICAgICAgICAgICAgICAgIGNvbnRlbnQ9e3Rva2VuVW5kZXJDdXJzb3IudGV4dH1cbiAgICAgICAgICAgIC8+KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIFtdXG4gICAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgcmVuZGVyU2Nyb2xsYmFyID0gKCkgPT4ge1xuICAgICAgICBjb25zdCBiYXJFbGVtZW50cz0gWyg8Ym94XG4gICAgICAgICAgICBrZXk9e2BzY3JvbGxiYXItYmctJHtEYXRlLm5vdygpfWB9XG4gICAgICAgICAgICByaWdodD17MH1cbiAgICAgICAgICAgIHdpZHRoPXsxfVxuICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgIHN0eWxlPXt7Zmc6ICdjeWFuJyxiZzogJ2dyZXknfX1cbiAgICAgICAgLz4pXTtcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm4gYmFyRWxlbWVudHNcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB0aD1lZGl0b3IucmVuZGVyVG9MaW5lcygpLmxlbmd0aFxuXG4gICAgICAgIGNvbnN0IHtjdXJzb3JJbmRleDpjaSx2aWV3cG9ydFg6dngsdmlld3BvcnRZOnZ5LHZpZXdwb3J0SGVpZ2h0OnZoLHZpZXdwb3J0V2lkdGg6dnd9ID0gZWRpdG9yO1xuICAgICAgICBjb25zdCBzaD1NYXRoLmZsb29yKHZoKnZoL3RoKSsxXG4gICAgICAgIGNvbnN0IHN5PU1hdGguZmxvb3IodnkqdmgvdGgpKzFcbiAgICAgICAgYmFyRWxlbWVudHMucHVzaCgoPGJveFxuICAgICAgICAgICAga2V5PXtgc2Nyb2xsYmFyLWJ0bi0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgIHJpZ2h0PXswfVxuICAgICAgICAgICAgd2lkdGg9ezF9XG4gICAgICAgICAgICB0b3A9e3N5fVxuICAgICAgICAgICAgaGVpZ2h0PXtzaH1cbiAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICBpbnB1dFxuICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICBmb2N1c2VkXG4gICAgICAgICAgICBzdHlsZT17e2ZnOiAnY3lhbicsYmc6ICdjeWFuJ319XG4gICAgICAgIC8+KSlcbiAgICAgICAgcmV0dXJuIGJhckVsZW1lbnRzXG4gICAgfVxuICAgIGNvbnN0IHJlbmRlclN0YXR1cz0oKT0+e1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB7dmlld3BvcnRYOnZ4LHZpZXdwb3J0WTp2eSx2aWV3cG9ydEhlaWdodDp2aCx2aWV3cG9ydFdpZHRoOnZ3fSA9IGVkaXRvclxuICAgICAgICBjb25zdCB0PUpTT04uc3RyaW5naWZ5KGVkaXRvci5jdXJzb3JDb29yZHMoKSkucmVwbGFjZSgvXCIvZ2ksJycpXG4gICAgICAgIHJldHVybiAoPGJveFxuICAgICAgICAgICAgbW91c2Uga2V5c1xuICAgICAgICAgICAga2V5PXtgZWRpdG9yLXN0YXR1cy0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgIHRvcD17LTF9XG4gICAgICAgICAgICBsZWZ0PXt2dy0xMX1cbiAgICAgICAgICAgIHdpZHRoPXt0Lmxlbmd0aH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgc3R5bGU9e3tpbnZlcnNlOnRydWV9fVxuICAgICAgICAgICAgY29udGVudD17dH1cbiAgICAgICAgLz4pXG4gICAgfVxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3hcbiAgICAgICAgICAgIHJlZj17Ym94UmVmfVxuICAgICAgICAgICAgey4uLmJveFByb3BzfVxuICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgIHN0eWxlPXt7IGJvcmRlcjogeyBmZzogJ2N5YW4nIH0gfX1cbiAgICAgICAgICAgIHRhZ3M9e2ZhbHNlfSAgICAgICAgICAgLy8gcmF3IEFOU0lcbiAgICAgICAgICAgIHNjcm9sbGFibGU9e2ZhbHNlfVxuICAgICAgICAgICAgb25LZXlwcmVzcz17aW50ZXJuYWxPbktleVByZXNzfVxuICAgICAgICAgICAgb25Nb3VzZT17bW91c2VBY3Rpb259XG4gICAgICAgID5cbiAgICAgICAgICAgIHsvKmxhYmVsID0ge2Ake2JveFByb3BzLmxhYmVsIHx8ICdFZGl0aW5nJ30gJHtKU09OLnN0cmluZ2lmeShlZGl0b3IuY3Vyc29yQ29vcmRzKCkpfSAke2VkaXRvci5jdXJzb3JJbmRleH1gfSovfVxuICAgICAgICAgICAge3JlbmRlckxpbmVzKCl9XG4gICAgICAgICAgICB7cmVuZGVyQ3Vyc29yKCl9XG4gICAgICAgICAgICB7cmVuZGVyU2Nyb2xsYmFyKCl9XG4gICAgICAgICAgICB7Y2hpbGRyZW58fFtdfVxuICAgICAgICAgICAge3JlbmRlckhpZ2hsaWdodCgpfVxuICAgICAgICAgICAge3JlbmRlclN0YXR1cygpfVxuICAgICAgICA8L2JveD4pXG59IiwiLy8gc3JjL0ZpbGVUcmVlLmpzXG5pbXBvcnQgUmVhY3QsIHtDb21wb25lbnQsIHVzZUVmZmVjdCwgdXNlUmVmLCB1c2VTdGF0ZX0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHsgTGlzdEVsZW1lbnQgYXMgbGlzdCwgVGV4dEVsZW1lbnQgYXMgdGV4dCwgQm94RWxlbWVudCBhcyBib3ggfSBmcm9tICdyZWFjdC1ibGVzc2VkJztcbmltcG9ydCB7IFdvcmtzcGFjZSxJTm9kZSB9IGZyb20gJy4vV29ya3NwYWNlJztcbmltcG9ydCB7aW5zZXJ0QXQsIHNhZmVTdHJpbmdpZnl9IGZyb20gXCIuL3V0aWxcIjtcbmltcG9ydCB7TGlzdENvbXBvbmVudH0gZnJvbSBcIi4vTGlzdENvbXBvbmVudFwiO1xuaW1wb3J0IE1vZGFsRGlhbG9nIGZyb20gXCIuL01vZGFsRGlhbG9nXCI7XG5jb25zdCBsaXN0aW5nVG9rZW5pemVyRGVmaW5pdGlvbj17XG4gICAgbmFtZTonbGlzdGluZycsXG4gICAgZmxhZ3M6J21nJyxcbiAgICBkZWZpbml0aW9uczp7XG4gICAgICAgIFwiV2hpdGVzcGFjZVwiOiAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovXFxzKy9tZ2l9LFxuICAgICAgICBcIkZvbGRlclwiOiAgICAgICAgIHtzdHlsZToge2ZnOid3aGl0ZSd9LHBhdHRlcm46Lyg/PD1cXFtbLStdXSlcXFMrL21naX0sXG4gICAgICAgIFwiT3BlbkJ1dHRvblwiOiAgICAge3N0eWxlOiB7Zmc6J3llbGxvdyd9LHBhdHRlcm46L1xcW1xcK10vbWdpfSxcbiAgICAgICAgXCJDbG9zZUJ1dHRvblwiOiAgICB7c3R5bGU6IHtmZzoneWVsbG93J30scGF0dGVybjovXFxbLV0vbWdpfSxcbiAgICAgICAgXCJBZGREaXJCdXR0b25cIjogICB7c3R5bGU6IHtmZzonY3lhbid9LHBhdHRlcm46L1xcW1xcK0RdL21naX0sXG4gICAgICAgIFwiQWRkRmlsZUJ1dHRvblwiOiAge3N0eWxlOiB7Zmc6J21hZ2VudGEnfSxwYXR0ZXJuOi9cXFtcXCtGXS9tZ2l9LFxuICAgICAgICBcIlJlbmFtZUJ1dHRvblwiOiAgIHtzdHlsZToge2ZnOidibHVlJ30scGF0dGVybjovXFxbcl0vbWdpfSxcbiAgICAgICAgXCJEZWxldGVCdXR0b25cIjogICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovXFxbeF0vbWdpfSxcbiAgICAgICAgXCJOb2RlTmFtZVwiOiAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9bYS16QS1aMC05Xz17fVxcW1xcXSUqKCltLC46OyE/QH4tXSsvbWdpfSxcbiAgICAgICAgXCJXb3JkXCI6ICAgICAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9cXHMuKz9cXHMvbWdpfSxcbiAgICB9XG59XG4vKipcbiAqXG4gKiBAcGFyYW0ge0lOb2RlW119IHRyZWVcbiAqIEBwYXJhbSB7KG5vZGU6SU5vZGUpLT51bmRlZmluZWR9IG9uRGlyU2VsZWN0XG4gKiBAcGFyYW0geyhub2RlOklOb2RlKS0+dW5kZWZpbmVkfSBvbkZpbGVTZWxlY3RcbiAqIEByZXR1cm5zIHtKU1guRWxlbWVudH1cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBGaWxlVHJlZSh7XG4gICAgY2hpbGRyZW4sXG4gICAgcm9vdERpcixcbiAgICBvbkRpclNlbGVjdCxcbiAgICBvbkZpbGVTZWxlY3QsXG4gICAgbGFiZWwsXG4gICAgaW5vZGVGaWx0ZXI9KGlub2RlLGluZGV4LG5vZGVzLHBhcmVudCk9PntyZXR1cm4gdHJ1ZX0sXG4gICAgY3Vyc29yPXRydWUsXG4gICAgLi4uYm94UHJvcHNcbn0pe1xuICAgIGNvbnN0IGJveFJlZiA9IHVzZVJlZigpO1xuICAgIGNvbnN0IFttZXNzYWdlLCBzZXRNZXNzYWdlXSA9IFJlYWN0LnVzZVN0YXRlKGZhbHNlKTtcbiAgICBjb25zdCBbc2VsZWN0ZWQsIHNldFNlbGVjdGVkXSA9IFJlYWN0LnVzZVN0YXRlKG51bGwpO1xuICAgIGNvbnN0IFtjdXJzb3JEYXRhLCBzZXRDdXJzb3JEYXRhXSA9IFJlYWN0LnVzZVN0YXRlKG51bGwpO1xuICAgIGNvbnN0IFt3b3Jrc3BhY2Usc2V0V29ya3NwYWNlXSA9IHVzZVN0YXRlKG5ldyBXb3Jrc3BhY2UoaW5vZGVGaWx0ZXIpKTtcblxuXG5cbiAgICAvLyBmb2N1cyB0aGUgbW9kYWwgc28gaXQgY2FuIGNhdGNoIGtleXByZXNzZXNcbiAgICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgICAgICBjb25zdCBub2RlID0gYm94UmVmLmN1cnJlbnQ7XG4gICAgICAgIGlmIChub2RlKSBub2RlLmZvY3VzKCk7XG4gICAgICAgIHdvcmtzcGFjZS5pbml0KHJvb3REaXIpXG4gICAgICAgICAgICAudGhlbih3ayA9PiB3b3Jrc3BhY2Uub3Blbih3b3Jrc3BhY2Uucm9vdE5vZGUpKVxuICAgICAgICAgICAgLnRoZW4od2sgPT4ge1xuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCk9PntcbiAgICAgICAgICAgICAgICAgICAgc2V0V29ya3NwYWNlKHdrLmNvcHkoKSlcbiAgICAgICAgICAgICAgICB9LDEwMClcbiAgICAgICAgICAgICAgICAvLy8gc2V0TWVzc2FnZShgbG9hZGVkIHRyZWUgZGF0YSAke0pTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICAvLy8gICB3a1xuICAgICAgICAgICAgICAgIC8vLyB9KX1gKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgLy8gc2V0V29ya3NwYWNlKHdvcmtzcGFjZS5jb3B5KCkpXG4gICAgfSwgW3Jvb3REaXJdKTtcbiAgICBsZXQgYmFzZUxldmVsPXJvb3REaXIuc3BsaXQoXCIvXCIpLmxlbmd0aCoyXG4gICAgaWYgKGJhc2VMZXZlbD4wKSB7XG4gICAgICAgYmFzZUxldmVsID0gYmFzZUxldmVsLTFcbiAgICB9XG4gICAgbGV0IGxpbmVzID0gKCkgPT4ge1xuICAgICAgICB0cnl7XG4gICAgICAgICAgICBjb25zdCBscG9zID0gYm94UmVmLmN1cnJlbnQubHBvc1xuICAgICAgICAgICAgY29uc3QgdHJlZURhdGEgPSB3b3Jrc3BhY2UuZmxhdHRlbigpLmZpbHRlcihpbm9kZUZpbHRlcilcblxuICAgICAgICAgICAgcmV0dXJuICh0cmVlRGF0YSB8fCBbXSkubWFwKCh2LCBpLCBhKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGluZUJ1ZmZlciA9IFwiIFwiLnJlcGVhdChscG9zLndpZHRoKVxuICAgICAgICAgICAgICAgIGNvbnN0IHQgPSB2LnRvVGV4dCgpLnN1YnN0cmluZyhiYXNlTGV2ZWwpXG4gICAgICAgICAgICAgICAgbGV0IHJyID0gaW5zZXJ0QXQobGluZUJ1ZmZlciwwLHQpXG4gICAgICAgICAgICAgICAgc3dpdGNoICh2LnR5cGUuc3Vic3RyaW5nKDAsIDEpKSB7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgJ2QnOlxuICAgICAgICAgICAgICAgICAgICAgICAgcnI9aW5zZXJ0QXQocnIsbHBvcy53aWR0aC0xNywnWytEXVsrRl1bcl1beF0nKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJyXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICBycj1pbnNlcnRBdChycixscG9zLndpZHRoLTksJ1tyXVt4XScpXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcnJcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9Y2F0Y2goZXJyKXtcbiAgICAgICAgICAgIHJldHVybiBbXVxuICAgICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG9uVG9rZW5DbGljaz0oZXZlbnREYXRhKT0+e1xuICAgICAgICBjb25zdCB0cmVlRGF0YSA9IHdvcmtzcGFjZS5mbGF0dGVuKCkuZmlsdGVyKGlub2RlRmlsdGVyKVxuICAgICAgICBjb25zdCB7bGluZXMsIHZpc2libGVMaW5lcywgbGluZSwgY3Vyc29yOnt4LHl9LGN1cnNvclNjcmVlbiwgYnVmZmVyLCB2aXNpYmxlQnVmZmVyLCBpbmRleCx0b2tlbnMsdG9rZW5VbmRlckN1cnNvcixwaHJhc2V9ID0gZXZlbnREYXRhXG4gICAgICAgIGNvbnN0IG5vZGUgPSB0cmVlRGF0YVt5XTtcbiAgICAgICAgLy8gdGhyb3cgSlNPTi5zdHJpbmdpZnkoe25vZGUseX0sbnVsbCwgJyAnKVxuICAgICAgICAvLyBpZiAobm9kZS50eXBlLmluZGV4T2YoJ2QnKT4tMSkge1xuICAgICAgICBzd2l0Y2gocGhyYXNlLmZpbHRlcih2ID0+IHYhPT0nV2hpdGVzcGFjZScpLmpvaW4oXCIsXCIpKXtcbiAgICAgICAgICAgIGNhc2UgXCJXaGl0ZXNwYWNlLE5vZGVOYW1lXCI6XG4gICAgICAgICAgICBjYXNlIFwiTm9kZU5hbWUsUmVuYW1lQnV0dG9uLERlbGV0ZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgIHN3aXRjaCgodG9rZW5VbmRlckN1cnNvcnx8e3R5cGU6J3VuZGVmaW5lZCd9KS50eXBlKXtcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIk5vZGVOYW1lXCI6XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRTZWxlY3RlZChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG9uRmlsZVNlbGVjdChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDowLHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJSZW5hbWVCdXR0b25cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYFJlbmFtZVxcbiR7bm9kZS5mdWxsUGF0aH1gKVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIkRlbGV0ZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgRGVsZXRlXFxuJHtub2RlLmZ1bGxQYXRofWApXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzZXRDdXJzb3JEYXRhKHtjdXJzb3I6e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5fSxjdXJzb3JTY3JlZW46e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5OmN1cnNvclNjcmVlbi55fSxjb250ZW50OnRva2VuVW5kZXJDdXJzb3IudGV4dCxzdHlsZTp0b2tlblVuZGVyQ3Vyc29yLnN0eWxlfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgXCJXaGl0ZXNwYWNlLE9wZW5CdXR0b24sV2hpdGVzcGFjZSxOb2RlTmFtZVwiOlxuICAgICAgICAgICAgY2FzZSBcIldoaXRlc3BhY2UsQ2xvc2VCdXR0b24sV2hpdGVzcGFjZSxOb2RlTmFtZVwiOlxuICAgICAgICAgICAgY2FzZSBcIk9wZW5CdXR0b24sTm9kZU5hbWUsQWRkRGlyQnV0dG9uLEFkZEZpbGVCdXR0b24sUmVuYW1lQnV0dG9uLERlbGV0ZUJ1dHRvblwiOlxuICAgICAgICAgICAgY2FzZSBcIkNsb3NlQnV0dG9uLE5vZGVOYW1lLEFkZERpckJ1dHRvbixBZGRGaWxlQnV0dG9uLFJlbmFtZUJ1dHRvbixEZWxldGVCdXR0b25cIjpcbiAgICAgICAgICAgICAgICBzd2l0Y2goKHRva2VuVW5kZXJDdXJzb3J8fHt0eXBlOid1bmRlZmluZWQnfSkudHlwZSl7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJPcGVuQnV0dG9uXCI6XG4gICAgICAgICAgICAgICAgICAgICAgICBub2RlLm9wZW4od29ya3NwYWNlLnJvb3REaXIsd29ya3NwYWNlLmlnKS50aGVuKG4gPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHdrPXdvcmtzcGFjZS5jb3B5KClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZCA9IHdrLmZsYXR0ZW4oKS5maWx0ZXIoaW5vZGVGaWx0ZXIpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0V29ya3NwYWNlKHdrKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eCx5fSxjdXJzb3JTY3JlZW46e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5OmN1cnNvclNjcmVlbi55fSxjb250ZW50OnRva2VuVW5kZXJDdXJzb3IudGV4dCxzdHlsZTp0b2tlblVuZGVyQ3Vyc29yLnN0eWxlfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIkNsb3NlQnV0dG9uXCI6XG4gICAgICAgICAgICAgICAgICAgICAgICBub2RlLmNsb3NlKClcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHdrPXdvcmtzcGFjZS5jb3B5KClcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRkID0gd2suZmxhdHRlbigpLmZpbHRlcihpbm9kZUZpbHRlcilcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldFdvcmtzcGFjZSh3aylcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJOb2RlTmFtZVwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0U2VsZWN0ZWQobm9kZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBvbkRpclNlbGVjdChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJBZGREaXJCdXR0b25cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYEFkZERpclxcbiR7bm9kZS5mdWxsUGF0aH1gKVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIkFkZEZpbGVCdXR0b25cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYEFkZEZpbGVcXG4ke25vZGUuZnVsbFBhdGh9YClcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJSZW5hbWVCdXR0b25cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYFJlbmFtZVxcbiR7bm9kZS5mdWxsUGF0aH1gKVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIkRlbGV0ZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgRGVsZXRlXFxuJHtub2RlLmZ1bGxQYXRofWApXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzZXRDdXJzb3JEYXRhKHtjdXJzb3I6e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5fSxjdXJzb3JTY3JlZW46e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5OmN1cnNvclNjcmVlbi55fSxjb250ZW50OnRva2VuVW5kZXJDdXJzb3IudGV4dCxzdHlsZTp0b2tlblVuZGVyQ3Vyc29yLnN0eWxlfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIHBocmFzZSBTdHJ1Y3R1cmUgJyR7cGhyYXNlfSdgKVxuICAgICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGN1cnNvckV4dHJhPSgpPT57XG4gICAgICAgIGlmKCFjdXJzb3JEYXRhKSByZXR1cm4gPGJveCB0b3A9ezB9IGxlZnQ9ezB9IHdpZHRoPXsxfSBoZWlnaHQ9ezF9IGNvbnRlbnQ9eycgJ30vPjtcbiAgICAgICAgY29uc3Qge2N1cnNvcixjdXJzb3JTY3JlZW4sY29udGVudH0gPSBjdXJzb3JEYXRhXG4gICAgICAgIHJldHVybiA8Ym94IGtleT17YHhjdXJzb3ItJHtNYXRoLnJhbmRvbSgpfS0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgIHRvcD17Y3Vyc29yU2NyZWVuLnl9IGxlZnQ9e2N1cnNvclNjcmVlbi54fVxuICAgICAgICAgICAgd2lkdGg9e2NvbnRlbnQubGVuZ3RofSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBzdHlsZT17e2ludmVyc2U6IHRydWV9fVxuICAgICAgICAgICAgY29udGVudD17Y29udGVudH1cbiAgICAgICAgLz5cbiAgICB9XG4gICAgcmV0dXJuIChcbiAgICAgICAgPD5cbiAgICAgICAgPGJveCB7Li4uYm94UHJvcHN9IHJlZj17Ym94UmVmfT5cbiAgICAgICAgICAgIDxMaXN0Q29tcG9uZW50XG4gICAgICAgICAgICAgICAgc2Nyb2xsYmFyPXt7IGNoOiAnPScsIHRyYWNrOiB7IGZnOidibHVlJywgYmc6ICdncmV5JyB9IH19XG4gICAgICAgICAgICAgICAgdG9wPXswfVxuICAgICAgICAgICAgICAgIGJvdHRvbT17Mn1cbiAgICAgICAgICAgICAgICBsaW5lcz17bGluZXMoKX1cbiAgICAgICAgICAgICAgICBrZXlzIG1vdXNlXG4gICAgICAgICAgICAgICAgc3R5bGU9e3sgc2VsZWN0ZWQ6IHsgYmc6ICdibHVlJyB9IH19XG4gICAgICAgICAgICAgICAgb25Ub2tlbkNsaWNrPXtvblRva2VuQ2xpY2t9XG4gICAgICAgICAgICAgICAgdG9rZW5pemVyRGVmPXtsaXN0aW5nVG9rZW5pemVyRGVmaW5pdGlvbn1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICB7Lyo8Ym94IHRvcD17MH0gY29udGVudD17c2VsZWN0ZWQgPyBzZWxlY3RlZC5mdWxsUGF0aCA6ICcnICsgJyAnICsgbGFiZWx9IGhlaWdodD17MX0vPiovfVxuICAgICAgICAgICAge2NoaWxkcmVufHxbXX1cbiAgICAgICAgICAgIHtjdXJzb3I/Y3Vyc29yRXh0cmEoKTpbXX1cbiAgICAgICAgPC9ib3g+XG4gICAgICAgIHttZXNzYWdlICYmIChcbiAgICAgICAgICAgIDxNb2RhbERpYWxvZ1xuICAgICAgICAgICAgICAgIGxhYmVsPXsnTWVzc2FnZSd9XG4gICAgICAgICAgICAgICAgdGl0bGU9XCJNZXNzYWdlXCJcbiAgICAgICAgICAgICAgICBvbkNsb3NlPXsoKSA9PiBzZXRNZXNzYWdlKGZhbHNlKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8dGV4dD57bWVzc2FnZX08L3RleHQ+XG4gICAgICAgICAgICA8L01vZGFsRGlhbG9nPlxuICAgICAgICApfVxuICAgIDwvPlxuICAgICk7XG59XG5cbiIsIi8vIGNvbXBvbmVudHMvTW9kYWxEaWFsb2cuanNcbmltcG9ydCBSZWFjdCwgeyB1c2VFZmZlY3QsIHVzZVJlZix1c2VTdGF0ZSB9IGZyb20gJ3JlYWN0JztcbmltcG9ydCB7IEJveEVsZW1lbnQgYXMgYm94LCBUZXh0RWxlbWVudCBhcyB0ZXh0LCBCdXR0b25FbGVtZW50IGFzIGJ1dHRvbiB9IGZyb20gJ3JlYWN0LWJsZXNzZWQnO1xuaW1wb3J0IEZpbGVUcmVlIGZyb20gXCIuL0ZpbGVUcmVlXCI7XG5pbXBvcnQge1dvcmtzcGFjZX0gZnJvbSBcIi4vV29ya3NwYWNlXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEZvbGRlclBpY2tlckRpYWxvZyh7XG4gICAgdGl0bGUgPSAnRGlhbG9nJyxcbiAgICB3aWR0aCA9ICc1MCUnLFxuICAgIGhlaWdodCA9ICc1MCUnLFxuICAgIG9uRm9sZGVyU2VsZWN0LFxufSkge1xuICAgIGNvbnN0IFtzZWxlY3RlZCwgc2V0U2VsZWN0ZWRdID0gUmVhY3QudXNlU3RhdGUobnVsbCk7XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8RmlsZVRyZWVcbiAgICAgICAgICAgIHRvcD1cImNlbnRlclwiXG4gICAgICAgICAgICBsZWZ0PVwiY2VudGVyXCJcbiAgICAgICAgICAgIGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX1cbiAgICAgICAgICAgIHN0eWxlPXt7IGJnOiAnYmxhY2snLCBmZzogJ3doaXRlJyB9fVxuICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgLy8gY2xvc2Ugb24gRVNDXG4gICAgICAgICAgICBvbktleT17KGNoLCBrZXkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoa2V5Lm5hbWUgPT09ICdlc2NhcGUnKSBvbkZvbGRlclNlbGVjdChudWxsKTtcbiAgICAgICAgICAgIH19XG4gICAgICAgICAgICBsYWJlbD17c2VsZWN0ZWQ/c2VsZWN0ZWQuZnVsbE5hbWU6J1BpY2sgV29ya3NwYWNlJ31cbiAgICAgICAgICAgIHJvb3REaXI9eycvJ31cbiAgICAgICAgICAgIGlub2RlRmlsdGVyPXsoaW5vZGUsaW5kZXgsbm9kZXMscGFyZW50KT0+e3JldHVybiBpbm9kZS50eXBlLmluZGV4T2YoJ2QnKT4tMX19XG4gICAgICAgICAgICBvbkRpclNlbGVjdD17KHNlbGVjdERpcikgPT4ge1xuICAgICAgICAgICAgICAgIC8vIHRocm93IEpTT04uc3RyaW5naWZ5KHNlbGVjdERpcixudWxsLCcgJyk7XG4gICAgICAgICAgICAgICAgc2V0U2VsZWN0ZWQoc2VsZWN0RGlyKTtcbiAgICAgICAgICAgIH19XG4gICAgICAgICAgICBvbkZpbGVTZWxlY3Q9eygpPT57fX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgICAgIGxlZnQ9ezB9XG4gICAgICAgICAgICAgICAgYm90dG9tPXswfVxuICAgICAgICAgICAgICAgIGhlaWdodD17M31cbiAgICAgICAgICAgICAgICB3aWR0aD17JzQ1JSd9XG4gICAgICAgICAgICAgICAgdmFsaWduPXsnbWlkZGxlJ31cbiAgICAgICAgICAgICAgICBhbGlnbj17J2NlbnRlcid9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3tiZzonI2ZmYWEwMCcsZmc6JyMzMzMzMzMnLGhvdmVyOntiZzonI2ZmZGQ4OCcsZmc6JyMzMzMzMzMnfX19XG4gICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAvKiBkbyBzb21ldGhpbmcgKi9cbiAgICAgICAgICAgICAgICAgICAgb25Gb2xkZXJTZWxlY3Qoc2VsZWN0ZWQpXG4gICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICBjb250ZW50PXsnc2VsZWN0J31cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgICAgICAgICAgcmlnaHQ9ezB9XG4gICAgICAgICAgICAgICAgICAgIGJvdHRvbT17MH1cbiAgICAgICAgICAgICAgICAgICAgaGVpZ2h0PXszfVxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249eydtaWRkbGUnfVxuICAgICAgICAgICAgICAgICAgICBhbGlnbj17J2NlbnRlcid9XG4gICAgICAgICAgICAgICAgICAgIHdpZHRoPXsnNDUlJ31cbiAgICAgICAgICAgICAgICAgICAgc3R5bGU9e3tiZzonI2ZmYWEwMCcsZmc6JyMzMzMzMzMnLGhvdmVyOntiZzonI2ZmZGQ4OCcsZmc6JyMzMzMzMzMnfX19XG4gICAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgb25Gb2xkZXJTZWxlY3QobnVsbClcbiAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ9eydjYW5jZWwnfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgPC9GaWxlVHJlZT5cbiAgICApXG59XG4iLCIvLyBjb21wb25lbnRzL1ZUYWJzLmpzXG5pbXBvcnQgUmVhY3QsIHsgdXNlU3RhdGUgfSBmcm9tICdyZWFjdCc7XG5pbXBvcnQgeyBCb3hFbGVtZW50IGFzIGJveCwgVGV4dEVsZW1lbnQgYXMgdGV4dCB9IGZyb20gJ3JlYWN0LWJsZXNzZWQnO1xuaW1wb3J0IHsgR3JpZCxHcmlkSXRlbSB9IGZyb20gJ3JlYWN0LWJsZXNzZWQtY29udHJpYi0xNydcblxuLyoqXG4gKiA8VlRhYnMgdGFiV2lkdGg9XCIyMCVcIj5cbiAqICAgPFRhYiBuYW1lPVwiUHJvamVjdFwiPuKApjwvVGFiPlxuICogICA8VGFiIG5hbWU9XCJHaXRcIj7igKY8L1RhYj5cbiAqIDwvVlRhYnM+XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBWVGFicyh7IGNoaWxkcmVuLCAuLi5ib3hQcm9wc30pIHtcbiAgICBjb25zdCB0YWJzID0gUmVhY3QuQ2hpbGRyZW4udG9BcnJheShjaGlsZHJlbilcbiAgICAgICAgLmZpbHRlcihjaGlsZCA9PiBSZWFjdC5pc1ZhbGlkRWxlbWVudChjaGlsZCkgJiYgY2hpbGQucHJvcHMubmFtZSk7XG5cbiAgICBjb25zdCBbYWN0aXZlSW5kZXgsIHNldEFjdGl2ZUluZGV4XSA9IHVzZVN0YXRlKDApO1xuICAgIGNvbnN0IHRhYlNlbGVjdG9yU3R5bGU9e2ZnOicjZmZhYTAwJyxiZzonIzMzMzMzMycsaG92ZXI6e2JnOicjZmZkZDg4JyxmZzonIzMzMzMzMyd9fVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCB7Li4uYm94UHJvcHN9PlxuICAgICAgICA8R3JpZCByb3dzPXsxfSBjb2xzPXs2fSBoaWRlQm9yZGVyPlxuICAgICAgICAgICAgey8qIFRhYiBsaXN0ICovfVxuICAgICAgICAgICAgPGJveCByb3c9ezB9IGNvbD17MH0gcm93U3Bhbj17MX0gY29sU3Bhbj17MX0+XG4gICAgICAgICAgICAgICAge3RhYnMubWFwKCh0YWIsIGkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBrZXk9e3RhYi5wcm9wcy5uYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvcD17aSAqIDN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaGVpZ2h0PXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhZ3M9e2ZhbHNlfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXRBY3RpdmVJbmRleChpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFic1tpXS5wcm9wcy5vblRhYkNsaWNrKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfWNhdGNoKGVycil7fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3R5bGU9e3suLi50YWJTZWxlY3RvclN0eWxlLCBpbnZlcnNlOiAoYWN0aXZlSW5kZXggPT0gaSl9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ9eydcXG4gJyt0YWIucHJvcHMubmFtZX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICB9KX1cbiAgICAgICAgICAgIDwvYm94PlxuXG4gICAgICAgICAgICB7LyogQWN0aXZlIHRhYiBwYW5lbCAqL31cbiAgICAgICAgICAgIDxib3ggcm93PXswfSBjb2w9ezF9IHJvd1NwYW49ezF9IGNvbFNwYW49ezV9PlxuICAgICAgICAgICAgICAgIHt0YWJzW2FjdGl2ZUluZGV4XS5wcm9wcy5jaGlsZHJlbn1cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L0dyaWQ+XG4gICAgICAgIDwvYm94PlxuICAgICk7XG59XG5cbi8qKlxuICogSnVzdCBhIHNlbWFudGljIHdyYXBwZXIgdG8gY2FycnkgdGhlIGBuYW1lYCBwcm9wXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBUYWIoeyBjaGlsZHJlbiB9KSB7XG4gICAgcmV0dXJuIDw+e2NoaWxkcmVufTwvPjtcbn1cbiIsImltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQge2dldE5hbWVkVG9rZW5pemVyLCBUb2tlbml6ZXJUb2tlbn0gZnJvbSAnLi90b2tlbml6ZXIuanMnO1xuaW1wb3J0IHtzYWZlU3RyaW5naWZ5fSBmcm9tIFwiLi91dGlsXCI7XG5pbXBvcnQgeyBjb3B5LCBwYXN0ZSB9IGZyb20gJ2NvcHktcGFzdGUnO1xuXG4vLyB0ZXN0IHRlc3RcbmV4cG9ydCBjbGFzcyBSZWN0YW5nbGV7XG4gIHg9LTFcbiAgeT0tMVxuICB3PS0xXG4gIGg9LTFcblxuICAvKipcbiAgICpcbiAgICogQHBhcmFtIHtudW1iZXJ9IHhcbiAgICogQHBhcmFtIHtudW1iZXJ9IHlcbiAgICogQHBhcmFtIHtudW1iZXJ9IHdcbiAgICogQHBhcmFtIHtudW1iZXJ9IGhcbiAgICovXG4gIGNvbnN0cnVjdG9yKHgseSx3LGgpe1xuICAgIHRoaXMueCA9IHhcbiAgICB0aGlzLnkgPSB5XG4gICAgdGhpcy53ID0gd1xuICAgIHRoaXMuaCA9IGhcbiAgfVxuXG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0ge0NvZGVCdWZmZXJFZGl0b3J9IGVkaXRvclxuICAgKi9cbiAgc3RhdGljIGZyb21FZGl0b3IoZWRpdG9yKSB7XG4gICAgcmV0dXJuIG5ldyBSZWN0YW5nbGUoZWRpdG9yLnZpZXdwb3J0WCwgZWRpdG9yLnZpZXdwb3J0WSwgZWRpdG9yLnZpZXdwb3J0V2lkdGgsIGVkaXRvci52aWV3cG9ydEhlaWdodClcbiAgfVxufVxuLy8gc29tZSB0ZXN0ICAgIG11bHRpcGxlIHNwYWNlc1xuZXhwb3J0IGNsYXNzIEN1cnNvclBvaW50e1xuICB4PS0xXG4gIHk9LTFcbiAgY2hhcj0nLSdcbiAgc3R5bGU9e31cbiAgY29uc3RydWN0b3IoeCx5LGNoYXIsc3R5bGUpe1xuICAgIHRoaXMueD14fHwtMVxuICAgIHRoaXMueT15fHwtMVxuICAgIHRoaXMuY2hhcj1jaGFyfHwnLSdcbiAgICB0aGlzLnN0eWxlPXN0eWxlfHx7fVxuICB9XG4gIGxvb2t1cCh0b2tlbnMpe1xuICAgIGNvbnN0IGxpbmVPZlRva2VucyA9IHRva2Vuc1t0aGlzLnldXG4gICAgY29uc3QgdGsgPSBsaW5lT2ZUb2tlbnMubWF0Y2godGsgPT4gdGsuc3RhcnQ8PXRoaXMueCAmJiB0aGlzLng8PXRrLmVuZClcbiAgICByZXR1cm4gdGtcbiAgfVxuXG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0ge1JlY3RhbmdsZX0gdmlzaWJsZUFyZWFcbiAgICogQHJldHVybnMgYm9vbGVhblxuICAgKi9cbiAgaXNWaXNpYmxlKHZpc2libGVBcmVhKXtcbiAgICByZXR1cm4gdGhpcy54Pj12aXNpYmxlQXJlYS54ICYmIHRoaXMueCA8PSAodmlzaWJsZUFyZWEueCArIHZpc2libGVBcmVhLncpICYmXG4gICAgICAgIHRoaXMueT49dmlzaWJsZUFyZWEueSAmJiB0aGlzLnkgPD0gKHZpc2libGVBcmVhLnkrdmlzaWJsZUFyZWEuaClcbiAgfVxuICBjb3B5KCl7XG4gICAgY29uc3QgY3AgPSBuZXcgQ3Vyc29yUG9pbnQoKVxuICAgIGNwLnggPSB0aGlzLnhcbiAgICBjcC55ID0gdGhpcy55XG4gICAgY3AuY2hhciA9IHRoaXMuY2hhclxuICAgIGNwLnN0eWxlID0gey4uLnRoaXMuc3R5bGV9XG4gICAgcmV0dXJuIGNwXG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIENvZGVCdWZmZXJFZGl0b3JTZWxlY3Rpb257XG4gIHN0YXJ0PSBuZXcgQ3Vyc29yUG9pbnQoKVxuICBlbmQ9IG5ldyBDdXJzb3JQb2ludCgpXG5cbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSB7Q3Vyc29yUG9pbnR9IHN0YXJ0XG4gICAqL1xuICBjb25zdHJ1Y3RvcihzdGFydCkge1xuICAgIHRoaXMuc3RhcnQ9c3RhcnQuY29weSgpXG4gIH1cblxuICAvKipcbiAgICpcbiAgICogQHBhcmFtIHtSZWN0YW5nbGV9IHZpc2libGVBcmVhXG4gICAqIEByZXR1cm5zIGJvb2xlYW5cbiAgICovXG4gIGlzVmlzaWJsZSh2aXNpYmxlQXJlYSl7XG4gICAgcmV0dXJuIHRoaXMuc3RhcnQuaXNWaXNpYmxlKHZpc2libGVBcmVhKSB8fCB0aGlzLmVuZC5pc1Zpc2libGUodmlzaWJsZUFyZWEpXG4gIH1cblxuXG5cbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSB7Q3Vyc29yUG9pbnR9IHZhbFxuICAgKi9cbiAgc2V0RW5kKHZhbCl7XG4gICAgLy8gY29uc3Qgc3RhcnQgPSB0aGlzLnN0YXJ0LmNvcHkoKVxuICAgIC8vIGNvbnN0IGVuZCA9IHZhbC5jb3B5KClcbiAgICAvLyBjb25zdCBtaW5feD1NYXRoLm1pbihzdGFydC54LGVuZC54KVxuICAgIC8vIGNvbnN0IG1pbl95PU1hdGgubWluKHN0YXJ0LnksZW5kLnkpXG4gICAgLy8gY29uc3QgbWF4X3g9TWF0aC5tYXgoc3RhcnQueCxlbmQueClcbiAgICAvLyBjb25zdCBtYXhfeT1NYXRoLm1heChzdGFydC55LGVuZC55KVxuICAgIC8vIHN0YXJ0Lng9bWluX3hcbiAgICAvLyBzdGFydC55PW1pbl95XG4gICAgLy8gZW5kLng9bWF4X3hcbiAgICAvLyBlbmQueT1tYXhfeVxuICAgIC8vIHRoaXMuc3RhcnQgPSBzdGFydFxuICAgIC8vIHRoaXMuZW5kID0gZW5kXG4gICAgdGhpcy5lbmQgPSB2YWxcbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgY29weSgpe1xuICAgIGNvbnN0IGNwID0gbmV3IENvZGVCdWZmZXJFZGl0b3JTZWxlY3Rpb24odGhpcy5zdGFydC5jb3B5KCkpXG4gICAgY3Auc2V0RW5kKHRoaXMuZW5kKVxuICAgIHJldHVybiBjcFxuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBDb2RlQnVmZmVyRWRpdG9yIHtcbiAgLyoqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aFxuICAgKiBAcGFyYW0ge3tyb3dzOm51bWJlciwgY29sczpudW1iZXJ9fSB3aW5kb3dTaXplXG4gICAqL1xuICBjb25zdHJ1Y3RvcihmaWxlUGF0aCwgd2luZG93U2l6ZSkge1xuICAgIHRoaXMuZmlsZVBhdGggICAgICAgID0gZmlsZVBhdGg7XG4gICAgdGhpcy52aWV3cG9ydFkgID0gMDtcbiAgICB0aGlzLnZpZXdwb3J0WCAgPSAwO1xuICAgIHRoaXMudmlld3BvcnRIZWlnaHQgICAgICA9IHdpbmRvd1NpemUucm93cztcbiAgICB0aGlzLnZpZXdwb3J0V2lkdGggICAgICA9IHdpbmRvd1NpemUuY29scztcbiAgICB0aGlzLmxpbmVzICAgICAgICAgICA9IFtdO1xuICAgIHRoaXMudG9rZW5zPVtdXG4gICAgdGhpcy50b2tlbml6ZXI9ZnVuY3Rpb24obGluZSxsaW5lTnVtYmVyKXtcbiAgICAgIHJldHVybiBsaW5lLnNwbGl0KFwiIFwiKS5mbGF0TWFwKG4gPT4gW24sJyAnXSlcbiAgICB9XG4gICAgdGhpcy5fdG91dDAwMCAgICAgICAgICAgICA9IDBcbiAgICB0aGlzLl9zYXZlZCAgICAgICAgICAgPSAnJ1xuXG4gICAgdGhpcy5zZXRGaWxlUGF0aChmaWxlUGF0aClcbiAgICAvKipcbiAgICAgKlxuICAgICAqIEB0eXBlIHtDdXJzb3JQb2ludFtdfVxuICAgICAqL1xuICAgIHRoaXMuY3Vyc29ycz1bXVxuICAgIHRoaXMuc2VsZWN0U3RhcnQ9bnVsbFxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge0NvZGVCdWZmZXJFZGl0b3JTZWxlY3Rpb25bXX1cbiAgICAgKi9cbiAgICB0aGlzLnNlbGVjdGlvbnM9W11cbiAgfVxuICBzZXRGaWxlUGF0aChmaWxlUGF0aCl7XG4gICAgY29uc3QgcHMgPSB0aGlzLmZpbGVQYXRoLnNwbGl0KCcuJylcbiAgICB0aGlzLnRva2VuaXplciA9IGdldE5hbWVkVG9rZW5pemVyKHBzW3BzLmxlbmd0aC0xXSlcbiAgICB0aGlzLmZpbGVQYXRoICAgICAgICA9IGZpbGVQYXRoO1xuICAgIHRoaXMubGluZXM9ZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLHtlbmNvZGluZzondXRmLTgnfSkuc3BsaXQoJ1xcbicpXG4gICAgdGhpcy51cGRhdGVUb2tlbnMoKVxuICB9XG4gIHNhdmUoKXtcbiAgICBjbGVhclRpbWVvdXQodGhpcy5fdG91dDAwMClcbiAgICB0aGlzLl90b3V0MDAwID0gc2V0VGltZW91dCgoKT0+e1xuICAgICAgZnMud3JpdGVGaWxlU3luYyh0aGlzLmZpbGVQYXRoLHRoaXMubGluZXMuam9pbignXFxuJykpXG4gICAgICB0aGlzLl9zYXZlZCA9IGBzYXZlZCAke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1gXG4gICAgfSwxMDAwKVxuICB9XG5cbiAgLy8g4pSA4pSAIHByaXZhdGUg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgc2Nyb2xsVmlld3BvcnQobikge1xuICAgIGxldCBuZXh0WT10aGlzLnZpZXdwb3J0WStuXG4gICAgbGV0IG1heFkgPSB0aGlzLmxpbmVzLmxlbmd0aCAtIDFcbiAgICBpZiAobmV4dFkgPCAwKSB7XG4gICAgICB0aGlzLnZpZXdwb3J0WT0wO1xuICAgIH0gZWxzZSBpZiAoIChuZXh0WSArdGhpcy52aWV3cG9ydEhlaWdodCkgID4gbWF4WSkge1xuICAgICAgdGhpcy52aWV3cG9ydFk9bWF4WS10aGlzLnZpZXdwb3J0SGVpZ2h0O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnZpZXdwb3J0WSA9IG5leHRZXG4gICAgfVxuICB9XG4gIF9lbnN1cmVDdXJzb3JJblZpZXcoY3Vyc29yKSB7XG4gICAgaWYgKGN1cnNvci55IDwgdGhpcy52aWV3cG9ydFkpIHtcbiAgICAgIHRoaXMudmlld3BvcnRZID0gY3Vyc29yLnk7XG4gICAgfSBlbHNlIGlmIChjdXJzb3IueSA+PSAodGhpcy52aWV3cG9ydFkgKyB0aGlzLnZpZXdwb3J0SGVpZ2h0KSkge1xuICAgICAgdGhpcy52aWV3cG9ydFkgPSBjdXJzb3IueSAtIHRoaXMudmlld3BvcnRIZWlnaHQ7XG4gICAgfVxuICAgIGlmIChjdXJzb3IueCA8IHRoaXMudmlld3BvcnRYKSB7XG4gICAgICB0aGlzLnZpZXdwb3J0WCA9IGN1cnNvci54O1xuICAgIH0gZWxzZSBpZiAoY3Vyc29yLnggPj0gdGhpcy52aWV3cG9ydFggKyB0aGlzLnZpZXdwb3J0V2lkdGgpIHtcbiAgICAgIHRoaXMudmlld3BvcnRYID0gY3Vyc29yLnggLSB0aGlzLnZpZXdwb3J0V2lkdGg7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSBsaW5lTnVtYmVyXG4gICAqL1xuICB1cGRhdGVUb2tlbnNMaW5lKGxpbmVOdW1iZXIpe1xuICAgIHRoaXMudG9rZW5zW2xpbmVOdW1iZXJdPXRoaXMudG9rZW5pemVyKHRoaXMubGluZXNbbGluZU51bWJlcl0sIGxpbmVOdW1iZXIpXG4gIH1cbiAgLyoqXG4gICAqXG4gICAqL1xuICB1cGRhdGVUb2tlbnMoKXtcbiAgICB0aGlzLnRva2Vucz10aGlzLmxpbmVzLm1hcCgobGluZSxsaW5lTnVtYmVyKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy50b2tlbml6ZXIobGluZSwgbGluZU51bWJlcilcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0geFxuICAgKiBAcGFyYW0geVxuICAgKiBAcmV0dXJucyB7Q3Vyc29yUG9pbnR9XG4gICAqL1xuICBnZXRDdXJzb3Ioe3gseX0pe1xuICAgIGxldCBjcnMgPSBuZXcgQ3Vyc29yUG9pbnQoKVxuICAgIC8vIGNsYW1wIHgseVxuICAgIHk9eTwwPzA6KHk+KHRoaXMubGluZXMubGVuZ3RoLTEpPyh0aGlzLmxpbmVzLmxlbmd0aC0xKTp5KVxuICAgIGNvbnN0IGxpbmU9dGhpcy5saW5lc1t5XVxuICAgIHg9eDwwPzA6KHg+KGxpbmUubGVuZ3RoKT8obGluZS5sZW5ndGgpOngpXG4gICAgeD1wYXJzZUludCh4KVxuICAgIHk9cGFyc2VJbnQoeSlcbiAgICBjcnMueD14XG4gICAgY3JzLnk9eVxuXG4gICAgY29uc3QgdG9rZW5zID0gWy4uLnRoaXMudG9rZW5zW3ldXVxuICAgIGlmKHRva2Vucy5sZW5ndGggPT09IDAgfHwgeCA9PT0gbGluZS5sZW5ndGgpIHtcbiAgICAgIGNycy5jaGFyPScgJ1xuICAgICAgY3JzLnN0eWxlPXtmZzpcIiNmZjAwMDBcIixiZzpcIiNmZmZmNDRcIn1cbiAgICAgIHJldHVybiBjcnNcbiAgICB9XG5cbiAgICAvLyAzKSBzY2FuIHRva2VucyB0byBmaW5kIHdoaWNoIG9uZSBjb3ZlcnMgY29sSW5XaW5kb3dcbiAgICBjcnMuY2hhciA9IHRoaXMubGluZXNbeV1beF1cbiAgICBjb25zdCB0a0xvb2t1cCA9IHRva2Vucy5maWx0ZXIodCA9PiAoICggeCA+PSBwYXJzZUludCh0LnN0YXJ0KSApICYmICggeCA8PSBwYXJzZUludCh0LmVuZCkgKSApIClcbiAgICBpZih0a0xvb2t1cC5sZW5ndGggPT09IDApe1xuICAgICAgY3JzLnN0eWxlID0ge2ZnOlwiI2ZmMDAwMFwiLGJnOlwiI2ZmZmY0NFwifVxuICAgICAgdGhyb3cgbmV3IEVycm9yKHNhZmVTdHJpbmdpZnkoe21zZzpcIm5vIHRva2VuXCIseCx5LHRrTG9va3VwLHRva2Vuc30pKVxuICAgIH1lbHNle1xuICAgICAgdHJ5e1xuICAgICAgICBjcnMuc3R5bGUgPSB0a0xvb2t1cFswXS5zdHlsZVxuICAgICAgfWNhdGNoIChlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihzYWZlU3RyaW5naWZ5KHttc2c6XCJubyB0b2tlbiBzdHlsZVwiLHgseSx0a0xvb2t1cCx0b2tlbnN9KSlcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGNyc1xuICB9XG4gIC8qKlxuICAqIEBwYXJhbSB7KGNvZGU6c3RyaW5nKT0+VG9rZW5pemVyVG9rZW5bXX0gdG9rZW5pemVyXG4gICogQHJldHVybnMge3tbbGluZU51bWJlcjpzdHJpbmddOlRva2VuaXplclRva2VuW119fVxuICAqXG4gICogKi9cbiAgcmVuZGVyVmlld3BvcnQoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMudG9rZW5zKS5yZWR1Y2UoXG4gICAgICAodmlzaWJsZSxsaW5lSWQpID0+IHtcbiAgICAgICAgY29uc3QgbGluZU51bWJlcj1wYXJzZUludChsaW5lSWQpXG4gICAgICAgIGlmKGxpbmVOdW1iZXI+PXRoaXMudmlld3BvcnRZICYmIGxpbmVOdW1iZXI8PSh0aGlzLnZpZXdwb3J0WSt0aGlzLnZpZXdwb3J0SGVpZ2h0KSl7XG4gICAgICAgICAgdmlzaWJsZVtsaW5lSWRdPXRoaXMudG9rZW5zW2xpbmVJZF1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdmlzaWJsZVxuICAgICAgfSxcbiAgICAgIHt9XG4gICAgKVxuICB9XG5cbiAgb25Nb3VzZShzY3JlZW5FdmVudCx2aWV3cG9ydFBvc2l0aW9uKXtcbiAgICBjb25zdCBUSElTID0gdGhpc1xuICAgIGxldCBoYXNDaGFuZ2VkPWZhbHNlXG4gICAgbGV0IG11c3RSZW5kZXI9ZmFsc2VcbiAgICBjb25zdCBjbGlja3MgPSBBcnJheS5mcm9tKHNjcmVlbkV2ZW50LmJ1Znx8W10pLmZpbHRlcih2ID0+IHYgPT09IDc3KS5sZW5ndGhcbiAgICBzd2l0Y2goc2NyZWVuRXZlbnQuYWN0aW9uKXtcbiAgICAgIGNhc2UgJ21vdXNlZG93bic6IHtcbiAgICAgICAgICBjb25zdCBwYWRMZW5ndGggPSBNYXRoLmNlaWwoTWF0aC5sb2cxMCh0aGlzLnZpZXdwb3J0SGVpZ2h0ICsgdGhpcy52aWV3cG9ydFkpKSArIDFcbiAgICAgICAgICBjb25zdCB7eGksIHlpfSA9IHZpZXdwb3J0UG9zaXRpb247XG4gICAgICAgICAgY29uc3Qge3gsIHl9ID0gc2NyZWVuRXZlbnQ7XG4gICAgICAgICAgY29uc3QgY3Vyc29yID0ge3g6ICh4IC0geGkgLSBwYWRMZW5ndGggLSAxIC0gMSAtIDEgKyB0aGlzLnZpZXdwb3J0WCksIHk6ICh5IC0geWkgLSAxICsgdGhpcy52aWV3cG9ydFkpfVxuICAgICAgICAgIGNvbnN0IGNycyA9IHRoaXMuZ2V0Q3Vyc29yKGN1cnNvcilcbiAgICAgICAgICB0aGlzLnNlbGVjdFN0YXJ0ID0gbmV3IENvZGVCdWZmZXJFZGl0b3JTZWxlY3Rpb24oY3JzKVxuICAgICAgICAgIHRoaXMuc2VsZWN0U3RhcnQuc2V0RW5kKGNycylcbiAgICAgICAgICBpZiAoc2NyZWVuRXZlbnQubWV0YSkge1xuICAgICAgICAgICAgdGhpcy5jdXJzb3JzLnB1c2goY3JzKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmN1cnNvcnMgPSBbY3JzXVxuICAgICAgICAgIH1cbiAgICAgICAgICBoYXNDaGFuZ2VkID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnbW91c2Vtb3ZlJzoge1xuICAgICAgICAgIGNvbnN0IHBhZExlbmd0aCA9IE1hdGguY2VpbChNYXRoLmxvZzEwKHRoaXMudmlld3BvcnRIZWlnaHQgKyB0aGlzLnZpZXdwb3J0WSkpICsgMVxuICAgICAgICAgIGNvbnN0IHt4aSwgeWl9ID0gdmlld3BvcnRQb3NpdGlvbjtcbiAgICAgICAgICBjb25zdCB7eCwgeX0gPSBzY3JlZW5FdmVudDtcbiAgICAgICAgICBjb25zdCBjdXJzb3IgPSB7eDogKHggLSB4aSAtIHBhZExlbmd0aCAtIDEgLSAxIC0gMSArIHRoaXMudmlld3BvcnRYKSwgeTogKHkgLSB5aSAtIDEgKyB0aGlzLnZpZXdwb3J0WSl9XG4gICAgICAgICAgY29uc3QgY3JzID0gdGhpcy5nZXRDdXJzb3IoY3Vyc29yKVxuICAgICAgICAgIGlmICh0aGlzLnNlbGVjdFN0YXJ0KSB7XG4gICAgICAgICAgICB0aGlzLnNlbGVjdFN0YXJ0LnNldEVuZChjcnMpXG4gICAgICAgICAgfVxuICAgICAgICAgIG11c3RSZW5kZXI9dHJ1ZVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnbW91c2V1cCc6IHtcbiAgICAgICAgICBpZih0aGlzLnNlbGVjdFN0YXJ0KXtcbiAgICAgICAgICAgIGlmIChzY3JlZW5FdmVudC5tZXRhKSB7XG4gICAgICAgICAgICAgIHRoaXMuc2VsZWN0aW9ucy5wdXNoKHRoaXMuc2VsZWN0U3RhcnQuY29weSgpKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhpcy5zZWxlY3Rpb25zPVt0aGlzLnNlbGVjdFN0YXJ0LmNvcHkoKV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgaGFzQ2hhbmdlZCA9IHRydWVcbiAgICAgICAgICB0aGlzLnNlbGVjdFN0YXJ0ID0gbnVsbFxuICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3doZWVsdXAnOlxuICAgICAgICB0aGlzLnNjcm9sbFZpZXdwb3J0KC1jbGlja3MpXG4gICAgICAgIG11c3RSZW5kZXI9dHJ1ZVxuICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd3aGVlbGRvd24nOlxuICAgICAgICB0aGlzLnNjcm9sbFZpZXdwb3J0KGNsaWNrcylcbiAgICAgICAgbXVzdFJlbmRlcj10cnVlXG4gICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6IHRocm93IG5ldyBFcnJvcihzYWZlU3RyaW5naWZ5KHNjcmVlbkV2ZW50KSk7IGJyZWFrO1xuICAgIH1cbiAgICByZXR1cm4gW2hhc0NoYW5nZWQsbXVzdFJlbmRlcl1cbiAgfVxuICBvbktleShjaCxrZXksb25DaGFuZ2U9KCk9Pnt9KXtcbiAgY29uc3QgVEhJUyA9IHRoaXNcbiAgbGV0IGhhc0NoYW5nZWQ9ZmFsc2VcbiAgbGV0IG11c3RSZW5kZXI9ZmFsc2VcbiAgICBzd2l0Y2ggKGtleS5mdWxsKSB7XG4gICAgICBjYXNlICd1cCc6XG4gICAgICAgIHRoaXMuY3Vyc29ycz10aGlzLmN1cnNvcnMubWFwKGNycyA9PiBUSElTLm1vdmVDdXJzb3JVcChjcnMpKTtcbiAgICAgICAgbXVzdFJlbmRlcj10cnVlXG4gICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2Rvd24nOlxuICAgICAgICB0aGlzLmN1cnNvcnM9dGhpcy5jdXJzb3JzLm1hcChjcnMgPT4gVEhJUy5tb3ZlQ3Vyc29yRG93bihjcnMpKTtcbiAgICAgICAgbXVzdFJlbmRlcj10cnVlXG4gICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2xlZnQnOlxuICAgICAgICBpZihrZXkuY3RybCl7XG4gICAgICAgICAgdGhpcy5jdXJzb3JzPXRoaXMuY3Vyc29ycy5tYXAoY3JzID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGxpbmUgPSB0aGlzLmxpbmVzW2Nycy55XVxuICAgICAgICAgICAgaWYoKChjcnMueC0xKT4wKSAmJiBsaW5lW2Nycy54LTFdID09PSAnICcpe1xuICAgICAgICAgICAgICBjcnMueC09MlxuICAgICAgICAgICAgICByZXR1cm4gY3JzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB3aGlsZShjcnMueD49MCkge1xuICAgICAgICAgICAgICBpZihsaW5lW2Nycy54XSA9PT0gJyAnIHx8IGNycy54ID09PSAwKXtcbiAgICAgICAgICAgICAgICBjcnMueCs9KGNycy54ID09PSAwPzA6MSlcbiAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGNycy54LT0xXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gY3JzXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgIHRoaXMuY3Vyc29ycz10aGlzLmN1cnNvcnMubWFwKGNycyA9PiBUSElTLm1vdmVDdXJzb3JMZWZ0KGNycykpO1xuICAgICAgICB9XG4gICAgICAgIG11c3RSZW5kZXI9dHJ1ZVxuICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdyaWdodCc6XG4gICAgICAgIGlmKGtleS5jdHJsKXtcbiAgICAgICAgICB0aGlzLmN1cnNvcnM9dGhpcy5jdXJzb3JzLm1hcChjcnMgPT4ge1xuICAgICAgICAgICAgY29uc3QgbGluZSA9IHRoaXMubGluZXNbY3JzLnldXG4gICAgICAgICAgICBpZigoKGNycy54KzEpPGxpbmUubGVuZ3RoKSAmJiBsaW5lW2Nycy54KzFdID09PSAnICcpe1xuICAgICAgICAgICAgICBjcnMueCs9MlxuICAgICAgICAgICAgICByZXR1cm4gY3JzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB3aGlsZShjcnMueDxsaW5lLmxlbmd0aCkge1xuICAgICAgICAgICAgICBpZihsaW5lW2Nycy54XSA9PT0gJyAnKXtcbiAgICAgICAgICAgICAgICBjcnMueC09MVxuICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgY3JzLngrPTFcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBjcnNcbiAgICAgICAgICB9KTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgdGhpcy5jdXJzb3JzPXRoaXMuY3Vyc29ycy5tYXAoY3JzID0+IFRISVMubW92ZUN1cnNvclJpZ2h0KGNycykpO1xuICAgICAgICB9XG4gICAgICAgIG11c3RSZW5kZXI9dHJ1ZVxuICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdob21lJzpcbiAgICAgICAgdGhpcy5jdXJzb3JzPXRoaXMuY3Vyc29ycy5tYXAoY3JzID0+IFRISVMuZ2V0Q3Vyc29yKHt4OjAseTpjcnMueX0pKTtcbiAgICAgICAgbXVzdFJlbmRlcj10cnVlXG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZW5kJzpcbiAgICAgICAgdGhpcy5jdXJzb3JzPXRoaXMuY3Vyc29ycy5tYXAoY3JzID0+IFRISVMuZ2V0Q3Vyc29yKHt4OnRoaXMubGluZXNbY3JzLnldLmxlbmd0aCx5OmNycy55fSkpO1xuICAgICAgICBtdXN0UmVuZGVyPXRydWVcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdwYWdldXAnOlxuICAgICAgICB0aGlzLnNjcm9sbFZpZXdwb3J0KC10aGlzLnZpZXdwb3J0SGVpZ2h0KTtcbiAgICAgICAgbXVzdFJlbmRlcj10cnVlXG4gICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3BhZ2Vkb3duJzpcbiAgICAgICAgdGhpcy5zY3JvbGxWaWV3cG9ydCh0aGlzLnZpZXdwb3J0SGVpZ2h0KTtcbiAgICAgICAgbXVzdFJlbmRlcj10cnVlXG4gICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2JhY2tzcGFjZSc6XG4gICAgICAgIHRoaXMuY3Vyc29ycy5mb3JFYWNoKGNycyA9PiBUSElTLmJhY2tzcGFjZShjcnMpKVxuICAgICAgICB0aGlzLnNhdmUoKTtcbiAgICAgICAgaGFzQ2hhbmdlZD10cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICAgIHRoaXMuY3Vyc29ycy5mb3JFYWNoKGNycyA9PiBUSElTLmRlbGV0ZShjcnMpKVxuICAgICAgICB0aGlzLnNhdmUoKTtcbiAgICAgICAgaGFzQ2hhbmdlZD10cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3JldHVybic6XG4gICAgICAgIHRoaXMuY3Vyc29yc1xuICAgICAgICAgICAgLnRvU29ydGVkKChhLGIpID0+IChhLnktYi55KSlcbiAgICAgICAgICAgIC5mb3JFYWNoKChjcnMseSkgPT4ge1xuICAgICAgICAgICAgICBjcnMueSs9eVxuICAgICAgICAgICAgICBUSElTLmluc2VydChcIlxcblwiLCBjcnMpXG4gICAgICAgICAgICAgIGNycy55Kz0xXG4gICAgICAgICAgICAgIGNycy54PTBcbiAgICAgICAgICAgIH0pXG4gICAgICAgIHRoaXMuc2F2ZSgpO1xuICAgICAgICBoYXNDaGFuZ2VkPXRydWU7XG4gICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3RhYic6XG4gICAgICAgIHRoaXMuY3Vyc29yc1xuICAgICAgICAgICAgLnRvU29ydGVkKChhLGIpID0+IChhLnktYi55KSlcbiAgICAgICAgICAgIC5mb3JFYWNoKChjcnMseSkgPT4ge1xuICAgICAgICAgICAgICBUSElTLmluc2VydChcIlxcdFwiLCBjcnMpXG4gICAgICAgICAgICB9KVxuICAgICAgICB0aGlzLnNhdmUoKTtcbiAgICAgICAgaGFzQ2hhbmdlZD10cnVlO1xuICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdDLWMnOntcbiAgICAgICAgY29weSh0aGlzLnNlbGVjdGlvbnMuZmxhdE1hcChzID0+IHtcbiAgICAgICAgICBjb25zdCBsaW5lcz1bXVxuICAgICAgICAgIGZvcihsZXQgeT1zLnN0YXJ0Lnk7eTw9cy5lbmQueTt5Kyspe1xuICAgICAgICAgICAgbGluZXMucHVzaCh0aGlzLmxpbmVzW3ldLnN1YnN0cmluZyhzLnN0YXJ0Lngscy5lbmQueCsxKSlcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIGxpbmVzXG4gICAgICAgIH0pLmpvaW4oXCJcXG5cIiksIChlcnIsIHRleHQpID0+IHtcbiAgICAgICAgICAvLyBcInNvbWUgdGV4dFwiIGlzIGluIHlvdXIgY2xpcGJvYXJkXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdDLXAnOntcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwicGFzdGUgb3BlcmF0aW9uIG5vdCBpbXBsZW1lbnRlZFwiKVxuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAoY2ggJiYgY2gubGVuZ3RoID4gMCAvKiAmJiAha2V5LmN0cmwgJiYgIWtleS5tZXRhKi8pe1xuICAgICAgICAgIGlmKGtleS5zZXF1ZW5jZSAmJiBrZXkuc2VxdWVuY2UubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICB0aGlzLmN1cnNvcnMuZm9yRWFjaChjcnMgPT4gVEhJUy5pbnNlcnQoa2V5LnNlcXVlbmNlLGNycykpXG4gICAgICAgICAgICB0aGlzLnNhdmUoKTtcbiAgICAgICAgICAgIGhhc0NoYW5nZWQ9dHJ1ZTtcbiAgICAgICAgICB9IGVsc2UgaWYoa2V5Lm5hbWUgJiYga2V5Lm5hbWUubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICB0aGlzLmN1cnNvcnMuZm9yRWFjaChjcnMgPT4gVEhJUy5pbnNlcnQoa2V5Lm5hbWUsY3JzKSlcbiAgICAgICAgICAgIHRoaXMuc2F2ZSgpO1xuICAgICAgICAgICAgaGFzQ2hhbmdlZD10cnVlO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmN1cnNvcnMuZm9yRWFjaChjcnMgPT4gVEhJUy5pbnNlcnQoY2gsY3JzKSlcbiAgICAgICAgICAgIGhhc0NoYW5nZWQ9dHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIFtoYXNDaGFuZ2VkLG11c3RSZW5kZXJdXG4gIH1cblxuICAvKipcbiAgICpcbiAgICogQHBhcmFtIHtDdXJzb3JQb2ludH0gY3Vyc29yXG4gICAqIEByZXR1cm5zIHtDdXJzb3JQb2ludH1cbiAgICovXG4gIG1vdmVDdXJzb3JVcChjdXJzb3IpIHtcbiAgICBpZiAoY3Vyc29yLnkgPiAwKSB7XG4gICAgICBjdXJzb3IueS0tO1xuICAgICAgY29uc3QgbGluZSA9IHRoaXMubGluZXNbY3Vyc29yLnldXG4gICAgICBpZiAoY3Vyc29yLnggPj0gbGluZS5sZW5ndGgpIHtcbiAgICAgICAgY3Vyc29yLnggPSBsaW5lLmxlbmd0aFxuICAgICAgfVxuICAgICAgdGhpcy5fZW5zdXJlQ3Vyc29ySW5WaWV3KGN1cnNvcik7XG4gICAgfVxuICAgIHJldHVybiBjdXJzb3JcbiAgfVxuXG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0ge0N1cnNvclBvaW50fSBjdXJzb3JcbiAgICogQHJldHVybnMge0N1cnNvclBvaW50fVxuICAgKi9cbiAgbW92ZUN1cnNvckRvd24oY3Vyc29yKSB7XG4gICAgaWYgKChjdXJzb3IueSsxKSA8IHRoaXMubGluZXMubGVuZ3RoKSB7XG4gICAgICBpZiAoY3Vyc29yLnggPj0gdGhpcy5saW5lc1tjdXJzb3IueSsxXS5sZW5ndGgpIHtcbiAgICAgICAgY3Vyc29yLnggPSB0aGlzLmxpbmVzW2N1cnNvci55KzFdLmxlbmd0aFxuICAgICAgfVxuICAgICAgY3Vyc29yLnkrKztcbiAgICAgIHRoaXMuX2Vuc3VyZUN1cnNvckluVmlldyhjdXJzb3IpO1xuICAgIH1cbiAgICByZXR1cm4gY3Vyc29yXG4gIH1cblxuICAvKipcbiAgICpcbiAgICogQHBhcmFtIHtDdXJzb3JQb2ludH0gY3Vyc29yXG4gICAqIEByZXR1cm5zIHtDdXJzb3JQb2ludH1cbiAgICovXG4gIG1vdmVDdXJzb3JMZWZ0KGN1cnNvcikge1xuICAgIGlmIChjdXJzb3IueCA+IDApIHtcbiAgICAgIGN1cnNvci54LS07XG4gICAgICB0aGlzLl9lbnN1cmVDdXJzb3JJblZpZXcoY3Vyc29yKTtcbiAgICB9XG4gICAgcmV0dXJuIGN1cnNvclxuICB9XG5cbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSB7Q3Vyc29yUG9pbnR9IGN1cnNvclxuICAgKiBAcmV0dXJucyB7Q3Vyc29yUG9pbnR9XG4gICAqL1xuICBtb3ZlQ3Vyc29yUmlnaHQoY3Vyc29yKSB7XG4gICAgY29uc3QgbGluZSA9IHRoaXMubGluZXNbY3Vyc29yLnldXG4gICAgaWYgKGN1cnNvci54IDwgbGluZS5sZW5ndGgpIHtcbiAgICAgIGN1cnNvci54KytcbiAgICB9IGVsc2Uge1xuICAgICAgY3Vyc29yLnggPSBsaW5lLmxlbmd0aFxuICAgIH1cbiAgICB0aGlzLl9lbnN1cmVDdXJzb3JJblZpZXcoY3Vyc29yKVxuICAgIHJldHVybiBjdXJzb3JcbiAgfVxuXG4gIG1vdmVDdXJzb3JWZXJ0aWNhbGx5KG4sY3Vyc29yKXtcbiAgICBpZihuPjApe1xuICAgICAgICBmb3IobGV0IGk9MDtpPG47aSsrKXtcbiAgICAgICAgICAgIHRoaXMubW92ZUN1cnNvckRvd24oY3Vyc29yKVxuICAgICAgICB9XG4gICAgfWVsc2UgaWYobjwwKXtcbiAgICAgICAgZm9yKGxldCBpPW47aTw9MDtpKyspe1xuICAgICAgICAgICAgdGhpcy5tb3ZlQ3Vyc29yVXAoY3Vyc29yKVxuICAgICAgICB9XG4gICAgfVxuICB9XG4gIG1vdmVDdXJzb3JIb3Jpem9udGFsbHkobixjdXJzb3Ipe1xuICAgIGlmKG4+MCl7XG4gICAgICAgIGZvcihsZXQgaT0wO2k8bjtpKyspe1xuICAgICAgICAgICAgdGhpcy5tb3ZlQ3Vyc29yUmlnaHQoY3Vyc29yKVxuICAgICAgICB9XG4gICAgfWVsc2UgaWYobjwwKXtcbiAgICAgICAgZm9yKGxldCBpPW47aTw9MDtpKyspe1xuICAgICAgICAgICAgdGhpcy5tb3ZlQ3Vyc29yTGVmdChjdXJzb3IpXG4gICAgICAgIH1cbiAgICB9XG4gIH1cbiAgLy8g4pSA4pSAIGVkaXRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gIGluc2VydCh0ZXh0LGN1cnNvcikge1xuICAgIGNvbnN0IG9sZExpbmU9dGhpcy5saW5lc1tjdXJzb3IueV1cbiAgICBjb25zdCBiZWZvcmU9b2xkTGluZS5zdWJzdHJpbmcoMCxjdXJzb3IueClcbiAgICBjb25zdCBhZnRlcj1vbGRMaW5lLnN1YnN0cmluZyhjdXJzb3IueClcbiAgICBjb25zdCBuZXdMaW5lPWJlZm9yZSt0ZXh0K2FmdGVyXG4gICAgbGV0IG5ld0xpbmVzPXRoaXMubGluZXMuc2xpY2UoMCxjdXJzb3IueSlcbiAgICBsZXQgb2xkTGluZXNBZnRlcj10aGlzLmxpbmVzLnNsaWNlKGN1cnNvci55KzEpXG4gICAgdGhpcy5saW5lcz1uZXdMaW5lcy5jb25jYXQobmV3TGluZS5zcGxpdCgnXFxuJykpLmNvbmNhdChvbGRMaW5lc0FmdGVyKVxuICAgIGlmKG5ld0xpbmUuaW5kZXhPZihcIlxcblwiKT4tMSl7XG4gICAgICB0aGlzLnVwZGF0ZVRva2VucygpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudXBkYXRlVG9rZW5zTGluZShjdXJzb3IueSlcbiAgICB9XG4gICAgY3Vyc29yLngrK1xuICAgIHRoaXMuX2Vuc3VyZUN1cnNvckluVmlldyhjdXJzb3IpO1xuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBkZWxldGUoY3Vyc29yKSB7XG4gICAgaWYoY3Vyc29yLng9PT10aGlzLmxpbmVzW2N1cnNvci55XS5sZW5ndGgpe1xuICAgICAgbGV0IG5ld0xpbmVzPXRoaXMubGluZXMuc2xpY2UoMCxjdXJzb3IueSlcbiAgICAgIGxldCBjdXJyZW50TGluZT10aGlzLmxpbmVzW2N1cnNvci55XVxuICAgICAgY29uc3QgbmV4dExpbmU9dGhpcy5saW5lc1tjdXJzb3IueSsxXVxuICAgICAgbGV0IHJlc3RMaW5lcz10aGlzLmxpbmVzLnNsaWNlKGN1cnNvci55KzIpXG4gICAgICB0aGlzLmxpbmVzPW5ld0xpbmVzLmNvbmNhdChbY3VycmVudExpbmUrbmV4dExpbmVdKS5jb25jYXQocmVzdExpbmVzKVxuICAgICAgdGhpcy51cGRhdGVUb2tlbnMoKVxuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgbmV3TGluZXM9dGhpcy5saW5lcy5zbGljZSgwLGN1cnNvci55KVxuICAgICAgY29uc3Qgb2xkTGluZT10aGlzLmxpbmVzW2N1cnNvci55XVxuICAgICAgY29uc3QgYmVmb3JlPW9sZExpbmUuc3Vic3RyaW5nKDAsY3Vyc29yLngpXG4gICAgICBjb25zdCBhZnRlcj1vbGRMaW5lLnN1YnN0cmluZyhjdXJzb3IueCsxKVxuICAgICAgY29uc3QgbmV3TGluZT1iZWZvcmUrYWZ0ZXJcbiAgICAgIGxldCBvbGRMaW5lc0FmdGVyPXRoaXMubGluZXMuc2xpY2UoY3Vyc29yLnkrMSlcbiAgICAgIHRoaXMubGluZXM9bmV3TGluZXMuY29uY2F0KG5ld0xpbmUuc3BsaXQoJ1xcbicpKS5jb25jYXQob2xkTGluZXNBZnRlcilcbiAgICAgIHRoaXMudXBkYXRlVG9rZW5zTGluZShjdXJzb3IueSlcbiAgICB9XG4gICAgdGhpcy5fZW5zdXJlQ3Vyc29ySW5WaWV3KGN1cnNvcik7XG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIGJhY2tzcGFjZShjdXJzb3IpIHtcbiAgICBpZiAoY3Vyc29yLng+MCkge1xuICAgICAgY3Vyc29yLngtLTtcbiAgICAgIHRoaXMuZGVsZXRlKGN1cnNvcilcbiAgICB9IGVsc2UgaWYgKGN1cnNvci55PjApIHtcbiAgICAgIGNvbnN0IG5ld0NvbD10aGlzLmxpbmVzW2N1cnNvci55LTFdLmxlbmd0aFxuICAgICAgY3Vyc29yLnktLTtcbiAgICAgIGN1cnNvci54ID0gbmV3Q29sOyAvLyB3aWxsIGNsYW1wIGFmdGVyIHJlYWRpbmcgZnVsbCBsaW5lIG5leHQgdGltZVxuICAgICAgdGhpcy5kZWxldGUoY3Vyc29yKVxuICAgICAgdGhpcy51cGRhdGVUb2tlbnNMaW5lKGN1cnNvci55KVxuICAgIH1cbiAgICB0aGlzLl9lbnN1cmVDdXJzb3JJblZpZXcoY3Vyc29yKTtcbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLy8g4pSA4pSAIGNsb25lIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gIC8qKiByZXR1cm4gYSBuZXcgaW5zdGFuY2Ugd2l0aCBpZGVudGljYWwgc3RhdGUgKi9cbiAgY29weSgpIHtcbiAgICBjb25zdCBjbG9uZSA9IG5ldyBDb2RlQnVmZmVyRWRpdG9yKHRoaXMuZmlsZVBhdGgsIHtcbiAgICAgIHJvd3M6IHRoaXMudmlld3BvcnRIZWlnaHQsXG4gICAgICBjb2xzOiB0aGlzLnZpZXdwb3J0V2lkdGhcbiAgICB9KTtcbiAgICBjbG9uZS5maWxlUGF0aD10aGlzLmZpbGVQYXRoXG4gICAgY2xvbmUudmlld3BvcnRZPXRoaXMudmlld3BvcnRZXG4gICAgY2xvbmUudmlld3BvcnRYPXRoaXMudmlld3BvcnRYXG4gICAgY2xvbmUubGluZXM9dGhpcy5saW5lc1xuICAgIGNsb25lLmN1cnNvcnM9dGhpcy5jdXJzb3JzXG4gICAgY2xvbmUudG9rZW5zPXRoaXMudG9rZW5zXG4gICAgY2xvbmUudG9rZW5pemVyPXRoaXMudG9rZW5pemVyXG4gICAgY2xvbmUuc2VsZWN0aW9ucz10aGlzLnNlbGVjdGlvbnNcbiAgICBjbG9uZS5zZWxlY3RTdGFydD10aGlzLnNlbGVjdFN0YXJ0XG4gICAgY2xvbmUuX3NhdmVkPXRoaXMuX3NhdmVkXG4gICAgcmV0dXJuIGNsb25lO1xuICB9XG4gIGdldFN0YXR1cygpe1xuICAgIGNvbnN0IHJhbmdlPU9iamVjdC5rZXlzKHRoaXMucmVuZGVyVmlld3BvcnQoKSlcbiAgICBjb25zdCBqc29uPXtcbiAgICAgIGN1cnNvcjp0aGlzLmN1cnNvcnMsXG4gICAgICB2Ont4OnRoaXMudmlld3BvcnRYLHk6dGhpcy52aWV3cG9ydFksdzp0aGlzLnZpZXdwb3J0V2lkdGgsaDp0aGlzLnZpZXdwb3J0SGVpZ2h0fSxcbiAgICAgIHM6dGhpcy5fc2F2ZWQsXG4gICAgICBsOnJhbmdlWzBdKycgLi4uICcrcmFuZ2VbcmFuZ2UubGVuZ3RoLTFdXG4gICAgfVxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShqc29uKS5yZXBsYWNlKC9cIi9naSwnJylcbiAgfVxufSIsImltcG9ydCBSZWFjdCwge3VzZUVmZmVjdCwgdXNlUmVmLCB1c2VTdGF0ZX0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHtDb2RlQnVmZmVyRWRpdG9yLCBDdXJzb3JQb2ludCwgUmVjdGFuZ2xlfSBmcm9tICcuL0NvZGVCdWZmZXJFZGl0b3IuanMnO1xuaW1wb3J0IHsgQm94RWxlbWVudCBhcyBib3gsIFRleHRFbGVtZW50IGFzIHRleHQgfSBmcm9tICdyZWFjdC1ibGVzc2VkJztcbmltcG9ydCB7c2FmZVN0cmluZ2lmeX0gZnJvbSBcIi4vdXRpbFwiO1xuXG5cbmV4cG9ydCBmdW5jdGlvbiBDb2RlQnVmZmVyRWRpdG9yQ29tcG9uZW50KHtcbiAgICBmaWxlUGF0aCxcbiAgICBvbktleXByZXNzPShjaCxrZXkpID0+e30sXG4gICAgb25DaGFuZ2UgPSAoe2VkaXRvcixjaCxrZXksc2NyZWVuRXZlbnQsdmlld3BvcnR9KSA9PiB7fSxcbiAgICBvbkV2ZW50ID0gKHtlZGl0b3IsY2gsa2V5LHNjcmVlbkV2ZW50LHZpZXdwb3J0fSkgPT4ge30sXG4gICAgLi4uYm94UHJvcHNcbn0pIHtcbiAgY29uc3QgYm94UmVmID0gdXNlUmVmKCk7XG4gIC8qKlxuICAgKiBAY29uc3RhbnQge1tDb2RlQnVmZmVyRWRpdG9yLChlZDpDb2RlQnVmZmVyRWRpdG9yKT0+dm9pZF19IFtlZGl0b3IsIHNldEVkaXRvcl1cbiAgICovXG5cblx0XG4gIGNvbnN0IFtlZGl0b3IsIHNldEVkaXRvcl0gPSB1c2VTdGF0ZShudWxsKTtcbiAgY29uc3QgW3NpemUsIHNldFNpemVdICAgICA9IHVzZVN0YXRlKHsgcm93czogMTAsIGNvbHM6IDMwIH0pO1xuICBjb25zdFtsYXN0RXZlbnQsc2V0TGFzdEV2ZW50XSA9IHVzZVN0YXRlKHtlZGl0b3I6bnVsbCxjaDpudWxsLGtleTpudWxsLHNjcmVlbkV2ZW50Om51bGwsdmlld3BvcnQ6bnVsbH0pXG5cblxuICAvLyAxKSAoUmUpY3JlYXRlIGVkaXRvciB3aGVuZXZlciBmaWxlUGF0aCBjaGFuZ2VzXG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgaWYgKGZpbGVQYXRoKSB7XG4gICAgICBjb25zdCBlZCA9IG5ldyBDb2RlQnVmZmVyRWRpdG9yKGZpbGVQYXRoLCB7IHJvd3M6IHNpemUucm93cywgY29sczogc2l6ZS5jb2xzIH0pO1xuICAgICAgLy8gaW1tZWRpYXRlbHkgcmVuZGVyIHRoZSBuZXcgZmlsZVxuICAgICAgZWQudmlld3BvcnRIZWlnaHQgPSBzaXplLnJvd3MtMTtcbiAgICAgIGVkLnZpZXdwb3J0V2lkdGggPSBzaXplLmNvbHM7XG4gICAgICBzZXRFZGl0b3IoZWQpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzZXRFZGl0b3IobnVsbCk7XG4gICAgfVxuICB9LCBbZmlsZVBhdGhdKTtcblxuICAvLyAyKSB1cGRhdGUgc2l6ZSBvbiByZXNpemVcbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBib3ggPSBib3hSZWYuY3VycmVudDtcbiAgICBpZiAoIWJveCkgcmV0dXJuO1xuICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IHtcbiAgICAgIHNldFNpemUoeyBjb2xzOiBib3gud2lkdGgsIHJvd3M6IGJveC5oZWlnaHQtMiB9KTtcbiAgICB9O1xuICAgIHVwZGF0ZSgpO1xuICAgIGJveC5vbigncmVzaXplJywgdXBkYXRlKTtcbiAgICByZXR1cm4gKCkgPT4gYm94LnJlbW92ZUxpc3RlbmVyKCdyZXNpemUnLCB1cGRhdGUpO1xuICB9LCBbXSk7XG5cbiAgLy8gcnVuIG9uY2Ugb24gc2l6ZSBjaGFuZ2VcbiAgdXNlRWZmZWN0KCgpPT57XG4gICAgaWYoZWRpdG9yKXtcbiAgICAgIGVkaXRvci52aWV3cG9ydFdpZHRoID0gc2l6ZS5jb2xzO1xuICAgICAgZWRpdG9yLnZpZXdwb3J0SGVpZ2h0ID0gc2l6ZS5yb3dzO1xuICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgfVxuICB9LCBbc2l6ZV0pO1xuICBjb25zdCByZW5kZXJDdXJzb3JzID0gKCk9PntcbiAgICBpZighZWRpdG9yKXtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICA8Ym94IGtleT17YDAtMS1uby1maWxlYH1cbiAgICAgICAgICAgIGxlZnQ9ezR9IHRvcD17MX0gd2lkdGg9ezF9IGhlaWdodD17MX1cbiAgICAgICAgICAgIHN0eWxlPXt7Ymxpbms6dHJ1ZX19XG4gICAgICAgICAgICBjb250ZW50PXsnXyd9XG4gICAgICAgICAgLz5cbiAgICAgICAgKVxuICAgIH1cbiAgICBjb25zdCBwYWRMZW5ndGg9TWF0aC5jZWlsKE1hdGgubG9nMTAoZWRpdG9yLnZpZXdwb3J0SGVpZ2h0K2VkaXRvci52aWV3cG9ydFkpKSsxXG5cbiAgICByZXR1cm4gWy4uLmVkaXRvci5jdXJzb3JzXVxuICAgICAgICAuZmlsdGVyKChjdXJzb3IseSk9PntcbiAgICAgICAgICByZXR1cm4gY3Vyc29yLnk+PWVkaXRvci52aWV3cG9ydFkgJiYgY3Vyc29yLnkgPD0gKGVkaXRvci52aWV3cG9ydFkrZWRpdG9yLnZpZXdwb3J0SGVpZ2h0KVxuICAgICAgICB9KVxuICAgICAgICAubWFwKChjcnMsaWQpPT57XG4gICAgICAgICAgY29uc3QgY3Vyc29yID0gZWRpdG9yLmdldEN1cnNvcih7Li4uY3JzfSlcbiAgICAgICAgICByZXR1cm4gPGJveCBrZXk9e2BjdXJzb3ItJHtpZH0tJHtEYXRlLm5vdygpfWB9XG4gICAgICAgICAgICAgIGxlZnQ9e2N1cnNvci54LWVkaXRvci52aWV3cG9ydFgrcGFkTGVuZ3RoKzErIDF9IHRvcD17Y3Vyc29yLnktZWRpdG9yLnZpZXdwb3J0WX0gd2lkdGg9ezF9IGhlaWdodD17MX1cbiAgICAgICAgICAgICAgc3R5bGU9e3suLi5jdXJzb3Iuc3R5bGUsdW5kZXJsaW5lOiB0cnVlLGJvbGQ6dHJ1ZSxpbnZlcnNlOnRydWV9fVxuICAgICAgICAgICAgICB0YWdzPXtmYWxzZX1cbiAgICAgICAgICAgICAgY29udGVudD17Y3Vyc29yLmNoYXJ9XG4gICAgICAgICAgLz5cbiAgICAgICAgfSlcblxuICB9XG4gIGNvbnN0IHJlbmRlclNlbGVjdGlvbnMgPSAoKSA9PiB7XG4gICAgaWYoIWVkaXRvcil7XG4gICAgICByZXR1cm4gW11cbiAgICB9XG4gICAgY29uc3QgcGFkTGVuZ3RoPU1hdGguY2VpbChNYXRoLmxvZzEwKGVkaXRvci52aWV3cG9ydEhlaWdodCtlZGl0b3Iudmlld3BvcnRZKSkrMVxuICAgIGNvbnN0IHZpc2libGVBcmVhID0gUmVjdGFuZ2xlLmZyb21FZGl0b3IoZWRpdG9yKVxuXG4gICAgcmV0dXJuIFsuLi5lZGl0b3Iuc2VsZWN0aW9uc11cbiAgICAgICAgLmNvbmNhdChbZWRpdG9yLnNlbGVjdFN0YXJ0XSlcbiAgICAgICAgLmZpbHRlcigoc2VsZWN0aW9uLHkpPT57XG4gICAgICAgICAgcmV0dXJuIHNlbGVjdGlvbiAhPT0gbnVsbCAmJiBzZWxlY3Rpb24uaXNWaXNpYmxlKHZpc2libGVBcmVhKVxuICAgICAgICB9KVxuICAgICAgICAuZmxhdE1hcChzID0+IHtcbiAgICAgICAgICBjb25zdCBsaW5lcz1bXVxuICAgICAgICAgIGZvcihsZXQgeT1zLnN0YXJ0Lnk7eTw9cy5lbmQueTt5Kyspe1xuICAgICAgICAgICAgbGluZXMucHVzaCh7XG4gICAgICAgICAgICAgIHg6cy5zdGFydC54LWVkaXRvci52aWV3cG9ydFgrcGFkTGVuZ3RoKzErIDEsXG4gICAgICAgICAgICAgIHk6eS1lZGl0b3Iudmlld3BvcnRZLFxuICAgICAgICAgICAgICBzdHlsZTogcy5zdGFydC5zdHlsZSxcbiAgICAgICAgICAgICAgY29udGVudDooZWRpdG9yLmxpbmVzW3ldLnN1YnN0cmluZyhzLnN0YXJ0LngsIHMuZW5kLnggKyAxKSksXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gbGluZXNcbiAgICAgICAgfSlcbiAgICAgICAgLm1hcCgocnMsaWQpPT57XG4gICAgICAgICAgcmV0dXJuIDxib3gga2V5PXtgc2VsZWN0aW9uLSR7aWR9LSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgICAgICAgICAgIGxlZnQ9e3JzLnh9IHRvcD17cnMueX0gd2lkdGg9e3JzLmNvbnRlbnQubGVuZ3RofSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgICAgICAgICAgc3R5bGU9e3suLi5ycy5zdHlsZSx1bmRlcmxpbmU6IHRydWUsYm9sZDp0cnVlLGludmVyc2U6dHJ1ZX19XG4gICAgICAgICAgICAgICAgICAgICAgdGFncz17ZmFsc2V9XG4gICAgICAgICAgICAgICAgICAgICAgY29udGVudD17cnMuY29udGVudH1cbiAgICAgICAgICAvPlxuICAgICAgICB9KVxuXG4gIH1cblxuICBjb25zdCB0b2tlbkxpc3QgPSAoKT0+e1xuICAgIGlmKCFlZGl0b3Ipe1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgIDxib3gga2V5PXtgMC0wLW5vLWZpbGVgfSBcbiAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICBpbnB1dFxuICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICBmb2N1c2VkXG4gICAgICAgICAgICBsZWZ0PXsoc2l6ZS5jb2xzPj4xKSAtIDh9IHRvcD17KHNpemUucm93cz4+MSktMX0gd2lkdGg9ezE2fSBoZWlnaHQ9ezN9IFxuICAgICAgICAgICAgc3R5bGU9e3tiZzonI2VlZWUwMCcsZmc6JyMxMTExMTEnfX1cbiAgICAgICAgICAgIGNvbnRlbnQ9eydcXG4gTm8gRmlsZSBMb2FkZWQnfVxuICAgICAgICAgIC8+XG4gICAgICAgIClcbiAgICB9XG4gICAgXG4gICAgY29uc3QgcGFkTGVuZ3RoPU1hdGguY2VpbChNYXRoLmxvZzEwKGVkaXRvci52aWV3cG9ydEhlaWdodCtlZGl0b3Iudmlld3BvcnRZKSkrMVxuICAgIGNvbnN0IGxpbmVzID0gZWRpdG9yLnJlbmRlclZpZXdwb3J0KCk7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKGxpbmVzKS5mbGF0TWFwKChsaW5lTnVtYmVyLCBrKSA9PiB7XG4gICAgICBjb25zdCBsaW5lID0gbGluZXNbbGluZU51bWJlcl1cbiAgICAgIGNvbnN0IGxpbmVOdW1iZXJUZXh0ID0gYCR7U3RyaW5nKGxpbmVOdW1iZXIpLnBhZFN0YXJ0KHBhZExlbmd0aCwgJyAnKX1gXG4gICAgICBjb25zdCBsaW5lTnVtYmVyQm94ID0gKFxuICAgICAgICAgIDxib3gga2V5PXtgJHtsaW5lTnVtYmVyfS1saW5lTnVtYmVyLSR7RGF0ZS5ub3d9YH1cbiAgICAgICAgICAgICAgIGxlZnQ9ezB9IHRvcD17a30gd2lkdGg9e3BhZExlbmd0aCArIDF9IGhlaWdodD17MX1cbiAgICAgICAgICAgICAgIHN0eWxlPXt7Ymc6ICcjMjIyMjIyJywgZmc6ICcjMzNhYWJiJywgaW52ZXJzZTogZWRpdG9yLmN1cnNvcnMubWFwKGMgPT5jLnkpLmluZGV4T2YobGluZU51bWJlcik+LTF9fVxuICAgICAgICAgICAgICAgY29udGVudD17bGluZU51bWJlclRleHQrJ+KUgid9XG4gICAgICAgICAgLz4pXG4gICAgICBjb25zdCBwbGFpbkxpbmVUZXh0ID0gKFxuICAgICAgICAgIDxib3gga2V5PXtgY29kZS0ke2xpbmVOdW1iZXJ9LSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgICAgbGVmdD17cGFkTGVuZ3RoICsgMSArIDF9IHRvcD17a30gd2lkdGg9e2VkaXRvci5saW5lc1tsaW5lTnVtYmVyXS5sZW5ndGh9IGhlaWdodD17MX1cbiAgICAgICAgICAgICAgIHN0eWxlPXt7Ymc6ICcjMjIyMjIyJywgZmc6ICcjMzNhYWJiJywgaW52ZXJzZTogZWRpdG9yLmN1cnNvcnMubWFwKGMgPT5jLnkpLmluZGV4T2YobGluZU51bWJlcik+LTF9fVxuICAgICAgICAgICAgICAgY29udGVudD17ZWRpdG9yLmxpbmVzW2xpbmVOdW1iZXJdfVxuICAgICAgICAgIC8+KVxuICAgICAgcmV0dXJuIGxpbmUucmVkdWNlKChhLCB0KSA9PiB7XG4gICAgICAgIGEucHVzaChcbiAgICAgICAgICAgIDxib3gga2V5PXtgJHt0Lnh9LSR7dC55fS0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgICAgICAgbGVmdD17dC54ICsgcGFkTGVuZ3RoICsgMSArIDF9IHRvcD17dC55IC0gZWRpdG9yLnZpZXdwb3J0WX0gd2lkdGg9e3QudGV4dC5sZW5ndGh9IGhlaWdodD17MX1cbiAgICAgICAgICAgICAgICAgc3R5bGU9e3Quc3R5bGV9XG4gICAgICAgICAgICAgICAgIGNvbnRlbnQ9e3QudGV4dH1cbiAgICAgICAgICAgIC8+XG4gICAgICAgIClcbiAgICAgICAgcmV0dXJuIGFcbiAgICAgIH0sIFtcbiAgICAgICAgbGluZU51bWJlckJveCxcbiAgICAgICAgcGxhaW5MaW5lVGV4dC8qLFxuICAgICAgICA8Ym94XG4gICAgICAgICAga2V5PXtgdGVybWluYXRvci0ke2xpbmVOdW1iZXJ9LSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgIGxlZnQ9e3BhZExlbmd0aCArIDEgKyBsaW5lLmxlbmd0aH0gdG9wPXtsaW5lTnVtYmVyIC0gZWRpdG9yLnZpZXdwb3J0WX0gd2lkdGg9ezF9IGhlaWdodD17MX1cbiAgICAgICAgICBzdHlsZT17e2JnOlwiIzExMzMxMVwiLGZnOlwiIzU1NTU1NVwifX1cbiAgICAgICAgICBjb250ZW50PXsnwqwnfVxuICAgICAgICAvPiovXG4gICAgICBdKVxuICAgIH0pXG4gIH1cblxuICAvLyAzKSBPbiBrZXlwcmVzcywgdXBkYXRlIGVkaXRvciB0aGVuIHJlLXJlbmRlclxuICBjb25zdCBpbnRlcm5hbE9uS2V5cHJlc3MgPSAoY2gsIGtleSkgPT4ge1xuICAgIG9uS2V5cHJlc3MoY2gsa2V5KVxuICAgIGlmKGVkaXRvciA9PSBudWxsIHx8IGZpbGVQYXRoPT1udWxsKXtcbiAgICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGNvbnN0IFtoYXNDaGFuZ2VkLG11c3RSZW5kZXJdID0gZWRpdG9yLm9uS2V5KGNoLGtleSlcbiAgICBpZihoYXNDaGFuZ2VkKXtcbiAgICAgIGNvbnN0IG5ld0xhc3RFdmVudCA9IHsuLi5sYXN0RXZlbnQsZWRpdG9yLGNoLGtleSx2aWV3cG9ydDpib3hSZWYuY3VycmVudC5scG9zfVxuICAgICAgb25DaGFuZ2UobmV3TGFzdEV2ZW50KVxuICAgICAgc2V0TGFzdEV2ZW50KG5ld0xhc3RFdmVudClcbiAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgIH0gZWxzZSBpZiAobXVzdFJlbmRlcikge1xuICAgICAgY29uc3QgbmV3TGFzdEV2ZW50ID0gey4uLmxhc3RFdmVudCxlZGl0b3IsY2gsa2V5LHZpZXdwb3J0OmJveFJlZi5jdXJyZW50Lmxwb3N9XG4gICAgICBvbkV2ZW50KG5ld0xhc3RFdmVudClcbiAgICAgIHNldExhc3RFdmVudChuZXdMYXN0RXZlbnQpXG4gICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICB9XG4gICAgLy8gcmVmcmVzaCgpO1xuICB9O1xuXG4gIGNvbnN0IG1vdXNlQWN0aW9uPShzY3JlZW5FdmVudCkgPT57XG4gICAgaWYoIWVkaXRvcil7XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgY29uc3QgW211c3RDaGFuZ2UsbXVzdFJlbmRlcl0gPSBlZGl0b3Iub25Nb3VzZShzY3JlZW5FdmVudCxib3hSZWYuY3VycmVudC5scG9zKVxuICAgIGlmKG11c3RDaGFuZ2Upe1xuICAgICAgY29uc3QgbmV3TGFzdEV2ZW50ID0gey4uLmxhc3RFdmVudCxlZGl0b3Isc2NyZWVuRXZlbnQsdmlld3BvcnQ6Ym94UmVmLmN1cnJlbnQubHBvc31cbiAgICAgIG9uQ2hhbmdlKG5ld0xhc3RFdmVudClcbiAgICAgIHNldExhc3RFdmVudChuZXdMYXN0RXZlbnQpXG4gICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICB9IGVsc2UgaWYgKG11c3RSZW5kZXIpIHtcbiAgICAgIGNvbnN0IG5ld0xhc3RFdmVudCA9IHsuLi5sYXN0RXZlbnQsZWRpdG9yLHNjcmVlbkV2ZW50LHZpZXdwb3J0OmJveFJlZi5jdXJyZW50Lmxwb3N9XG4gICAgICBvbkV2ZW50KG5ld0xhc3RFdmVudClcbiAgICAgIHNldExhc3RFdmVudChuZXdMYXN0RXZlbnQpXG4gICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICB9XG4gIH1cbiAgcmV0dXJuIChcbiAgICA8Ym94XG4gICAgICByZWY9e2JveFJlZn1cbiAgICAgIHsuLi5ib3hQcm9wc31cbiAgICAgIG1vdXNlXG4gICAgICBrZXlzXG4gICAgICBpbnB1dFxuICAgICAgY2xpY2thYmxlXG4gICAgICBmb2N1c2VkXG4gICAgICBib3JkZXI9e3sgdHlwZTogJ2xpbmUnIH19XG4gICAgICBzdHlsZT17eyBib3JkZXI6IHsgZmc6ICdjeWFuJyB9IH19XG4gICAgICB0YWdzPXtmYWxzZX0gICAgICAgICAgIC8vIHJhdyBBTlNJXG4gICAgICBzY3JvbGxhYmxlPXtmYWxzZX1cbiAgICAgIG9uS2V5cHJlc3M9e2ludGVybmFsT25LZXlwcmVzc31cbiAgICAgIG9uTW91c2U9e21vdXNlQWN0aW9ufVxuICAgICAgbGFiZWw9e2BFZGl0aW5nOiAke2ZpbGVQYXRofWB9XG4gICAgPlxuICAgICAgey8qIHN0YXR1c1xuICAgICAgb25DbGljaz17c2V0Q3Vyc29yUG9zaXRpb259XG4gICAgICBvblNjcm9sbD17c2Nyb2xsQ3Vyc29yfVxuICAgICAgKi99XG4gICAgICB7dG9rZW5MaXN0KCl9XG4gICAgICB7Lyogc3RhdHVzICovfVxuICAgICAgPGJveFxuICAgICAgICBrZXk9e2BzdGF0dXNgfVxuICAgICAgICB0b3A9e3NpemUucm93c31cbiAgICAgICAgbGVmdD17Mn1cbiAgICAgICAgd2lkdGg9e3NpemUuY29scy02fVxuICAgICAgICBoZWlnaHQ9ezF9XG4gICAgICAgIGNvbnRlbnQ9e2VkaXRvcj8uZ2V0U3RhdHVzKCl9XG4gICAgICAgIHRhZ3M9e2ZhbHNlfVxuICAgICAgICBzdHlsZT17e2ZnOidibGFjaycsYmc6J3llbGxvdyd9fVxuICAgICAgLz5cbiAgICAgIHtyZW5kZXJDdXJzb3JzKCl9XG4gICAgICB7cmVuZGVyU2VsZWN0aW9ucygpfVxuICAgIDwvYm94PlxuICApO1xufSIsImNvbnN0IHV0aWwgPSByZXF1aXJlKCd1dGlsJyk7XG5jb25zdCBjcCA9IHJlcXVpcmUoJ2NoaWxkX3Byb2Nlc3MnKTtcbmNvbnN0IGV4ZWMgPSB1dGlsLnByb21pc2lmeShjcC5leGVjKTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldFN0YXR1cyhjd2QpIHtcbiAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4ZWMoYGdpdCBzdGF0dXMgLS1wb3JjZWxhaW5gLCB7IGN3ZCB9KTtcbiAgcmV0dXJuIHN0ZG91dC5zcGxpdCgnXFxuJykuZmlsdGVyKEJvb2xlYW4pO1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldENvbW1pdHMoY3dkKSB7XG4gIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleGVjKGBnaXQgbG9nIC0tcHJldHR5PWZvcm1hdDpcIiVoICVzXCIgLS1hYmJyZXY9NDAgfCB0ZWVgLCB7IGN3ZCB9KTtcbiAgY29uc3QgbGluZXMgPSBzdGRvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKVxuICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwobGluZXMubWFwKGFzeW5jIHYgPT4ge1xuICAgIGNvbnN0IGlkID0gdi5zdWJzdHJpbmcoMCw0MClcbiAgICBjb25zdCBtZXNzYWdlID0gdi5zdWJzdHJpbmcoNDEpXG4gICAgY29uc3QgeyBzdGRvdXQ6dGFncyB9ID0gYXdhaXQgZXhlYyhgZ2l0IHRhZyAtLXBvaW50cy1hdCAke2lkfWAsIHsgY3dkIH0pO1xuICAgIHJldHVybiBgJHtpZC5zdWJzdHJpbmcoMCw4KX3ilIIkeyh0YWdzP3RhZ3MudHJpbShcIlxcblwiKTpcIlwiKS5wYWRFbmQoOSwnICcpfeKUgiR7bWVzc2FnZX1gXG4gICAgLy8gcmV0dXJuIGAke2lkLnN1YnN0cmluZygwLDgpfSAke21lc3NhZ2V9YFxuICB9KSk7XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0QnJhbmNoKGN3ZCkge1xuICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXhlYyhgZ2l0IGJyYW5jaCAtLXNob3ctY3VycmVudGAsIHsgY3dkIH0pO1xuICByZXR1cm4gc3Rkb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0Q3VycmVudFRhZyhjd2QpIHtcbiAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4ZWMoYGdpdCBkZXNjcmliZSAtLXRhZ3MgLS1leGFjdC1tYXRjaCAyPi9kZXYvbnVsbCB8fCBlY2hvIFwibm9uZVwiYCwgeyBjd2QgfSk7XG4gIHJldHVybiBzdGRvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRSZW1vdGVzKGN3ZCkge1xuICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXhlYyhgZ2l0IHJlbW90ZSAtdmAsIHsgY3dkIH0pO1xuICByZXR1cm4gc3Rkb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0VGFncyhjd2QpIHtcbiAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4ZWMoYGdpdCB0YWcgfCB0ZWVgLCB7IGN3ZCB9KTtcbiAgcmV0dXJuIHN0ZG91dC5zcGxpdCgnXFxuJykuZmlsdGVyKEJvb2xlYW4pO1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdpdFN0YWdlKGN3ZCwgZmlsZVBhdGgpIHtcbiAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4ZWMoYGdpdCBhZGQgLWYgXCIke2ZpbGVQYXRofVwiYCwgeyBjd2QgfSk7XG4gIHJldHVybiBzdGRvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnaXRVbnN0YWdlKGN3ZCwgZmlsZVBhdGgpIHtcbiAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4ZWMoYGdpdCByZXN0b3JlIC0tc3RhZ2VkIFwiJHtmaWxlUGF0aH1cImAsIHsgY3dkIH0pO1xuICByZXR1cm4gc3Rkb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2l0Q29tbWl0KGN3ZCxjb21taXRNZXNzYWdlKSB7XG4gIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleGVjKGBnaXQgY29tbWl0IC1tIFwiJHtjb21taXRNZXNzYWdlfVwiYCwgeyBjd2QgfSk7XG4gIHJldHVybiBzdGRvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnaXRUYWcoY3dkLHRhZykge1xuICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXhlYyhgZ2l0IHRhZyBcIiR7dGFnfVwiYCwgeyBjd2QgfSk7XG4gIHJldHVybiBzdGRvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnaXRQdXNoKGN3ZCxyZW1vdGUsYnJhbmNoKSB7XG4gIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleGVjKGBnaXQgcHVzaCBcIiR7cmVtb3RlfVwiIFwiJHticmFuY2h9XCIgLS10YWdzYCwgeyBjd2QgfSk7XG4gIHJldHVybiBzdGRvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbn0iLCJcbmltcG9ydCBSZWFjdCwge3VzZUVmZmVjdCwgdXNlUmVmLCB1c2VTdGF0ZX0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQge1xuICAgIExpc3RFbGVtZW50IGFzIGxpc3QsXG4gICAgQm94RWxlbWVudCBhcyBib3gsXG4gICAgQnV0dG9uRWxlbWVudCBhcyBidXR0b24sXG4gICAgVGV4dGFyZWFFbGVtZW50IGFzIHRleHRhcmVhLFxuICAgIFRleHRFbGVtZW50IGFzIHRleHRcbn0gZnJvbSAncmVhY3QtYmxlc3NlZCc7XG5pbXBvcnQge1NpbXBsZVRleHRFZGl0b3J9IGZyb20gXCIuL1NpbXBsZVRleHRFZGl0b3IuanNcIjtcbmltcG9ydCB7c2FmZVN0cmluZ2lmeX0gZnJvbSBcIi4vdXRpbFwiO1xuY29uc3QgZGVmYXVsdFRleHQ9XCIuLi5cIlxuICAgIC5zcGxpdChcIixcIikuam9pbihcIlxcblwiKVxuZXhwb3J0IGZ1bmN0aW9uIFNpbXBsZVRleHRFZGl0b3JDb21wb25lbnQoe2luaXRpYWxUZXh0LCBvbkNoYW5nZSwuLi5ib3hQcm9wc30pIHtcbiAgICBjb25zdCBib3hSZWYgPSB1c2VSZWYobnVsbCk7XG4gICAgY29uc3QgW2VkaXRvciwgc2V0RWRpdG9yXSA9IHVzZVN0YXRlKG51bGwpO1xuICAgIGNvbnN0IFttb3VzZUNvb3Jkcywgc2V0TW91c2VDb29yZHNdID0gdXNlU3RhdGUoe3g6MCx5OjB9KTtcbiAgICBjb25zdCBbc2l6ZSwgc2V0U2l6ZV0gICAgID0gdXNlU3RhdGUoeyByb3dzOiAxMCwgY29sczogMzAgfSk7XG4gICAgbGV0IGNoYW5nZWRUaW1lb3V0PTBcbiAgICB1c2VFZmZlY3QoKCk9PntcbiAgICAgICAgbGV0IG5ld0VkaXRvcj1lZGl0b3JcbiAgICAgICAgaWYoIW5ld0VkaXRvcil7XG4gICAgICAgICAgICBuZXdFZGl0b3IgPSBuZXcgU2ltcGxlVGV4dEVkaXRvcihpbml0aWFsVGV4dHx8ZGVmYXVsdFRleHQpXG4gICAgICAgIH1cbiAgICAgICAgaWYoKGluaXRpYWxUZXh0fHxkZWZhdWx0VGV4dCkuc3Vic3RyaW5nKG5ld0VkaXRvci5jdXJzb3JJbmRleCkhPT1uZXdFZGl0b3IuYnVmZmVyLnN1YnN0cmluZyhuZXdFZGl0b3IuY3Vyc29ySW5kZXgpKXtcbiAgICAgICAgICAgIG5ld0VkaXRvci5jdXJzb3JJbmRleCA9IDBcbiAgICAgICAgICAgIG5ld0VkaXRvci5zbGlkZVZpZXdwb3J0VG9DdXJzb3IoKVxuICAgICAgICB9XG4gICAgICAgIG5ld0VkaXRvci5idWZmZXI9aW5pdGlhbFRleHR8fGRlZmF1bHRUZXh0XG4gICAgICAgIG5ld0VkaXRvci52aWV3cG9ydEhlaWdodCA9IHNpemUucm93cy0xO1xuICAgICAgICBuZXdFZGl0b3Iudmlld3BvcnRXaWR0aCA9IHNpemUuY29scztcbiAgICAgICAgc2V0RWRpdG9yKG5ld0VkaXRvci5jb3B5KCkpXG4gICAgfSxbaW5pdGlhbFRleHRdKVxuXG4gICAgLy8gMikgdXBkYXRlIHNpemUgb24gcmVzaXplXG4gICAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICAgICAgY29uc3QgYm94ID0gYm94UmVmLmN1cnJlbnQ7XG4gICAgICAgIGlmICghYm94KSByZXR1cm47XG4gICAgICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IHtcbiAgICAgICAgICAgIHNldFNpemUoeyBjb2xzOiBib3gud2lkdGgsIHJvd3M6IGJveC5oZWlnaHQtMiB9KTtcbiAgICAgICAgfTtcbiAgICAgICAgdXBkYXRlKCk7XG4gICAgICAgIGJveC5vbigncmVzaXplJywgdXBkYXRlKTtcbiAgICAgICAgcmV0dXJuICgpID0+IGJveC5yZW1vdmVMaXN0ZW5lcigncmVzaXplJywgdXBkYXRlKTtcbiAgICB9LCBbXSk7XG4gICAgLy8gJCVeJiooKVxuICAgIGlmKDEgPT09IDEgJiYgMj09MzMpe31cbiAgICAvLyBydW4gb25jZSBvbiBzaXplIGNoYW5nZVxuICAgIHVzZUVmZmVjdCgoKT0+e1xuICAgICAgICBpZihlZGl0b3Ipe1xuICAgICAgICAgICAgZWRpdG9yLnZpZXdwb3J0V2lkdGggPSBzaXplLmNvbHM7XG4gICAgICAgICAgICBlZGl0b3Iudmlld3BvcnRIZWlnaHQgPSBzaXplLnJvd3M7XG4gICAgICAgICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICAgICAgfVxuICAgIH0sIFtzaXplXSk7XG5cbiAgICBjb25zdCBpbnRlcm5hbE9uS2V5UHJlc3M9KGNoLGtleSk9PntcbiAgICAgICAgZWRpdG9yLm9uS2V5KGNoLGtleSlcbiAgICAgICAgY2xlYXJUaW1lb3V0KGNoYW5nZWRUaW1lb3V0KVxuICAgICAgICBjaGFuZ2VkVGltZW91dCA9IHNldFRpbWVvdXQoKCk9PntcbiAgICAgICAgICAgIG9uQ2hhbmdlKGVkaXRvcilcbiAgICAgICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgICAgICB9LDgwKVxuICAgIH1cbiAgICBjb25zdCBzZXRDdXJzb3JQb3NpdGlvbiA9IChzY3JlZW5FdmVudCkgPT4ge1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB7eGkseWl9ID0gYm94UmVmLmN1cnJlbnQubHBvcztcbiAgICAgICAgY29uc3Qge3gseX0gPSBzY3JlZW5FdmVudDtcbiAgICAgICAgZWRpdG9yLnNldEN1cnNvcih4LXhpLTErZWRpdG9yLnZpZXdwb3J0WCx5LXlpLTErZWRpdG9yLnZpZXdwb3J0WSlcbiAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgfTtcbiAgICBjb25zdCBtb3VzZUFjdGlvbj0oZXZlbnQpID0+e1xuICAgICAgICBjb25zdCB7eCx5fSA9IGV2ZW50XG5cbiAgICAgICAgLy8gc3dpdGNoKGV2ZW50LmFjdGlvbil7XG4gICAgICAgIC8vICAgICBjYXNlICdtb3VzZW1vdmUnOmJyZWFrO1xuICAgICAgICAvLyAgICAgY2FzZSAnbW91c2Vkb3duJzpicmVhaztcbiAgICAgICAgLy8gICAgIGNhc2UgJ21vdXNldXAnOmJyZWFrO1xuICAgICAgICAvLyAgICAgY2FzZSAnd2hlZWx1cCc6ZWRpdG9yLm1vdmVDdXJzb3JVcCgpLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpO3NldEVkaXRvcihlZGl0b3IuY29weSgpKTticmVhaztcbiAgICAgICAgLy8gICAgIGNhc2UgJ3doZWVsZG93bic6ZWRpdG9yLm1vdmVDdXJzb3JEb3duKCkuc2xpZGVWaWV3cG9ydFRvQ3Vyc29yKCk7c2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpO2JyZWFrO1xuICAgICAgICAvLyAgICAgZGVmYXVsdDogdGhyb3cgbmV3IEVycm9yKHNhZmVTdHJpbmdpZnkoZXZlbnQpKTsgYnJlYWs7XG4gICAgICAgIC8vIH1cbiAgICAgICAgLy8gc2V0TW91c2VDb29yZHMoe3gseX0pO1xuICAgIH1cbiAgICBjb25zdCByZW5kZXJMaW5lcyA9ICgpID0+IHtcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qge3ZpZXdwb3J0WTp2eSx2aWV3cG9ydEhlaWdodDp2aH0gPSBlZGl0b3JcbiAgICAgICAgcmV0dXJuIGVkaXRvci5yZW5kZXJUb0xpbmVzKClcbiAgICAgICAgICAgIC5maWx0ZXIoKGwseSkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiAoeSA+PXZ5ICYmIHkgPD0gKHZ5ICsgdmgpKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAubWFwKChsaW5lLGluZGV4KT0+e1xuICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgIHRvcD17aW5kZXh9IGxlZnQ9ezB9IGhlaWdodD17MX0gd2lkdGg9e2xpbmUubGVuZ3RofHwxfVxuICAgICAgICAgICAgICAgICAgICAgICAga2V5PXtgY29tbWl0LWVkaXRvci1saW5lLSR7aW5kZXh9YH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ9e2xpbmV9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgfSlcbiAgICB9XG4gICAgY29uc3QgcmVuZGVyQ3Vyc29yID0gKCkgPT4ge1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBpID0gZWRpdG9yLmN1cnNvckluZGV4XG4gICAgICAgIGNvbnN0IHt4LHl9ID0gZWRpdG9yLmN1cnNvckNvb3JkcygpXG4gICAgICAgIGNvbnN0IHtjdXJzb3JJbmRleDpjaSx2aWV3cG9ydFg6dngsdmlld3BvcnRZOnZ5LHZpZXdwb3J0SGVpZ2h0OnZoLHZpZXdwb3J0V2lkdGg6dnd9ID0gZWRpdG9yO1xuICAgICAgICBjb25zdCBjb250ZW50ID0gZWRpdG9yLmJ1ZmZlci5zdWJzdHJpbmcoaSxpKzEpXG4gICAgICAgIHJldHVybiAoPGJveFxuICAgICAgICAgICAga2V5PXtgZWRpdG9yLWN1cnNvci0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgIHRvcD17eS12eX1cbiAgICAgICAgICAgIGxlZnQ9e3gtdnh9XG4gICAgICAgICAgICB3aWR0aD17MX0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgc3R5bGU9e3tpbnZlcnNlOnRydWUsdW5kZXJsaW5lOnRydWV9fVxuICAgICAgICAgICAgY29udGVudD17Y29udGVudH1cbiAgICAgICAgLz4pXG4gICAgfVxuICAgIGNvbnN0IHJlbmRlclN0YXR1cyA9ICgpID0+IHtcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qge2N1cnNvckluZGV4OmNpLHZpZXdwb3J0WDp2eCx2aWV3cG9ydFk6dnksdmlld3BvcnRIZWlnaHQ6dmgsdmlld3BvcnRXaWR0aDp2d30gPSBlZGl0b3I7XG4gICAgICAgIGNvbnN0IHt4OmN4LHk6Y3l9ID0gZWRpdG9yLmN1cnNvckNvb3JkcygpXG4gICAgICAgIGNvbnN0IHt4Om14LHk6bXl9ID0gbW91c2VDb29yZHNcbiAgICAgICAgbGV0IGN1cnNvckNvbnRlbnQgPSBlZGl0b3IuYnVmZmVyLnN1YnN0cmluZyhjaSxjaSsxKVxuICAgICAgICBsZXQgY29udGVudD1jdXJzb3JDb250ZW50XG4gICAgICAgIGlmKGJveFJlZi5jdXJyZW50ICYmIGJveFJlZi5jdXJyZW50Lmxwb3MpIHtcbiAgICAgICAgICAgIGNvbnN0IHt4aSx5aX0gPSBib3hSZWYuY3VycmVudC5scG9zO1xuICAgICAgICAgICAgY29uc3QgZmVlZGJhY2s9e1xuICAgICAgICAgICAgICAgIEM6YCR7Y3h9LCR7Y3l9LFske2NpfV09JHtjdXJzb3JDb250ZW50fWAsXG4gICAgICAgICAgICAgICAgQjpgJHt4aX0sJHt5aX1gLFxuICAgICAgICAgICAgICAgIFY6YCR7dnh9LCR7dnl9LCR7dnd9LCR7dmh9YCxcbiAgICAgICAgICAgICAgICBNOmBBJHtteH0sJHtteX1SJHtteC14aS0xfSwke215LXlpLTF9YFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udGVudCA9IHNhZmVTdHJpbmdpZnkoZmVlZGJhY2spLnJlcGxhY2UoL1t7fSBcIl0vZ2ksJycpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICg8Ym94XG4gICAgICAgICAgICBrZXk9e2BlZGl0b3Itc3RhdHVzLSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgdG9wPXs3fVxuICAgICAgICAgICAgbGVmdD17Mn1cbiAgICAgICAgICAgIHdpZHRoPXtjb250ZW50Lmxlbmd0aH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgc3R5bGU9e3tpbnZlcnNlOnRydWUsdW5kZXJsaW5lOnRydWV9fVxuICAgICAgICAgICAgY29udGVudD17Y29udGVudH1cbiAgICAgICAgLz4pXG4gICAgfVxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3hcbiAgICAgICAgICAgIHJlZj17Ym94UmVmfVxuICAgICAgICAgICAgey4uLmJveFByb3BzfVxuICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgIGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX1cbiAgICAgICAgICAgIHN0eWxlPXt7IGJvcmRlcjogeyBmZzogJ2N5YW4nIH0gfX1cbiAgICAgICAgICAgIHRhZ3M9e2ZhbHNlfSAgICAgICAgICAgLy8gcmF3IEFOU0lcbiAgICAgICAgICAgIHNjcm9sbGFibGU9e2ZhbHNlfVxuICAgICAgICAgICAgb25LZXlwcmVzcz17aW50ZXJuYWxPbktleVByZXNzfVxuICAgICAgICAgICAgb25DbGljaz17c2V0Q3Vyc29yUG9zaXRpb259XG4gICAgICAgICAgICBvbk1vdXNlPXttb3VzZUFjdGlvbn1cbiAgICAgICAgPlxuICAgICAgICAgICAgey8qbGFiZWwgPSB7YCR7Ym94UHJvcHMubGFiZWwgfHwgJ0VkaXRpbmcnfSAke0pTT04uc3RyaW5naWZ5KGVkaXRvci5jdXJzb3JDb29yZHMoKSl9ICR7ZWRpdG9yLmN1cnNvckluZGV4fWB9Ki99XG4gICAgICAgICAgICB7cmVuZGVyTGluZXMoKX1cbiAgICAgICAgICAgIHtyZW5kZXJDdXJzb3IoKX1cbiAgICAgICAgICAgIHtyZW5kZXJTdGF0dXMoKX1cbiAgICAgICAgPC9ib3g+KVxufSIsImltcG9ydCB7dmVyc2lvbn0gZnJvbSBcInZpdGVcIjtcblxuZXhwb3J0IGNsYXNzIFNlbXZlciB7XG4gICAgbWFqb3IgPSAwXG4gICAgbWlub3IgPSAwXG4gICAgcGF0Y2ggPSAwXG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB2XG4gICAgICogQHJldHVybiB7U2VtdmVyfVxuICAgICAqL1xuICAgIHN0YXRpYyBmcm9tKHYpe1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgW21ham9yLCBtaW5vciwgcGF0Y2hdID0gKHYgfHwgJzAuMC4wJykuc3BsaXQoJy4nKVxuICAgICAgICAgICAgcmV0dXJuIG5ldyBTZW12ZXIobWFqb3IsIG1pbm9yLCBwYXRjaClcbiAgICAgICAgfWNhdGNoKGUpe1xuICAgICAgICAgICAgY29uc3QgW21ham9yLCBtaW5vciwgcGF0Y2hdID0gJzAuMC4wJy5zcGxpdCgnLicpXG4gICAgICAgICAgICByZXR1cm4gbmV3IFNlbXZlcihtYWpvciwgbWlub3IsIHBhdGNoKVxuICAgICAgICB9XG4gICAgfVxuICAgIGNvbnN0cnVjdG9yKG1ham9yLG1pbm9yLHBhdGNoKSB7XG4gICAgICAgIHRoaXMubWFqb3IgPSBtYWpvclxuICAgICAgICB0aGlzLm1pbm9yID0gbWlub3JcbiAgICAgICAgdGhpcy5wYXRjaCA9IHBhdGNoXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTZW12ZXJ9XG4gICAgICovXG4gICAgbmV4dE1ham9yKCl7XG4gICAgICAgIHJldHVybiBuZXcgU2VtdmVyKChwYXJzZUludCh0aGlzLm1ham9yKSsxKS50b1N0cmluZygpLCBcIjBcIixcIjBcIilcbiAgICB9XG4gICAgcHJldk1ham9yKCl7XG4gICAgICAgIGxldCB2ID0gcGFyc2VJbnQodGhpcy5tYWpvcilcbiAgICAgICAgdj12PjA/di0xOnZcbiAgICAgICAgcmV0dXJuIG5ldyBTZW12ZXIodi50b1N0cmluZygpLCBcIjBcIixcIjBcIilcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NlbXZlcn1cbiAgICAgKi9cbiAgICBuZXh0TWlub3IoKXtcbiAgICAgICAgcmV0dXJuIG5ldyBTZW12ZXIodGhpcy5tYWpvciwocGFyc2VJbnQodGhpcy5taW5vcikrMSkudG9TdHJpbmcoKSwgXCIwXCIpXG4gICAgfVxuICAgIHByZXZNaW5vcigpe1xuICAgICAgICBsZXQgdiA9IHBhcnNlSW50KHRoaXMubWlub3IpXG4gICAgICAgIHY9dj4wP3YtMTp2XG4gICAgICAgIHJldHVybiBuZXcgU2VtdmVyKHRoaXMubWFqb3Isdi50b1N0cmluZygpLCBcIjBcIilcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NlbXZlcn1cbiAgICAgKi9cbiAgICBuZXh0UGF0Y2goKXtcbiAgICAgICAgcmV0dXJuIG5ldyBTZW12ZXIodGhpcy5tYWpvcix0aGlzLm1pbm9yLCAocGFyc2VJbnQodGhpcy5wYXRjaCkrMSkudG9TdHJpbmcoKSlcbiAgICB9XG4gICAgcHJldlBhdGNoKCl7XG4gICAgICAgIGxldCB2ID0gcGFyc2VJbnQodGhpcy5wYXRjaClcbiAgICAgICAgdj12PjA/di0xOnZcbiAgICAgICAgcmV0dXJuIG5ldyBTZW12ZXIodGhpcy5tYWpvcix0aGlzLm1pbm9yLCB2LnRvU3RyaW5nKCkpXG4gICAgfVxuXG5cbiAgICB0b1N0cmluZygpe1xuICAgICAgICByZXR1cm4gYCR7dGhpcy5tYWpvcn0uJHt0aGlzLm1pbm9yfS4ke3RoaXMucGF0Y2h9YFxuICAgIH1cbiAgICBjb3B5KCl7XG4gICAgICAgIHJldHVybiBuZXcgU2VtdmVyKHRoaXMubWFqb3IsdGhpcy5taW5vciwgdGhpcy5wYXRjaClcbiAgICB9XG59IiwiaW1wb3J0IFJlYWN0LCB7Q29tcG9uZW50LCB1c2VFZmZlY3QsIHVzZVJlZiwgdXNlU3RhdGV9IGZyb20gJ3JlYWN0JztcbmltcG9ydCB7XG4gICAgTGlzdEVsZW1lbnQgYXMgbGlzdCxcbiAgICBCb3hFbGVtZW50IGFzIGJveCxcbiAgICBCdXR0b25FbGVtZW50IGFzIGJ1dHRvbixcbiAgICBUZXh0YXJlYUVsZW1lbnQgYXMgdGV4dGFyZWEsXG4gICAgVGV4dEVsZW1lbnQgYXMgdGV4dFxufSBmcm9tICdyZWFjdC1ibGVzc2VkJztcbmltcG9ydCB7U2VtdmVyfSBmcm9tIFwiLi9TZW12ZXIuanNcIjtcblxuLy8gY29tbWVudCBcbmV4cG9ydCBmdW5jdGlvbiBTZW12ZXJDb250cm9sKHtpbml0aWFsLG9uQ2hhbmdlLC4uLmJveFByb3BzfSl7XG4gICAgY29uc3QgW3NlbXZlciwgc2V0U2VtdmVyXSA9IHVzZVN0YXRlKFNlbXZlci5mcm9tKGluaXRpYWwpKTtcbiAgICB1c2VFZmZlY3QoKCk9PntcbiAgICAgICAgc2V0U2VtdmVyKFNlbXZlci5mcm9tKGluaXRpYWwpKTtcbiAgICB9LFtpbml0aWFsXSlcbiAgICBjb25zdCBkZWNNYWpvcj0oKT0+e1xuICAgICAgICBjb25zdCBuZXdTZW12ZXI9c2VtdmVyLnByZXZNYWpvcigpXG4gICAgICAgIG9uQ2hhbmdlKG5ld1NlbXZlcilcbiAgICAgICAgc2V0U2VtdmVyKG5ld1NlbXZlcilcbiAgICB9XG4gICAgY29uc3QgaW5jTWFqb3I9KCk9PntcbiAgICAgICAgY29uc3QgbmV3U2VtdmVyPXNlbXZlci5uZXh0TWFqb3IoKVxuICAgICAgICBvbkNoYW5nZShuZXdTZW12ZXIpXG4gICAgICAgIHNldFNlbXZlcihuZXdTZW12ZXIpXG4gICAgfVxuICAgIGNvbnN0IGRlY01pbm9yPSgpPT57XG4gICAgICAgIGNvbnN0IG5ld1NlbXZlcj1zZW12ZXIucHJldk1pbm9yKClcbiAgICAgICAgb25DaGFuZ2UobmV3U2VtdmVyKVxuICAgICAgICBzZXRTZW12ZXIobmV3U2VtdmVyKVxuICAgIH1cbiAgICBjb25zdCBpbmNNaW5vcj0oKT0+e1xuICAgICAgICBjb25zdCBuZXdTZW12ZXI9c2VtdmVyLm5leHRNaW5vcigpXG4gICAgICAgIG9uQ2hhbmdlKG5ld1NlbXZlcilcbiAgICAgICAgc2V0U2VtdmVyKG5ld1NlbXZlcilcbiAgICB9XG4gICAgY29uc3QgZGVjUGF0Y2g9KCk9PntcbiAgICAgICAgY29uc3QgbmV3U2VtdmVyPXNlbXZlci5wcmV2UGF0Y2goKVxuICAgICAgICBvbkNoYW5nZShuZXdTZW12ZXIpXG4gICAgICAgIHNldFNlbXZlcihuZXdTZW12ZXIpXG4gICAgfVxuICAgIGNvbnN0IGluY1BhdGNoPSgpPT57XG4gICAgICAgIGNvbnN0IG5ld1NlbXZlcj1zZW12ZXIubmV4dFBhdGNoKClcbiAgICAgICAgb25DaGFuZ2UobmV3U2VtdmVyKVxuICAgICAgICBzZXRTZW12ZXIobmV3U2VtdmVyKVxuICAgIH1cbiAgICByZXR1cm4gKDxib3ggey4uLmJveFByb3BzfT5cbiAgICAgICAgPGJveCBtb3VzZSBmb2N1c2VkIGNsaWNrYWJsZSBvbkNsaWNrPXtkZWNNYWpvcn0gbGVmdD17MX0gaGVpZ2h0PXsxfSB3aWR0aD17MX0gIGNvbnRlbnQ9eyd2J30vPlxuICAgICAgICA8Ym94IG1vdXNlIGZvY3VzZWQgY2xpY2thYmxlIG9uQ2xpY2s9e2luY01ham9yfSBsZWZ0PXsyfSBoZWlnaHQ9ezF9IHdpZHRoPXtzZW12ZXIubWFqb3IubGVuZ3RofSBjb250ZW50PXtzZW12ZXIubWFqb3J9Lz5cbiAgICAgICAgPGJveCBtb3VzZSBmb2N1c2VkIGNsaWNrYWJsZSBvbkNsaWNrPXtkZWNNaW5vcn0gbGVmdD17MitzZW12ZXIubWFqb3IubGVuZ3RofSBoZWlnaHQ9ezF9IHdpZHRoPXsxfSAgY29udGVudD17Jy4nfS8+XG4gICAgICAgIDxib3ggbW91c2UgZm9jdXNlZCBjbGlja2FibGUgb25DbGljaz17aW5jTWlub3J9IGxlZnQ9ezMrc2VtdmVyLm1ham9yLmxlbmd0aH0gaGVpZ2h0PXsxfSB3aWR0aD17c2VtdmVyLm1pbm9yLmxlbmd0aH0gIGNvbnRlbnQ9e3NlbXZlci5taW5vcn0vPlxuICAgICAgICA8Ym94IG1vdXNlIGZvY3VzZWQgY2xpY2thYmxlIG9uQ2xpY2s9e2RlY1BhdGNofSBsZWZ0PXszK3NlbXZlci5tYWpvci5sZW5ndGgrc2VtdmVyLm1pbm9yLmxlbmd0aH0gaGVpZ2h0PXsxfSB3aWR0aD17MX0gY29udGVudD17Jy4nfS8+XG4gICAgICAgIDxib3ggbW91c2UgZm9jdXNlZCBjbGlja2FibGUgb25DbGljaz17aW5jUGF0Y2h9IGxlZnQ9ezQrc2VtdmVyLm1ham9yLmxlbmd0aCtzZW12ZXIubWlub3IubGVuZ3RofSBoZWlnaHQ9ezF9IHdpZHRoPXtzZW12ZXIucGF0Y2gubGVuZ3RofSBjb250ZW50PXtzZW12ZXIucGF0Y2h9Lz5cbiAgICA8L2JveD4pXG59IiwiLy8gY29tcG9uZW50cy9HaXRQYW5lbC5qc1xuaW1wb3J0IFJlYWN0LCB7Q29tcG9uZW50LCB1c2VFZmZlY3QsIHVzZVJlZiwgdXNlU3RhdGV9IGZyb20gJ3JlYWN0JztcbmltcG9ydCB7XG4gICAgTGlzdEVsZW1lbnQgYXMgbGlzdCxcbiAgICBUYWJsZUVsZW1lbnQgYXMgdGFibGUsXG4gICAgQm94RWxlbWVudCBhcyBib3gsXG4gICAgQnV0dG9uRWxlbWVudCBhcyBidXR0b24sXG4gICAgVGV4dGFyZWFFbGVtZW50IGFzIHRleHRhcmVhLFxuICAgIFRleHRFbGVtZW50IGFzIHRleHRcbn0gZnJvbSAncmVhY3QtYmxlc3NlZCc7XG5pbXBvcnQge1dvcmtzcGFjZX0gZnJvbSBcIi4vV29ya3NwYWNlXCI7XG5pbXBvcnQge2dldFN0YXR1cyxnZXRDb21taXRzLGdldEJyYW5jaCxnZXRDdXJyZW50VGFnLGdldFJlbW90ZXMsZ2V0VGFncyxnaXRTdGFnZSxnaXRVbnN0YWdlLGdpdENvbW1pdCxnaXRUYWcsZ2l0UHVzaH0gZnJvbSBcIi4vR2l0Q29tcG9uZW50LnNlcnZpY2VcIjtcbmltcG9ydCBNb2RhbERpYWxvZyBmcm9tIFwiLi9Nb2RhbERpYWxvZ1wiO1xuaW1wb3J0IHtTaW1wbGVUZXh0RWRpdG9yQ29tcG9uZW50fSBmcm9tIFwiLi9TaW1wbGVUZXh0RWRpdG9yLmpzeFwiO1xuaW1wb3J0IHtTZW12ZXJDb250cm9sfSBmcm9tIFwiLi9TZW12ZXIuanN4XCI7XG5pbXBvcnQge3NhZmVTdHJpbmdpZnl9IGZyb20gXCIuL3V0aWxcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIEdpdENvbXBvbmVudCh7XG4gICAgICAgIHJvb3REaXIsXG4gICAgICAgIG9uRmlsZVNlbGVjdCAsXG4gICAgICAgIC4uLmJveFByb3BzXG4gICAgfSkge1xuICAgIGNvbnN0IFttZXNzYWdlLCBzZXRNZXNzYWdlXSA9IHVzZVN0YXRlKGZhbHNlKTtcbiAgICBjb25zdCBbZ2l0U3RhdHVzLCBzZXRHaXRTdGF0dXNdID0gdXNlU3RhdGUoW10pO1xuICAgIGNvbnN0IFtnaXRDb21taXRzLCBzZXRHaXRDb21taXRzXSA9IHVzZVN0YXRlKFtdKTtcbiAgICBjb25zdCBbZ2l0QnJhbmNoLCBzZXRHaXRCcmFuY2hdID0gdXNlU3RhdGUoXCJcIik7XG4gICAgY29uc3QgW2dpdEN1cnJlbnRUYWcsIHNldEdpdEN1cnJlbnRUYWddID0gdXNlU3RhdGUoXCJcIik7XG4gICAgY29uc3QgW2dpdFRhZ3MsIHNldEdpdFRhZ3NdID0gdXNlU3RhdGUoW10pO1xuICAgIGNvbnN0IFtnaXRSZW1vdGVzLCBzZXRHaXRSZW1vdGVzXSA9IHVzZVN0YXRlKFtdKTtcbiAgICBjb25zdCBbY29tbWl0TWVzc2FnZSwgc2V0Q29tbWl0TWVzc2FnZV0gPSB1c2VTdGF0ZShudWxsKTtcbiAgICBjb25zdCBbbW91c2VDb29yZHMsIHNldE1vdXNlQ29vcmRzXSA9IHVzZVN0YXRlKHt4OjAseTowfSk7XG5cbiAgICBjb25zdCBzb3J0RmlsZXNGbiA9IChhLGIpID0+IGEuc3Vic3RyaW5nKDMpPmIuc3Vic3RyaW5nKDMpPzE6KGEuc3Vic3RyaW5nKDMpPT09Yi5zdWJzdHJpbmcoMyk/MDotMSlcbiAgICBhc3luYyBmdW5jdGlvbiByZWZyZXNoQWxsKCkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICAgICAgICBnZXRTdGF0dXMocm9vdERpciksXG4gICAgICAgICAgICBnZXRDb21taXRzKHJvb3REaXIpLFxuICAgICAgICAgICAgZ2V0QnJhbmNoKHJvb3REaXIpLFxuICAgICAgICAgICAgZ2V0Q3VycmVudFRhZyhyb290RGlyKSxcbiAgICAgICAgICAgIGdldFJlbW90ZXMocm9vdERpciksXG4gICAgICAgICAgICBnZXRUYWdzKHJvb3REaXIpLFxuICAgICAgICBdKVxuICAgICAgICBzZXRHaXRTdGF0dXMoQXJyYXkuZnJvbShyZXN1bHRbMF0pLnRvU29ydGVkKHNvcnRGaWxlc0ZuKSlcbiAgICAgICAgc2V0R2l0Q29tbWl0cyhyZXN1bHRbMV0pXG4gICAgICAgIHNldEdpdEJyYW5jaChyZXN1bHRbMl0pXG4gICAgICAgIHNldEdpdEN1cnJlbnRUYWcocmVzdWx0WzNdKVxuICAgICAgICBzZXRHaXRSZW1vdGVzKEFycmF5LmZyb20ocmVzdWx0WzRdKS5tYXAodiA9PntcbiAgICAgICAgICAgIGNvbnN0IHRrID0gdi5zcGxpdCgvXFxzKy9naSlcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgbmFtZTogdGtbMF0sXG4gICAgICAgICAgICAgICAgdXJsOiB0a1sxXSxcbiAgICAgICAgICAgICAgICBraW5kOiB0a1syXSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkpXG4gICAgICAgIHNldEdpdFRhZ3MocmVzdWx0WzVdKVxuICAgIH1cbiAgICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgICAgICByZWZyZXNoQWxsKClcbiAgICB9LCBbXSk7XG4gICAgY29uc3Qgb25GaWxlUGF0aFNlbGVjdCA9IChldmVudCkgPT4ge1xuICAgICAgICBjb25zdCBzdGFnZWQgPSBldmVudC5jb250ZW50LnN1YnN0cmluZygwLDEpXG4gICAgICAgIGNvbnN0IGNoYW5nZWQgPSBldmVudC5jb250ZW50LnN1YnN0cmluZygxLDIpXG4gICAgICAgIGNvbnN0IHt4LHl9ID0gbW91c2VDb29yZHNcblxuICAgICAgICBjb25zdCBmaWxlID0gZXZlbnQuY29udGVudC5zdWJzdHJpbmcoMyk7XG4gICAgICAgIGlmIChzdGFnZWQgPT09ICcgJyB8fCBzdGFnZWQgPT09ICc/JyB8fCAoY2hhbmdlZCAhPT0gJyAnICYmIHN0YWdlZCA9PT0gY2hhbmdlZCkpIHtcbiAgICAgICAgICAgIC8vIHNldE1lc3NhZ2UoYGdpdCBzdGFnZSBcIiR7ZmlsZX1cImApXG4gICAgICAgICAgICBnaXRTdGFnZShyb290RGlyLCBmaWxlKS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICAgICAgLy8gc2V0TWVzc2FnZShgZ2l0IHN0YWdlZCBcIiR7ZmlsZX0gKCR7cmVzdWx0fSlcImApXG4gICAgICAgICAgICAgICAgcmV0dXJuIGdldFN0YXR1cyhyb290RGlyKVxuICAgICAgICAgICAgfSkudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgICAgIHNldEdpdFN0YXR1cyhyZXN1bHQudG9Tb3J0ZWQoc29ydEZpbGVzRm4pKVxuICAgICAgICAgICAgfSkuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYGdpdCBzdGFnZSBcIiR7ZmlsZX0gZXJyb3IgKCR7ZXJyb3J9KVwiYClcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9ZWxzZSBpZiAoY2hhbmdlZCA9PT0gJyAnIHx8IGNoYW5nZWQgPT09ICc/Jykge1xuICAgICAgICAgICAgLy8gc2V0TWVzc2FnZShgZ2l0IHVuc3RhZ2UgXCIke2ZpbGV9XCJgKVxuICAgICAgICAgICAgZ2l0VW5zdGFnZShyb290RGlyLCBmaWxlKS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICAgICAgLy8gc2V0TWVzc2FnZShgZ2l0IHVuc3RhZ2VkIFwiJHtmaWxlfSAoJHtyZXN1bHR9KVwiYClcbiAgICAgICAgICAgICAgICByZXR1cm4gZ2V0U3RhdHVzKHJvb3REaXIpXG4gICAgICAgICAgICB9KS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICAgICAgc2V0R2l0U3RhdHVzKHJlc3VsdC50b1NvcnRlZChzb3J0RmlsZXNGbikpXG4gICAgICAgICAgICB9KS5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgZ2l0IHVuc3RhZ2VkIFwiJHtmaWxlfSBlcnJvciAoJHtlcnJvcn0pXCJgKVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gc2V0TWVzc2FnZShgbW91c2UgQCAke3h9LCR7eX1gKVxuICAgIH07XG4gICAgY29uc3Qgb25Db21taXRTZWxlY3QgPSAoZXZlbnQpID0+IHtcbiAgICAgICAgLy8gc2V0TWVzc2FnZShgY29tbWl0IHNlbGVjdGVkICR7ZXZlbnQuY29udGVudH0gJHtwcm9jZXNzLmN3ZCgpfWApXG4gICAgICAgIGNvbnN0IHRhZz1ldmVudC5jb250ZW50LnN1YnN0cmluZyg5LDE4KS50cmltKClcbiAgICAgICAgY29uc3QgbXNnPWV2ZW50LmNvbnRlbnQuc3Vic3RyaW5nKDE5KVxuICAgICAgICBzZXRDb21taXRNZXNzYWdlKG1zZylcblxuICAgICAgICBpZih0YWcubGVuZ3RoPj01KSB7XG4gICAgICAgICAgICBzZXRHaXRDdXJyZW50VGFnKHRhZylcbiAgICAgICAgfVxuICAgIH07XG4gICAgY29uc3QgY29tbWl0U3RhZ2VkRmlsZXMgPSAoZXZlbnQpID0+IHtcbiAgICAgICAgaWYoY29tbWl0TWVzc2FnZS50cmltKCkgPT09IFwiXCIpe1xuICAgICAgICAgICAgc2V0TWVzc2FnZShgY29tbWl0IG1lc3NhZ2UgY2Fubm90IGJlIGVtcHR5YClcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICBnaXRDb21taXQocm9vdERpciwgY29tbWl0TWVzc2FnZSkudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiByZWZyZXNoQWxsKClcbiAgICAgICAgICAgIH0pLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgICAgICBzZXRNZXNzYWdlKGBnaXQgY29tbWl0IC1tIFwiJHtjb21taXRNZXNzYWdlfVwiYClcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgLy8gc2V0TWVzc2FnZShgY29tbWl0IHNlbGVjdGVkICR7ZXZlbnQuY29udGVudH0gJHtwcm9jZXNzLmN3ZCgpfWApXG4gICAgfTtcbiAgICBjb25zdCB0YWdMYXN0Q29tbWl0ID0gKGV2ZW50KSA9PiB7XG4gICAgICAgIGdpdFRhZyhyb290RGlyLCBnaXRDdXJyZW50VGFnKS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICByZXR1cm4gcmVmcmVzaEFsbCgpXG4gICAgICAgIH0pLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgIHNldE1lc3NhZ2UoYGdpdCB0YWcgLW0gXCIke2dpdEN1cnJlbnRUYWd9XCJgKVxuICAgICAgICB9KVxuICAgICAgICAvLyBzZXRNZXNzYWdlKGBjb21taXQgc2VsZWN0ZWQgJHtldmVudC5jb250ZW50fSAke3Byb2Nlc3MuY3dkKCl9YClcbiAgICB9O1xuICAgIGNvbnN0IHB1c2hDb21taXRzID0gKGV2ZW50KSA9PiB7XG4gICAgICAgIHNldE1lc3NhZ2UoYGdpdCBwdXNoIFwiJHtnaXRSZW1vdGVzWzBdLm5hbWV9XCIgXCIke2dpdEJyYW5jaH1cImApXG4gICAgICAgIGdpdFB1c2gocm9vdERpciwgZ2l0UmVtb3Rlc1swXS5uYW1lLGdpdEJyYW5jaCkudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgc2V0TWVzc2FnZShgZ2l0IHB1c2ggXCIke2dpdFJlbW90ZXNbMF0ubmFtZX1cIiBcIiR7Z2l0QnJhbmNofVwiYClcbiAgICAgICAgfSlcbiAgICAgICAgc2V0TWVzc2FnZShgY29tbWl0IHNlbGVjdGVkICR7ZXZlbnQuY29udGVudH0gJHtwcm9jZXNzLmN3ZCgpfWApXG4gICAgfTtcbiAgICBjb25zdCBjb21taXRNZXNzYWdlQ2hhbmdlZD0oYnVmZmVyRWRpdG9yKSA9PiB7XG4gICAgICAgIHNldENvbW1pdE1lc3NhZ2UoYnVmZmVyRWRpdG9yLmJ1ZmZlcilcbiAgICB9XG4gICAgY29uc3QgbW91c2VBY3Rpb249KGV2ZW50KSA9PntcbiAgICAgICAgY29uc3Qge3gseX0gPSBldmVudFxuXG4gICAgICAgIHN3aXRjaChldmVudC5hY3Rpb24pe1xuICAgICAgICAgICAgY2FzZSAnbW91c2Vtb3ZlJzpicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ21vdXNlZG93bic6YnJlYWs7XG4gICAgICAgICAgICBjYXNlICdtb3VzZXVwJzpicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ3doZWVsdXAnOmVkaXRvci5tb3ZlQ3Vyc29yVXAoKS5zbGlkZVZpZXdwb3J0VG9DdXJzb3IoKTtzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSk7YnJlYWs7XG4gICAgICAgICAgICBjYXNlICd3aGVlbGRvd24nOmVkaXRvci5tb3ZlQ3Vyc29yRG93bigpLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpO3NldEVkaXRvcihlZGl0b3IuY29weSgpKTticmVhaztcbiAgICAgICAgICAgIGRlZmF1bHQ6IHRocm93IG5ldyBFcnJvcihzYWZlU3RyaW5naWZ5KGV2ZW50KSk7IGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHNldE1vdXNlQ29vcmRzKHt4LHl9KTtcbiAgICB9XG4gICAgY29uc3Qgc3RhdHVzID0gYHtjeWFuLWZnfSR7KGdpdFJlbW90ZXNbMF18fHt9KS5uYW1lfXsvY3lhbi1mZ30ve3JlZC1mZ30ke2dpdEJyYW5jaH17L3JlZC1mZ30oe3llbGxvdy1mZ30ke2dpdEN1cnJlbnRUYWd9ey95ZWxsb3ctZmd9KWBcbiAgICBjb25zdCBzdGF0dXNMZW49YCR7KGdpdFJlbW90ZXNbMF18fHt9KS5uYW1lfS8ke2dpdEJyYW5jaH0oJHtnaXRDdXJyZW50VGFnfSlgLmxlbmd0aFxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggey4uLmJveFByb3BzfT5cbiAgICAgICAgICAgIDxib3ggbGFiZWw9e2BgfSBoZWlnaHQ9ezl9IGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX0+XG4gICAgICAgICAgICAgICAgPGxpc3RcbiAgICAgICAgICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgICAgICAgICBpbnB1dFxuICAgICAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgICAgICAgICBzY3JvbGxiYXI9e3sgY2g6ICc9JywgdHJhY2s6IHsgZmc6J2JsdWUnLCBiZzogJ2dyZXknIH0gfX1cbiAgICAgICAgICAgICAgICAgICAgaXRlbXM9e2dpdFN0YXR1c31cbiAgICAgICAgICAgICAgICAgICAgc3R5bGU9e3tzZWxlY3RlZDoge2JnOiAnYmx1ZSd9fX1cbiAgICAgICAgICAgICAgICAgICAgb25TZWxlY3Q9e29uRmlsZVBhdGhTZWxlY3R9XG4gICAgICAgICAgICAgICAgICAgIG9uU2VsZWN0SXRlbT17b25GaWxlUGF0aFNlbGVjdH1cbiAgICAgICAgICAgICAgICAgICAgb25Nb3VzZT17bW91c2VBY3Rpb259XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8Ym94IHRvcD17LTF9IGxlZnQ9ezI1fSB3aWR0aD17N30gaGVpZ2h0PXsxfSBjb250ZW50PXtgeyR7bW91c2VDb29yZHMueH0sJHttb3VzZUNvb3Jkcy55fX1gfS8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDxib3ggY29udGVudD17c3RhdHVzfSB0b3A9ezB9IGxlZnQ9ezN9IHdpZHRoPXtzdGF0dXNMZW59IGhlaWdodD17MX0gdGFncz17dHJ1ZX0vPlxuICAgICAgICAgICAgPGJveCBjb250ZW50PXtyb290RGlyfSB0b3A9ezh9IGxlZnQ9ezN9IHdpZHRoPXtyb290RGlyLmxlbmd0aH0gaGVpZ2h0PXsxfS8+XG4gICAgICAgICAgICA8U2ltcGxlVGV4dEVkaXRvckNvbXBvbmVudFxuICAgICAgICAgICAgICAgIHRvcD17OX0gIGhlaWdodD17OX1cbiAgICAgICAgICAgICAgICBsYWJlbD17J01lc3NhZ2UnfVxuICAgICAgICAgICAgICAgIGluaXRpYWxUZXh0PXtjb21taXRNZXNzYWdlfVxuICAgICAgICAgICAgICAgIGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX1cbiAgICAgICAgICAgICAgICBvbkNoYW5nZT17Y29tbWl0TWVzc2FnZUNoYW5nZWR9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgICAgPFNlbXZlckNvbnRyb2xcbiAgICAgICAgICAgICAgICB0b3A9ezl9IGxlZnQ9ezMxfSB3aWR0aD17OX0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgICAgIGluaXRpYWw9e2dpdEN1cnJlbnRUYWd9XG4gICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNldEdpdEN1cnJlbnRUYWcocy50b1N0cmluZygpKVxuICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAvPlxuICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgIHRvcD17MTh9IGxlZnQ9eycwJSd9IGhlaWdodD17M30gd2lkdGg9eyczMCUnfVxuICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgICAgIHZhbGlnbj17J21pZGRsZSd9XG4gICAgICAgICAgICAgICAgYWxpZ249eydjZW50ZXInfVxuICAgICAgICAgICAgICAgIHN0eWxlPXt7Ymc6JyNmZmFhMDAnLGZnOicjMzMzMzMzJyxob3Zlcjp7Ymc6JyNmZmRkODgnLGZnOicjMzMzMzMzJ319fVxuICAgICAgICAgICAgICAgIG9uQ2xpY2s9e2NvbW1pdFN0YWdlZEZpbGVzfVxuICAgICAgICAgICAgICAgIGNvbnRlbnQ9eydcXG5jb21taXRcXG4nfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICB0b3A9ezE4fSBsZWZ0PXsnMzUlJ30gaGVpZ2h0PXszfSB3aWR0aD17JzMwJSd9XG4gICAgICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICBmb2N1c2VkXG4gICAgICAgICAgICAgICAgdmFsaWduPXsnbWlkZGxlJ31cbiAgICAgICAgICAgICAgICBhbGlnbj17J2NlbnRlcid9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3tiZzonI2ZmYWEwMCcsZmc6JyMzMzMzMzMnLGhvdmVyOntiZzonI2ZmZGQ4OCcsZmc6JyMzMzMzMzMnfX19XG4gICAgICAgICAgICAgICAgb25DbGljaz17dGFnTGFzdENvbW1pdH1cbiAgICAgICAgICAgICAgICBjb250ZW50PXtgXFxudGFnICR7Z2l0Q3VycmVudFRhZ31cXG5gfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICB0b3A9ezE4fSBsZWZ0PXsnNzAlJ30gaGVpZ2h0PXszfSB3aWR0aD17JzMwJSd9XG4gICAgICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICBmb2N1c2VkXG4gICAgICAgICAgICAgICAgdmFsaWduPXsnbWlkZGxlJ31cbiAgICAgICAgICAgICAgICBhbGlnbj17J2NlbnRlcid9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3tiZzonI2ZmYWEwMCcsZmc6JyMzMzMzMzMnLGhvdmVyOntiZzonI2ZmZGQ4OCcsZmc6JyMzMzMzMzMnfX19XG4gICAgICAgICAgICAgICAgb25DbGljaz17cHVzaENvbW1pdHN9XG4gICAgICAgICAgICAgICAgY29udGVudD17J1xcbnB1c2hcXG4nfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDxib3ggbGFiZWw9eydDb21taXRzJ30gdG9wPXsyMX0gYm9yZGVyPXt7IHR5cGU6ICdsaW5lJyB9fSBvbk1vdXNlPXsoZXZlbnQpPT57XG4gICAgICAgICAgICAgICAgY29uc3Qge3gseX09ZXZlbnQ7XG4gICAgICAgICAgICAgICAgc2V0Q29tbWl0TWVzc2FnZShzYWZlU3RyaW5naWZ5KHt4LHl9KSlcbiAgICAgICAgICAgIH19PlxuICAgICAgICAgICAgICAgIDxsaXN0XG4gICAgICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgICAgICAgICAgc2Nyb2xsYmFyPXt7IGNoOiAnPScsIHRyYWNrOiB7IGZnOidibHVlJywgYmc6ICdncmV5JyB9IH19XG4gICAgICAgICAgICAgICAgICAgIGl0ZW1zPXtnaXRDb21taXRzfVxuICAgICAgICAgICAgICAgICAgICBzdHlsZT17e3NlbGVjdGVkOiB7Ymc6ICdibHVlJ319fVxuICAgICAgICAgICAgICAgICAgICBvblNlbGVjdD17b25Db21taXRTZWxlY3R9XG4gICAgICAgICAgICAgICAgICAgIG9uU2VsZWN0SXRlbT17b25Db21taXRTZWxlY3R9XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXsnU3RhdHVzJ31cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICB7bWVzc2FnZSAmJiAoXG4gICAgICAgICAgICAgICAgPE1vZGFsRGlhbG9nXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlPVwiTWVzc2FnZVwiXG4gICAgICAgICAgICAgICAgICAgIG9uQ2xvc2U9eygpID0+IHNldE1lc3NhZ2UoZmFsc2UpfVxuICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgPHRleHQ+e21lc3NhZ2V9PC90ZXh0PlxuICAgICAgICAgICAgICAgIDwvTW9kYWxEaWFsb2c+XG4gICAgICAgICAgICApfVxuICAgICAgICA8L2JveD5cbiAgICApO1xufVxuIiwiaW1wb3J0IFJlYWN0IGZyb20gJ3JlYWN0J1xuXG5leHBvcnQgZnVuY3Rpb24gRXJyb3JGYWxsYmFjayh7IGVycm9yLCByZXNldEVycm9yQm91bmRhcnkgfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3hcbiAgICAgICAgICAgIHRvcD1cImNlbnRlclwiXG4gICAgICAgICAgICBsZWZ0PVwiY2VudGVyXCJcbiAgICAgICAgICAgIHdpZHRoPVwiNzUlXCJcbiAgICAgICAgICAgIGhlaWdodD1cIjc1JVwiXG4gICAgICAgICAgICBib3JkZXI9e3sgdHlwZTogJ2xpbmUnIH19XG4gICAgICAgICAgICBzdHlsZT17eyBmZzogJ3JlZCcgfX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgIHJpZ2h0PXswfSB0b3A9ezB9IHdpZHRoPXs5fSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICBvblByZXNzPXtyZXNldEVycm9yQm91bmRhcnl9XG4gICAgICAgICAgICAgICAgdmFsaWduPXsnbWlkZGxlJ31cbiAgICAgICAgICAgICAgICBhbGlnbj17J2NlbnRlcid9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3tiZzonI2ZmYWEwMCcsZmc6JyMzMzMzMzMnLGhvdmVyOntiZzonI2ZmZGQ4OCcsZmc6JyMzMzMzMzMnfX19XG4gICAgICAgICAgICAgICAgY29udGVudD17J2Nsb3NlJ30vPlxuICAgICAgICAgICAgPGJveCB0b3A9ezJ9IGxlZnQ9ezB9PntgU29tZXRoaW5nIHdlbnQgd3Jvbmc6XFxuJHtlcnJvci5tZXNzYWdlfVxcbiR7ZXJyb3Iuc3RhY2t9YH08L2JveD5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufSIsIi8vIEFwcC5qc1xuaW1wb3J0IFJlYWN0LCB7Q29tcG9uZW50LCB1c2VTdGF0ZSwgdXNlRWZmZWN0LCB1c2VSZWZ9IGZyb20gJ3JlYWN0JztcbmltcG9ydCB7V29ya3NwYWNlLElOb2RlfSBmcm9tICcuL1dvcmtzcGFjZSc7XG5pbXBvcnQgTW9kYWxEaWFsb2cgZnJvbSAnLi9Nb2RhbERpYWxvZy5qc3gnO1xuaW1wb3J0IHsgQm94RWxlbWVudCBhcyBib3gsIFRleHRFbGVtZW50IGFzIHRleHQsTGlzdEVsZW1lbnQgYXMgbGlzdCxCdXR0b25FbGVtZW50IGFzIGJ1dHRvbiB9IGZyb20gJ3JlYWN0LWJsZXNzZWQnO1xuaW1wb3J0IHsgR3JpZCxHcmlkSXRlbSB9IGZyb20gJ3JlYWN0LWJsZXNzZWQtY29udHJpYi0xNydcbmltcG9ydCBGb2xkZXJQaWNrZXJEaWFsb2cgZnJvbSBcIi4vRm9sZGVyUGlja2VyRGlhbG9nXCI7XG5pbXBvcnQge1RhYiwgVlRhYnN9IGZyb20gXCIuL1ZUYWJzXCI7XG5pbXBvcnQge0NvZGVCdWZmZXJFZGl0b3JDb21wb25lbnR9IGZyb20gJy4vQ29kZUJ1ZmZlckVkaXRvci5qc3gnXG5pbXBvcnQge0dpdENvbXBvbmVudH0gZnJvbSBcIi4vR2l0Q29tcG9uZW50XCI7XG5pbXBvcnQgeyBFcnJvckJvdW5kYXJ5IH0gZnJvbSAncmVhY3QtZXJyb3ItYm91bmRhcnknXG5pbXBvcnQge0Vycm9yRmFsbGJhY2t9IGZyb20gJy4vRXJyb3JGYWxsYmFjayc7XG5pbXBvcnQgRmlsZVRyZWUgZnJvbSBcIi4vRmlsZVRyZWVcIjtcbmltcG9ydCB7TGlzdENvbXBvbmVudH0gZnJvbSBcIi4vTGlzdENvbXBvbmVudFwiO1xuaW1wb3J0IHsgc2FmZVN0cmluZ2lmeSB9IGZyb20gJy4vdXRpbC5qcyc7XG4vLyBpbXBvcnQge3BhcnNlcnN9IGZyb20gXCIuL2dyYW1tYXJzXCI7XG5jb25zdCBsaXN0aW5nVG9rZW5pemVyRGVmaW5pdGlvbj17XG4gICAgbmFtZTonbGlzdGluZycsXG4gICAgZmxhZ3M6J21nJyxcbiAgICBkZWZpbml0aW9uczp7XG4gICAgICAgIFwiV2hpdGVzcGFjZVwiOiAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovXFxzKy9tZ2l9LFxuICAgICAgICBcIkNsb3NlQnV0dG9uXCI6ICAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1xcW3hdL21naX0sXG4gICAgICAgIFwiTm9kZU5hbWVcIjogICAgICAge3N0eWxlOiB7Zmc6J2dyZWVuJ30scGF0dGVybjovWy9hLXpBLVowLTlfPXt9XFxbXFxdJSooKW0sLjo7IT9Afi1dKy9tZ2l9LFxuICAgICAgICBcIldvcmRcIjogICAgICAgICAgIHtzdHlsZToge2ZnOid5ZWxsb3cnfSxwYXR0ZXJuOi9cXHMuKz9cXHMvbWdpfSxcbiAgICB9XG59XG5leHBvcnQgZnVuY3Rpb24gQXBwKHByb3BzKXtcbiAgLy8gU29tZSBDb21lbnRcbiAgY29uc3Qgb3BlbmVkRmlsZXNSZWY9dXNlUmVmKG51bGwpO1xuICBjb25zdCBbbWVzc2FnZSwgc2V0TWVzc2FnZV0gPSB1c2VTdGF0ZShmYWxzZSk7XG4gIGNvbnN0IFtwaWNrRm9sZGVyLCBzZXRQaWNrRm9sZGVyXSA9IHVzZVN0YXRlKGZhbHNlKTtcbiAgY29uc3QgW2N1cnJlbnRFZGl0b3JUZXh0LCBzZXRDdXJyZW50RWRpdG9yVGV4dF0gPSB1c2VTdGF0ZSgnJyk7XG4gIGNvbnN0IFtzZWxlY3RlZEZpbGUsIHNldFNlbGVjdGVkRmlsZV0gPSB1c2VTdGF0ZShudWxsKTtcbiAgY29uc3QgW29wZW5lZEZpbGVzLCBzZXRPcGVuZWRGaWxlc10gPSB1c2VTdGF0ZSh7fSk7XG4gIGNvbnN0IFtmaWxlQ29udGVudCwgc2V0RmlsZUNvbnRlbnRdICAgPSB1c2VTdGF0ZSgnJyk7XG4gIGNvbnN0IFtyb290RGlyLCBzZXRSb290RGlyXSAgID0gdXNlU3RhdGUocHJvY2Vzcy5jd2QoKSk7XG4gIGNvbnN0IFtnaXRTdGF0dXMsIHNldEdpdFN0YXR1c10gPSB1c2VTdGF0ZShbXSk7XG5cblxuICBjb25zdCBvbkZpbGVQYXRoU2VsZWN0ID0gKGV2ZW50KSA9PiB7XG4gICAgc2V0TWVzc2FnZShgZmlsZSBwYXRoIHNlbGVjdGVkICR7ZXZlbnQuY29udGVudH0gJHtwcm9jZXNzLmN3ZCgpfWApXG4gIH07XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0lOb2RlfSBub2RlXG4gICAgICovXG4gIGNvbnN0IHNlbGVjdEZpbGUgPSAobm9kZSkgPT4ge1xuICAgIHNldFNlbGVjdGVkRmlsZShub2RlLmZ1bGxQYXRoKVxuICAgIGNvbnN0IG5ld09wZW5lZEZpbGVzPXsuLi5vcGVuZWRGaWxlc31cbiAgICBuZXdPcGVuZWRGaWxlc1tub2RlLmZ1bGxQYXRoLnJlcGxhY2Uocm9vdERpciwnJyldID0gbm9kZVxuICAgIHNldE9wZW5lZEZpbGVzKG5ld09wZW5lZEZpbGVzKVxuICAgIHNldEZpbGVDb250ZW50KGBMb2FkaW5nICR7bm9kZS5yZWxQYXRofWApXG4gICAgbm9kZS5yZWFkRmlsZShub2RlLmZ1bGxQYXRoKS50aGVuKHNldEZpbGVDb250ZW50KTtcbiAgfTtcbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSB7SU5vZGV9IGRpclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGNvbnN0IHNlbGVjdERpciA9IGFzeW5jIChkaXIpID0+IHtcbiAgICBzZXRNZXNzYWdlKGBkaXIgc2VsZWN0ZWQgJHtPYmplY3Qua2V5cyhkaXIpfWApXG4gIH07XG4gIGNvbnN0IG9uVGV4dEVkaXRvclNhdmUgPSAoYSxiLGMpPT4ge1xuICAgICAgc2V0TWVzc2FnZShKU09OLnN0cmluZ2lmeSh7YSxiLGN9KSlcbiAgfVxuICBjb25zdCBvblRleHRFZGl0b3JDYW5jZWwgPSAoYSxiLGMpPT4ge1xuICAgICAgc2V0TWVzc2FnZShKU09OLnN0cmluZ2lmeSh7YSxiLGN9KSlcbiAgfVxuICBjb25zdCBvbkN1cnJlbnRFZGl0b3JDaGFuZ2UgPSAoe2VkaXRvcixjaCxrZXksc2NyZWVuRXZlbnQsdmlld3BvcnR9KT0+IHtcbiAgICBzZXRDdXJyZW50RWRpdG9yVGV4dChzYWZlU3RyaW5naWZ5KHtlZGl0b3I6IHtjdXJzb3JzOmVkaXRvci5jdXJzb3JzfSx2aWV3cG9ydCxjaCxrZXksc2NyZWVuRXZlbnR9KSlcbiAgfVxuICBjb25zdCBvbkNvZGVFZGl0S2V5UHJlc3MgPSAoY2gsa2V5KT0+IHtcbiAgICAvLyBzZXRDdXJyZW50RWRpdG9yVGV4dChKU09OLnN0cmluZ2lmeSh7Y2gsa2V5fSkpXG4gIH1cbiAgY29uc3QgZGVidWdWaWV3PSgpPT57XG4gICAgICBjb25zdCBjb250ZW50ID0gYERlYnVnOlxcbiR7KCdwYXJzZWQgc29tZSB0ZXh0Jyl9YFxuICAgICAgcmV0dXJuIDxib3ggY29udGVudD17Y29udGVudH0vPlxuICB9XG4gIGNvbnN0IGxpc3RPcGVuZWRGaWxlcz0oKT0+e1xuICAgICAgaWYob3BlbmVkRmlsZXNSZWYgPT09IG51bGwpIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG4gICAgICBpZihvcGVuZWRGaWxlc1JlZi5jdXJyZW50ID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgICAgY29uc3QgbHBvcyA9IG9wZW5lZEZpbGVzUmVmLmN1cnJlbnQubHBvc1xuICAgICAgcmV0dXJuIE9iamVjdC5rZXlzKG9wZW5lZEZpbGVzKS5tYXAoXG4gICAgICAgICAgayA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiBrLnBhZEVuZChscG9zLndpZHRoLTYsJyAnKSsnW3hdJ1xuICAgICAgICAgIH1cbiAgICAgIClcbiAgfVxuXG4gICAgY29uc3Qgb25Ub2tlbkNsaWNrPShldmVudERhdGEpPT57XG4gICAgICAgIGNvbnN0IHRyZWVEYXRhID0gbGlzdE9wZW5lZEZpbGVzKClcbiAgICAgICAgY29uc3Qge2xpbmVzLCB2aXNpYmxlTGluZXMsIGxpbmUsIGN1cnNvcjp7eCx5fSxjdXJzb3JTY3JlZW4sIGJ1ZmZlciwgdmlzaWJsZUJ1ZmZlciwgaW5kZXgsdG9rZW5zLHRva2VuVW5kZXJDdXJzb3IscGhyYXNlfSA9IGV2ZW50RGF0YVxuXG4gICAgICAgIGxldCBrID0gT2JqZWN0LmtleXMob3BlbmVkRmlsZXMpW3ldXG4gICAgICAgIGxldCBub2RlID0gb3BlbmVkRmlsZXNba107XG4gICAgICAgIC8vIHRocm93IEpTT04uc3RyaW5naWZ5KHtub2RlLHl9LG51bGwsICcgJylcbiAgICAgICAgLy8gaWYgKG5vZGUudHlwZS5pbmRleE9mKCdkJyk+LTEpIHtcbiAgICAgICAgc3dpdGNoKHBocmFzZS5maWx0ZXIodiA9PiB2IT09J1doaXRlc3BhY2UnKS5qb2luKFwiLFwiKSl7XG4gICAgICAgICAgICBjYXNlIFwiV2hpdGVzcGFjZSxOb2RlTmFtZVwiOlxuICAgICAgICAgICAgY2FzZSBcIk5vZGVOYW1lLENsb3NlQnV0dG9uXCI6XG4gICAgICAgICAgICAgICAgc3dpdGNoKCh0b2tlblVuZGVyQ3Vyc29yfHx7dHlwZTondW5kZWZpbmVkJ30pLnR5cGUpe1xuICAgICAgICAgICAgICAgICAgICBjYXNlIFwiTm9kZU5hbWVcIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGVjdEZpbGUobm9kZSlcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDowLHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJDbG9zZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3T3BlbmVkRmlsZXM9ey4uLm9wZW5lZEZpbGVzfVxuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIG5ld09wZW5lZEZpbGVzW2tdO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2V0T3BlbmVkRmlsZXMobmV3T3BlbmVkRmlsZXMpXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRNZXNzYWdlKGBDbG9zZVxcbiR7bm9kZS5mdWxsUGF0aH0gc2VsZWN0ZWRGaWxlOiR7c2VsZWN0ZWRGaWxlfSBub2RlLmZ1bGxQYXRoOiR7bm9kZS5mdWxsUGF0aH0gYClcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmKHNlbGVjdGVkRmlsZSA9PT0gbm9kZS5mdWxsUGF0aCl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgayA9IE9iamVjdC5rZXlzKG9wZW5lZEZpbGVzKVt5LTFdXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbm9kZSA9IG9wZW5lZEZpbGVzW2tdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldFNlbGVjdGVkRmlsZShub2RlLmZ1bGxQYXRoKVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzZXRDdXJzb3JEYXRhKHtjdXJzb3I6e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5fSxjdXJzb3JTY3JlZW46e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5OmN1cnNvclNjcmVlbi55fSxjb250ZW50OnRva2VuVW5kZXJDdXJzb3IudGV4dCxzdHlsZTp0b2tlblVuZGVyQ3Vyc29yLnN0eWxlfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIHBocmFzZSBTdHJ1Y3R1cmUgJyR7cGhyYXNlfSdgKVxuICAgICAgICB9XG4gICAgfVxuICByZXR1cm4gKFxuICAgICAgPD5cbiAgICAgIDxHcmlkIHJvd3M9ezh9IGNvbHM9ezE1fSBoaWRlQm9yZGVyPlxuICAgICAgICAgIDxWVGFicyByb3c9ezB9IGNvbD17MH0gcm93U3Bhbj17OH0gY29sU3Bhbj17NX0+XG4gICAgICAgICAgICAgIDxUYWIgbmFtZT0nUHJvamVjdCc+XG4gICAgICAgICAgICAgICAgICA8R3JpZCByb3dzPXs4fSBjb2xzPXsxfT5cbiAgICAgICAgICAgICAgICAgIDxib3gga2V5PXsxfSByb3c9ezB9IGNvbD17MH0gcm93U3Bhbj17M30gY29sU3Bhbj17MX1cbiAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9eydvcGVuZWQgRmlsZXMnfSAgcmVmPXtvcGVuZWRGaWxlc1JlZn0+XG4gICAgICAgICAgICAgICAgICAgICAgPExpc3RDb21wb25lbnRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbGluZXM9e2xpc3RPcGVuZWRGaWxlcygpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0VGV4dD17Jyd9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGtleXMgbW91c2Ugc2Nyb2xsIHN0eWxlPXt7IHNlbGVjdGVkOiB7IGJnOiAnYmx1ZScgfSB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICBzY3JvbGxiYXI9e3sgY2g6ICc9JywgdHJhY2s6IHsgZmc6J2JsdWUnLCBiZzogJ2dyZXknIH0gfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2tlbkNsaWNrPXtvblRva2VuQ2xpY2t9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRva2VuaXplckRlZj17bGlzdGluZ1Rva2VuaXplckRlZmluaXRpb259XG4gICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgPGJveCBrZXk9ezJ9XG4gICAgICAgICAgICAgICAgICAgICAgIHJvdz17M30gY29sPXswfSByb3dTcGFuPXs1fSBjb2xTcGFuPXsxfVxuICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17J1Byb2plY3QnfT5cblxuICAgICAgICAgICAgICAgICAgICAgIDxGaWxlVHJlZVxuICAgICAgICAgICAgICAgICAgICAgICAgICB0b3A9ezB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJvdHRvbT17MH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgcm9vdERpcj17cm9vdERpcn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgb25EaXJTZWxlY3Q9e3NlbGVjdERpcn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgb25GaWxlU2VsZWN0PXtzZWxlY3RGaWxlfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17J1Byb2plY3QnfVxuICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJvdHRvbT17MH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhlaWdodD17M31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17J21pZGRsZSd9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbGlnbj17J2NlbnRlcid9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdHlsZT17e2JnOicjZmZhYTAwJyxmZzonIzMzMzMzMycsaG92ZXI6e2JnOicjZmZkZDg4JyxmZzonIzMzMzMzMyd9fX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXRQaWNrRm9sZGVyKHRydWUpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudD17J3dvcmtzcGFjZSd9Lz5cbiAgICAgICAgICAgICAgICAgICAgICA8L0ZpbGVUcmVlPlxuICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICA8L0dyaWQ+XG4gICAgICAgICAgICAgIDwvVGFiPlxuICAgICAgICAgICAgICA8VGFiIG5hbWU9J0dpdCc+XG4gICAgICAgICAgICAgICAgICA8R2l0Q29tcG9uZW50IHJvb3REaXI9e3Jvb3REaXJ9IHJvdz17MH0gY29sPXsxfSByb3dTcGFuPXsxfSBjb2xTcGFuPXs1fS8+XG4gICAgICAgICAgICAgIDwvVGFiPlxuICAgICAgICAgICAgICA8VGFiIG5hbWU9eydEZWJ1Zyd9PlxuICAgICAgICAgICAgICAgICAgPGJveD5cbiAgICAgICAgICAgICAgICAgICAgICB7ZGVidWdWaWV3KCl9XG4gICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgPC9UYWI+XG4gICAgICAgICAgICAgIDxUYWIgbmFtZT17J1F1aXQnfSBvblRhYkNsaWNrPXsoKT0+e3Byb2Nlc3MuZXhpdCgwKX19PlxuICAgICAgICAgICAgICAgICAgPGJveCBvblRhYkNsaWNrPXsoKT0+e3Byb2Nlc3MuZXhpdCgwKX19PlxuICAgICAgICAgICAgICAgICAgICAgIHtkZWJ1Z1ZpZXcoKX1cbiAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICA8L1RhYj5cbiAgICAgICAgICA8L1ZUYWJzPlxuICAgICAgICAgIHsvKiBDZW50ZXIgcGFuZWwgKi99XG4gICAgICAgICAgPENvZGVCdWZmZXJFZGl0b3JDb21wb25lbnQgcm93PXswfSBjb2w9ezV9IHJvd1NwYW49ezZ9IGNvbFNwYW49ezEwfVxuICAgICAgICAgICAgICAgICAgICAgIGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX1cbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17KHNlbGVjdGVkRmlsZSB8fCAnTm8gZmlsZSBzZWxlY3RlZCcpLnJlcGxhY2Uocm9vdERpciwnJyl9XG4gICAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGg9e3NlbGVjdGVkRmlsZXx8bnVsbH1cbiAgICAgICAgICAgICAgICAgICAgICBvbktleXByZXNzPXtvbkNvZGVFZGl0S2V5UHJlc3N9XG4gICAgICAgICAgICAgICAgICAgICAgb25DaGFuZ2U9e29uQ3VycmVudEVkaXRvckNoYW5nZX1cbiAgICAgICAgICAgICAgICAgICAgICBvbkV2ZW50PXtvbkN1cnJlbnRFZGl0b3JDaGFuZ2V9XG4gICAgICAgICAgLz5cbiAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgIHJvdz17Nn0gY29sPXs1fSByb3dTcGFuPXsyfSBjb2xTcGFuPXsxMH1cbiAgICAgICAgICAgICAgYm9yZGVyPXt7IHR5cGU6ICdsaW5lJyB9fVxuICAgICAgICAgICAgICBzY3JvbGxhYmxlXG4gICAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICAgIGxhYmVsPXsnVGVybWluYWwnfVxuICAgICAgICAgICAgICBvdmVyZmxvdz17J3Njcm9sbCd9XG4gICAgICAgICAgPlxuICAgICAgICAgICAgICB7Y3VycmVudEVkaXRvclRleHR9XG4gICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgey8qPExheW91dENhdGNoZXIgIHJvdz17MH0gY29sPXs1fSByb3dTcGFuPXs2fSBjb2xTcGFuPXsxMH0vPiovfVxuICAgICAgICA8L0dyaWQ+XG4gICAgICAgIHttZXNzYWdlICYmIChcbiAgICAgICAgICAgIDxNb2RhbERpYWxvZ1xuICAgICAgICAgICAgICAgIGxhYmVsPXsnTWVzc2FnZSd9XG4gICAgICAgICAgICAgICAgdGl0bGU9XCJNZXNzYWdlXCJcbiAgICAgICAgICAgICAgICBvbkNsb3NlPXsoKSA9PiBzZXRNZXNzYWdlKGZhbHNlKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgPHRleHQ+e21lc3NhZ2V9PC90ZXh0PlxuICAgICAgICAgICAgPC9Nb2RhbERpYWxvZz5cbiAgICAgICAgKX1cbiAgICAgICAge3BpY2tGb2xkZXIgJiZcbiAgICAgICAgICAgICg8RXJyb3JCb3VuZGFyeVxuICAgICAgICAgICAgICAgIEZhbGxiYWNrQ29tcG9uZW50PXtFcnJvckZhbGxiYWNrfVxuICAgICAgICAgICAgICAgIG9uUmVzZXQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc2V0UGlja0ZvbGRlcihmYWxzZSlcbiAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgIG9uQ2xvc2U9eygpID0+IHNldFBpY2tGb2xkZXIoZmFsc2UpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgPEZvbGRlclBpY2tlckRpYWxvZ1xuICAgICAgICAgICAgICAgIHRpdGxlPVwiUGljayBGb2xkZXJcIlxuICAgICAgICAgICAgICAgIG9uRm9sZGVyU2VsZWN0PXsoaW5vZGUpPT57XG4gICAgICAgICAgICAgICAgICAgIHNldFBpY2tGb2xkZXIoZmFsc2UpXG4gICAgICAgICAgICAgICAgICAgIGlmKGlub2RlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRNZXNzYWdlKGBzZWxlY3RlZCBmb2xkZXIgJHtpbm9kZS5mdWxsUGF0aH1gKVxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0Um9vdERpcihpbm9kZS5mdWxsUGF0aClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9FcnJvckJvdW5kYXJ5PilcbiAgICAgICAgfVxuICAgIDwvPlxuICApO1xufVxuIiwiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuaW1wb3J0ICdyYWYvcG9seWZpbGwnO1xuaW1wb3J0IGJsZXNzZWQgZnJvbSAnbmVvLWJsZXNzZWQnXG5pbXBvcnQgeyByZW5kZXIgfSBmcm9tICdyZWFjdC1ibGVzc2VkJztcbmltcG9ydCB7QXBwfSBmcm9tICcuL3NyYy9BcHAnO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJ1xuaW1wb3J0IFwibmVvLWJsZXNzZWQvbGliL3dpZGdldHMvbm9kZVwiOyAgICAgICAvLyBsaXRlcmFsIHBhdGggc28gdHJlZS1zaGFrZXIga2VlcHMgaXRcbmltcG9ydCBcIm5lby1ibGVzc2VkL2xpYi93aWRnZXRzL2VsZW1lbnRcIjsgICAgLy8gYWRkIG90aGVycyBpZiB5b3VyIGNvZGUgcmVhY2hlcyB0aGVtXG5pbXBvcnQgXCJuZW8tYmxlc3NlZC9saWIvd2lkZ2V0cy9zY3JlZW5cIjsgICAgICAgLy8gbGl0ZXJhbCBwYXRoIHNvIHRyZWUtc2hha2VyIGtlZXBzIGl0XG5pbXBvcnQgXCJuZW8tYmxlc3NlZC9saWIvYmxlc3NlZFwiOyAgICAvLyBhZGQgb3RoZXJzIGlmIHlvdXIgY29kZSByZWFjaGVzIHRoZW1cbmltcG9ydCB2ZXJzaW9uIGZyb20gJy4vdmVyc2lvbi5qc29uJ1xuXG5jb25zdCBzY3JlZW4gPSBibGVzc2VkLnNjcmVlbih7XG4gIHNtYXJ0Q1NSOiB0cnVlLFxuICBhdXRvUGFkZGluZzogdHJ1ZSxcbiAgdGl0bGU6IGBSZWFjdC1CbGVzc2VkIElERSAke3ZlcnNpb24udGFnfSAke3ZlcnNpb24uYnJhbmNofSAke3ZlcnNpb24uY29tbWl0fSAke3ZlcnNpb24udGltZX1gLFxuICBkdW1wOiAndGVybWluYWwtZHVtcC5sb2cnXG59KTtcblxuLy8gcXVpdCBvbiBDdHJsK0NcbnNjcmVlbi5rZXkoW1wiQy1xXCIsICdmMTInXSwgKCkgPT4gcHJvY2Vzcy5leGl0KDApKTtcbnNjcmVlbi5rZXkoW1wiQy1zXCIsIFwiQy1TLXNcIiwgJ2Y4J10sICgpID0+IHtcbiAgLy8gYWZ0ZXIgeW914oCZdmUgY3JlYXRlZCB5b3VyIHNjcmVlbuKAplxuICBjb25zdCBkdW1wID0gc2NyZWVuLnNjcmVlbnNob3QoKTsgICAgICAvLyB3aG9sZSBzY3JlZW5cbi8vIG9yIGxpbWl0IHRvIGEgcmVnaW9uOiBzY3JlZW5zaG90KHgxLCB4MiwgeTEsIHkyKVxuICBmcy53cml0ZUZpbGVTeW5jKCdidWZmZXIuc2dyJywgZHVtcCwgJ3V0ZjgnKTtcbiAgY29uc29sZS5sb2coJ1dyb3RlIFNHUiBkdW1wIHRvIGJ1ZmZlci5zZ3InKTtcbiAgLy8gbmV3IE1lc3NhZ2UoKS5kaXNwbGF5KCdCdWZmZXIgc2F2ZWQhJywgMSwgKCkgPT4gc2NyZWVuLnJlbmRlcigpKTtcbn0pO1xuc2NyZWVuLmVuYWJsZU1vdXNlKClcblxucmVuZGVyKDxBcHAgLz4sIHNjcmVlbik7Il0sIm5hbWVzIjpbImZzIiwidXNlUmVmIiwidXNlRWZmZWN0IiwianN4cyIsImpzeCIsImRlZmF1bHRUZXh0IiwiZWRpdG9yIiwic2V0RWRpdG9yIiwidXNlU3RhdGUiLCJib3giLCJsaXN0aW5nVG9rZW5pemVyRGVmaW5pdGlvbiIsImxpbmVzIiwid2siLCJjdXJzb3IiLCJGcmFnbWVudCIsIkdyaWQiLCJ0ayIsImNwIiwiY29weSIsInRhZyIsImJyYW5jaCIsIkVycm9yQm91bmRhcnkiLCJyZW5kZXIiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQU1BLE1BQU0sY0FBWSxDQUFDLFNBQVE7QUFDekIsUUFBTSxVQUFRO0FBQUEsSUFDWixLQUFJO0FBQUE7QUFBQSxJQUNKLEtBQUk7QUFBQTtBQUFBLElBQ0osS0FBSTtBQUFBO0FBQUEsSUFDSixLQUFJO0FBQUE7QUFBQSxJQUNKLEtBQUk7QUFBQTtBQUFBLElBQ0osS0FBSTtBQUFBO0FBQUEsSUFDSixLQUFJO0FBQUE7QUFBQSxFQUNSO0FBQ0UsUUFBTSxLQUFHLEtBQUssS0FBSyxRQUFRLE9BQU0s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
