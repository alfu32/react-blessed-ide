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
    crs.x = x;
    crs.y = y;
    const lineNumber = parseInt(y);
    let tokens = null;
    try {
      tokens = this.tokenizer(line, lineNumber);
    } catch (err) {
      tokens = this.tokens[y];
    }
    let col = 0;
    crs.char = this.lines[y][x] || " ";
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
    let hasChanged = false;
    let mustRender = false;
    const clicks = Array.from(screenEvent.buf || []).filter((v) => v === 77).length;
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
        this.scrollViewport(-this.viewportHeight);
        break;
      case "pagedown":
        this.scrollViewport(this.viewportHeight);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlcyI6WyIuLi9zcmMvV29ya3NwYWNlLmpzIiwiLi4vc3JjL01vZGFsRGlhbG9nLmpzeCIsIi4uL3NyYy91dGlsLmpzIiwiLi4vc3JjL3Rva2VuaXplci5qcyIsIi4uL3NyYy9TaW1wbGVUZXh0RWRpdG9yLmpzIiwiLi4vc3JjL0xpc3RDb21wb25lbnQuanN4IiwiLi4vc3JjL0ZpbGVUcmVlLmpzeCIsIi4uL3NyYy9Gb2xkZXJQaWNrZXJEaWFsb2cuanN4IiwiLi4vc3JjL1ZUYWJzLmpzeCIsIi4uL3NyYy9Db2RlQnVmZmVyRWRpdG9yLmpzIiwiLi4vc3JjL0NvZGVCdWZmZXJFZGl0b3IuanN4IiwiLi4vc3JjL0dpdENvbXBvbmVudC5zZXJ2aWNlLmpzIiwiLi4vc3JjL1NpbXBsZVRleHRFZGl0b3IuanN4IiwiLi4vc3JjL1NlbXZlci5qcyIsIi4uL3NyYy9TZW12ZXIuanN4IiwiLi4vc3JjL0dpdENvbXBvbmVudC5qc3giLCIuLi9zcmMvRXJyb3JGYWxsYmFjay5qc3giLCIuLi9zcmMvQXBwLmpzeCIsIi4uL2luZGV4LmpzeCJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBzZXJ2aWNlcy9Xb3Jrc3BhY2UuanNcblxuaW1wb3J0IHsgcHJvbWlzZXMgYXMgZnMgfSBmcm9tICdmcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBpZ25vcmUgZnJvbSAnaWdub3JlJztcblxuY29uc3QgaW5vZGVTb3J0Qnk9KG5vZGUpPT4ge1xuICBjb25zdCBtYXBwaW5nPXtcbiAgICAnZCc6MSwvLyBEaXJlY3RvcnlcbiAgICAnZic6MiwvLyBGaWxlXG4gICAgJ2wnOjIsLy8gU3ltYm9saWNMaW5rXG4gICAgJ2InOjIsLy8gQmxvY2tEZXZpY2VcbiAgICAnYyc6MiwvLyBDaGFyYWN0ZXJEZXZpY2VcbiAgICAncCc6MiwvLyBGSUZPXG4gICAgJ3MnOjIsLy8gU29ja2V0XG4gIH1cbiAgY29uc3QgbnQ9bm9kZS50eXBlLnJlcGxhY2UoLy0vZ2ksJycpXG4gIHJldHVybiBgJHtub2RlLnBhcmVudEZ1bGxOYW1lKCkuc3BsaXQoJy8nKS5tYXAobm4gPT4gYDF8JHtubn1gKS5qb2luKFwiL1wiKX0vJHttYXBwaW5nW250XX18JHtub2RlLm5hbWV9YFxufVxuY29uc3QgY29tcGFyZUlub2Rlcz0obmEsbmIpID0+IHtcbiAgY29uc3Qgc2EgPSBpbm9kZVNvcnRCeShuYSlcbiAgY29uc3Qgc2I9aW5vZGVTb3J0QnkobmIpXG4gIHJldHVybiBzYTxzYj8tMTooc2E9PT1zYik/MDoxXG59XG5cbmV4cG9ydCBjbGFzcyBJTm9kZXtcbiAgaWQ9MCAgICAgICAgLy8vIChmaWxlIHN0YXQgaW5vKVxuICB0eXBlPScnICAgICAgLy8vICAoIG9uZSBvZiAnZCcsJ2YnLCdsJywncCcsJ2MnLCdwJywncycpXG4gIG5hbWU9XCJcIiAgICAgIC8vLyAgZmlsZSBuYW1lXG4gIGZ1bGxQYXRoPVwiXCIgIC8vLyBcbiAgcmVsUGF0aD1cIlwiICAvLy8gXG4gIGlzT3Blbj1mYWxzZSAgICAvLy8gKGRlZmF1bHQgZmFsc2UpXG4gIGNoaWxkcmVuPVtdICAvLy8gW11JTm9kZVxuICBlbnRyaWVzPVtdICAvLy8gW11JTm9kZVxuXG4gIGFzeW5jIHJlYWRGaWxlKCkge1xuICAgIHJldHVybiBmcy5yZWFkRmlsZSh0aGlzLmZ1bGxQYXRoLCAndXRmOCcpO1xuICB9XG4gIGRlcHRoKCl7XG4gICAgcmV0dXJuIHRoaXMuZnVsbFBhdGguc3BsaXQoXCIvXCIpLmxlbmd0aFxuICB9XG4gIHBhcmVudEZ1bGxOYW1lKCl7XG4gICAgcmV0dXJuIHRoaXMuZnVsbFBhdGgucmVwbGFjZShgLyR7dGhpcy5uYW1lfWAsJycpXG4gIH1cbiAgdG9UZXh0KCl7XG5cbiAgICBjb25zdCBudD10aGlzLnR5cGUucmVwbGFjZSgvLS9naSwnJylcbiAgICBjb25zdCBtYXJrZXIgPSB0aGlzLnR5cGUuaW5kZXhPZignZCcpPi0xXG4gICAgICA/ICh0aGlzLmlzT3BlbiA/ICcgWy1dJyA6ICcgWytdJylcbiAgICAvLyAgOiBgIFske250fV1gO1xuICAgICAgOiBgYDtcbiAgICByZXR1cm4gYCR7JyAnLnJlcGVhdCh0aGlzLmRlcHRoKCkqMil9JHttYXJrZXJ9ICR7dGhpcy5uYW1lfWBcbiAgfVxuICB0b1RleHQyKCl7XG4gICAgcmV0dXJuIGlub2RlU29ydEJ5KHRoaXMpXG4gIH1cblxuICAvKipcbiAgICpcbiAgICogQHJldHVybnMge0lOb2RlW119XG4gICAqL1xuICBmbGF0dGVuICgpe1xuICAgIGxldCBvdXQgPVtdXG4gICAgb3V0LnB1c2godGhpcyk7XG4gICAgaWYgKHRoaXMuaXNPcGVuKSB7XG4gICAgICBjb25zdCBvID0gdGhpcy5jaGlsZHJlbi5mbGF0TWFwKGNoaWxkID0+IGNoaWxkLmZsYXR0ZW4oKSk7XG4gICAgICBvLmZvckVhY2gobiA9PiBvdXQucHVzaChuKSlcbiAgICB9XG4gICAgcmV0dXJuIG91dDtcbiAgfVxuICBcbiAgLyoqXG4gICAqIFxuICAgKiBAcGFyYW0ge3N0cmluZ30gcm9vdERpciBcbiAgICogQHBhcmFtIHtzdHJpbmd9IGN1cnJlbnRQYXRoIFxuICAgKiBAcGFyYW0ge2lnbm9yZWRQYXRoc30gaWcgXG4gICAqIEByZXR1cm5zIHtJTm9kZX0gc2VsZlxuICAgKi9cbiAgYXN5bmMgaW5pdChyb290RGlyLCBpZywgY3VycmVudFBhdGgpe1xuICAgIHRoaXMuZnVsbFBhdGg9Y3VycmVudFBhdGhcbiAgICBsZXQgc3RhdCA9IGF3YWl0IGZzLnN0YXQodGhpcy5mdWxsUGF0aCk7XG4gICAgdGhpcy5pZD1zdGF0Lmlub1xuICAgIHRoaXMudHlwZT1bXG4gICAgICBzdGF0LmlzRGlyZWN0b3J5KCk/J2QnOictJyxcbiAgICAgIHN0YXQuaXNGaWxlKCk/J2YnOictJyxcbiAgICAgIHN0YXQuaXNTeW1ib2xpY0xpbmsoKT8nbCc6Jy0nLFxuICAgICAgc3RhdC5pc0Jsb2NrRGV2aWNlKCk/J2InOictJyxcbiAgICAgIHN0YXQuaXNDaGFyYWN0ZXJEZXZpY2UoKT8nYyc6Jy0nLFxuICAgICAgc3RhdC5pc0ZJRk8oKT8ncCc6Jy0nLFxuICAgICAgc3RhdC5pc1NvY2tldCgpPydzJzonLScsXG4gICAgXS5qb2luKFwiXCIpXG4gICAgdGhpcy5uYW1lID0gcGF0aC5iYXNlbmFtZSh0aGlzLmZ1bGxQYXRoKTtcbiAgICB0aGlzLnJlbFBhdGggPSBwYXRoLnJlbGF0aXZlKHJvb3REaXIsIHRoaXMuZnVsbFBhdGgpO1xuICAgIHRoaXMuaXNPcGVuPWZhbHNlXG4gICAgdGhpcy5jaGlsZHJlbj1bXVxuICAgIGlmKHRoaXMudHlwZS5pbmRleE9mKCdkJyk+LTEpe1xuICAgICAgdHJ5e1xuICAgICAgICB0aGlzLmVudHJpZXMgPSBhd2FpdCBmcy5yZWFkZGlyKHRoaXMuZnVsbFBhdGgpXG4gICAgICB9Y2F0Y2goZXJyKXtcbiAgICAgICAgdGhpcy5lbnRyaWVzPVtdXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZW50cmllcz1bXVxuICAgIH1cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSByb290RGlyXG4gICAqIEBwYXJhbSBpZ1xuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJTm9kZT59XG4gICAqL1xuICBhc3luYyBvcGVuKHJvb3REaXIsaWcpe1xuICAgIHRoaXMuaXNPcGVuPXRydWU7XG4gICAgdGhpcy5jaGlsZHJlbj0oYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIHRoaXMuZW50cmllcy5tYXAoZW50cnkgPT4ge1xuICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgIGNvbnN0IGlub2RlMSA9IG5ldyBJTm9kZSgpXG4gICAgICAgICAgICBpbm9kZTEuZnVsbFBhdGggPSBwYXRoLmpvaW4odGhpcy5mdWxsUGF0aCwgZW50cnkpXG4gICAgICAgICAgICByZXR1cm4gaW5vZGUxLmluaXQocm9vdERpciwgaWcsIGlub2RlMS5mdWxsUGF0aClcbiAgICAgICAgICB9Y2F0Y2goZXJyKXtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobnVsbClcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgKSkuZmlsdGVyKGsgPT4gayAhPT0gbnVsbClcbiAgICB0aGlzLmNoaWxkcmVuLnNvcnQoY29tcGFyZUlub2RlcylcbiAgICByZXR1cm4gdGhpc1xuICB9XG4gIGFzeW5jIGNsb3NlKHJvb3REaXIsaWcpe1xuICAgIHRoaXMuaXNPcGVuPWZhbHNlO1xuICAgIHRoaXMuY2hpbGRyZW49W11cbiAgfVxuICAvKipcbiAgICogXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjdXJyZW50UGF0aCBcbiAgICogQHBhcmFtIHtzdHJpbmd9IHJvb3REaXIgXG4gICAqIEBwYXJhbSB7aWdub3JlZFBhdGhzfSBpZyBcbiAgICogQHJldHVybnMge0lOb2RlfSBzZWxmXG4gICAqL1xuICBhc3luYyByZWZyZXNoKHJvb3REaXIsaWcpe1xuXG4gICAgdGhpcy5uYW1lID0gcGF0aC5iYXNlbmFtZSh0aGlzLmZ1bGxQYXRoKTtcbiAgICB0aGlzLnJlbFBhdGggPSBwYXRoLnJlbGF0aXZlKHJvb3REaXIsIHRoaXMuZnVsbFBhdGgpO1xuXG4gICAgLy8gc2tpcCBhbnl0aGluZyB0aGUgLmdpdGlnbm9yZSBzYXlzIHRvIGlnbm9yZVxuICAgIGlmICh0aGlzLnJlbFBhdGggJiYgKGlnLmlnbm9yZXModGhpcy5yZWxQYXRoKSB8fCB0aGlzLm5hbWUgPT09IFwiLmdpdFwiKSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIC8vIGxldCBpbm9kZSA9bmV3IElOb2RlKClcbiAgICAvLyBhd2FpdCB0aGlzLmluaXQocm9vdERpciwgaWcsIHRoaXMuZnVsbFBhdGgpXG5cbiAgICBpZiAodGhpcy50eXBlLmluZGV4T2YoJ2QnKT4tMSkge1xuICAgICAgY29uc3QgZW50cmllcyA9IGF3YWl0IGZzLnJlYWRkaXIodGhpcy5mdWxsUGF0aCk7XG4gICAgICB0aGlzLmVudHJpZXM9ZW50cmllc1xuICAgICAgbGV0IGNoaWxkcmVuID0gKGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICBlbnRyaWVzLm1hcChlbnRyeSA9PiB7XG4gICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgY29uc3QgaW5vZGUxID0gbmV3IElOb2RlKClcbiAgICAgICAgICAgIGlub2RlMS5mdWxsUGF0aCA9IHBhdGguam9pbih0aGlzLmZ1bGxQYXRoLCBlbnRyeSlcbiAgICAgICAgICAgIGlub2RlMS5pbml0KHJvb3REaXIsIGlnLCB0aGlzLmZ1bGxQYXRoKVxuICAgICAgICAgICAgcmV0dXJuIGlub2RlMS5yZWZyZXNoKHJvb3REaXIsIGlnKVxuICAgICAgICAgIH1jYXRjaCAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShudWxsKVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICkpLmZpbHRlciggayA9PiBrIT09bnVsbClcbiAgICAgIGNoaWxkcmVuPWNoaWxkcmVuLmZpbHRlcih4ID0+IHghPT0gbnVsbClcbiAgICAgICAgLnNvcnQoY29tcGFyZUlub2RlcylcbiAgICAgIHRoaXMuY2hpbGRyZW49Y2hpbGRyZW5cbiAgICB9XG4gICAgcmV0dXJuIHRoaXNcblxuICB9XG59XG5cblxuXG5leHBvcnQgY2xhc3MgV29ya3NwYWNle1xuICByb290RGlyPVwiXCJcbiAgcm9vdE5vZGU9bmV3IElOb2RlKClcbiAgbm9kZUZpbHRlcj0oaW5vZGUsaW5kZXgsbm9kZXMscGFyZW50KT0+e3JldHVybiB0cnVlfVxuICBjb25zdHJ1Y3Rvcihub2RlRmlsdGVyPShpbm9kZSxpbmRleCxub2RlcyxwYXJlbnQpPT57fSl7XG4gICAgdGhpcy5ub2RlRmlsdGVyPW5vZGVGaWx0ZXI7XG4gIH1cbiAgYXN5bmMgbG9hZElnbm9yZSgpIHtcbiAgICBjb25zdCBpZyA9IGlnbm9yZSgpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBnaXRpZ25vcmUgPSBhd2FpdCBmcy5yZWFkRmlsZShwYXRoLmpvaW4odGhpcy5yb290RGlyLCAnLmdpdGlnbm9yZScpLCAndXRmOCcpO1xuICAgICAgaWcuYWRkKGdpdGlnbm9yZS5zcGxpdCgvXFxyP1xcbi8pKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAvLyBubyAuZ2l0aWdub3JlIOKAlCBub3RoaW5nIHRvIGlnbm9yZVxuICAgIH1cbiAgICByZXR1cm4gaWc7XG4gIH1cbiAgLyoqXG4gICAqIFxuICAgKiBAcGFyYW0ge3N0cmluZ30gcm9vdERpciBcbiAgICogQHJldHVybnMge1dvcmtzcGFjZX1cbiAgICovXG4gIGFzeW5jIGluaXQocm9vdERpcikge1xuICAgIHRoaXMuaWcgPSBhd2FpdCB0aGlzLmxvYWRJZ25vcmUoKTtcbiAgICB0aGlzLnJvb3REaXI9cm9vdERpclxuICAgIHRoaXMucm9vdE5vZGUuZnVsbFBhdGggPSByb290RGlyXG4gICAgYXdhaXQgdGhpcy5yb290Tm9kZS5pbml0KHRoaXMucm9vdERpcix0aGlzLmlnLHRoaXMucm9vdERpcilcbiAgICBhd2FpdCB0aGlzLnJvb3ROb2RlLnJlZnJlc2godGhpcy5yb290RGlyLHRoaXMuaWcpXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuICBhc3luYyByZWZyZXNoKCl7XG4gICAgYXdhaXQgdGhpcy5yb290Tm9kZS5yZWZyZXNoKHRoaXMucm9vdERpcix0aGlzLmlnKVxuICB9XG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0ge0lOb2RlfSBub2RlXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFdvcmtzcGFjZT59XG4gICAqL1xuICBhc3luYyBvcGVuKG5vZGUpe1xuICAgIG5vZGUuaXNPcGVuPXRydWU7XG4gICAgbm9kZS5jaGlsZHJlbj1hd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgbm9kZS5lbnRyaWVzLm1hcChlbnRyeSA9PiB7XG4gICAgICAgICAgY29uc3QgaW5vZGUxID1uZXcgSU5vZGUoKVxuICAgICAgICAgIGlub2RlMS5mdWxsUGF0aD1wYXRoLmpvaW4obm9kZS5mdWxsUGF0aCwgZW50cnkpXG4gICAgICAgICAgcmV0dXJuIGlub2RlMS5pbml0KHRoaXMucm9vdERpciwgdGhpcy5pZywgaW5vZGUxLmZ1bGxQYXRoKVxuICAgICAgICB9KVxuICAgIClcbiAgICBub2RlLmNoaWxkcmVuPW5vZGUuY2hpbGRyZW4uZmlsdGVyKCh2LGksYSk9PiB7XG4gICAgICByZXR1cm4gdGhpcy5ub2RlRmlsdGVyKHYsaSxhLG5vZGUpXG4gICAgfSlcbiAgICByZXR1cm4gdGhpc1xuICB9XG4gIGZsYXR0ZW4oKXtcblxuICAgIC8vIHRocm93IEpTT04uc3RyaW5naWZ5KHdrLG51bGwsJyAnKVxuICAgIGxldCBmbWFwID0gdGhpcy5yb290Tm9kZS5mbGF0dGVuKClcbiAgICBmbWFwLnNvcnQoY29tcGFyZUlub2RlcylcbiAgICByZXR1cm4gZm1hcFxuICB9XG4gIC8vIGJ1aWxkIGEgZmxhdCBsaXN0IG9mIHZpc2libGUgbm9kZXNcbiAgLyoqXG4gICAqXG4gICAqIEByZXR1cm5zIHtXb3Jrc3BhY2V9XG4gICAqL1xuICBjb3B5KCl7XG4gICAgbGV0IHdrcyA9IG5ldyBXb3Jrc3BhY2UoKVxuICAgIHdrcy5yb290RGlyPXRoaXMucm9vdERpclxuICAgIHdrcy5yb290Tm9kZT10aGlzLnJvb3ROb2RlXG4gICAgd2tzLmlnPXRoaXMuaWdcbiAgICB3a3Mubm9kZUZpbHRlcj10aGlzLm5vZGVGaWx0ZXJcbiAgICByZXR1cm4gd2tzXG4gIH1cbn1cblxuIiwiLy8gY29tcG9uZW50cy9Nb2RhbERpYWxvZy5qc1xuaW1wb3J0IFJlYWN0LCB7IHVzZUVmZmVjdCwgdXNlUmVmIH0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHsgQm94RWxlbWVudCBhcyBib3gsIFRleHRFbGVtZW50IGFzIHRleHQgfSBmcm9tICdyZWFjdC1ibGVzc2VkJztcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gTW9kYWxEaWFsb2coe1xuICAgIHRpdGxlID0gJ0RpYWxvZycsXG4gICAgd2lkdGggPSAnNTAlJyxcbiAgICBoZWlnaHQgPSAnNTAlJyxcbiAgICBvbkNsb3NlLFxuICAgIGNoaWxkcmVuXG59KSB7XG4gICAgY29uc3QgYm94UmVmID0gdXNlUmVmKCk7XG5cbiAgICAvLyBmb2N1cyB0aGUgbW9kYWwgc28gaXQgY2FuIGNhdGNoIGtleXByZXNzZXNcbiAgICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgICAgICBjb25zdCBub2RlID0gYm94UmVmLmN1cnJlbnQ7XG4gICAgICAgIGlmIChub2RlKSBub2RlLmZvY3VzKCk7XG4gICAgfSwgW10pO1xuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveFxuICAgICAgICAgICAgcmVmPXtib3hSZWZ9XG4gICAgICAgICAgICB0b3A9XCJjZW50ZXJcIlxuICAgICAgICAgICAgbGVmdD1cImNlbnRlclwiXG4gICAgICAgICAgICB3aWR0aD17d2lkdGh9XG4gICAgICAgICAgICBoZWlnaHQ9e2hlaWdodH1cbiAgICAgICAgICAgIGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX1cbiAgICAgICAgICAgIHN0eWxlPXt7IGJnOiAnYmxhY2snLCBmZzogJ3doaXRlJyB9fVxuICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgLy8gY2xvc2Ugb24gRVNDXG4gICAgICAgICAgICBvbktleT17KGNoLCBrZXkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoa2V5Lm5hbWUgPT09ICdlc2NhcGUnKSBvbkNsb3NlKCk7XG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICB7LyogSGVhZGVyIHdpdGggdGl0bGUgYW5kIGNsb3NlIGJ1dHRvbiAqL31cbiAgICAgICAgICAgIDxib3ggaGVpZ2h0PXsxfSB3aWR0aD1cIjEwMCVcIiBzdHlsZT17eyBmZzogJ2dyZWVuJyB9fT5cbiAgICAgICAgICAgICAgICA8dGV4dCBib2xkPntgICR7dGl0bGV9YH0gPC90ZXh0PlxuICAgICAgICAgICAgICAgIDx0ZXh0XG4gICAgICAgICAgICAgICAgICAgIHJpZ2h0PXswfVxuICAgICAgICAgICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICAgICAgdW5kZXJsaW5lXG4gICAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9e29uQ2xvc2V9XG4gICAgICAgICAgICAgICAgPlvDl108L3RleHQ+XG4gICAgICAgICAgICA8L2JveD5cblxuICAgICAgICAgICAgey8qIENvbnRlbnQgYXJlYSAqL31cbiAgICAgICAgICAgIDxib3ggdG9wPXsyfSBsZWZ0PXsxfSByaWdodD17MX0gYm90dG9tPXsxfSBzY3JvbGxhYmxlIGtleXMgbW91c2UgYWx3YXlzU2Nyb2xsPlxuICAgICAgICAgICAgICAgIHtjaGlsZHJlbn1cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L2JveD5cbiAgICApO1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIHNhZmVTdHJpbmdpZnkob2JqLHNwYWNlPXVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgV2Vha1NldCgpO1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShvYmosIChrZXksIHZhbHVlKSA9PiB7XG4gICAgICAgIHN3aXRjaChrZXkpe1xuICAgICAgICAgICAgLy8gY2FzZSBcImNvbnRlbnRcIjogcmV0dXJuIFwiW2NvbnRlbnRdXCJcbiAgICAgICAgICAgIGNhc2UgXCJzY3JlZW5cIjogcmV0dXJuIFwiW3NjcmVlbl1cIlxuICAgICAgICAgICAgY2FzZSBcInBhcmVudFwiOiByZXR1cm4gXCJbcGFyZW50XVwiXG4gICAgICAgICAgICBjYXNlIFwibGluZXNcIjogcmV0dXJuIFwiW2xpbmVzXVwiXG4gICAgICAgICAgICBjYXNlIFwiY2hpbGRyZW5cIjogcmV0dXJuIFwiW2NoaWxkcmVuXVwiXG4gICAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChzZWVuLmhhcyh2YWx1ZSkpIHtcbiAgICAgICAgICByZXR1cm47ICAgICAgICAgICAgLy8gRHVwbGljYXRlL2NpcmN1bGFyIHJlZmVyZW5jZSDihpIgb21pdFxuICAgICAgICB9XG4gICAgICAgIHNlZW4uYWRkKHZhbHVlKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9LHNwYWNlKTtcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBpbnNlcnRBdChkZXN0aW5hdGlvbixpbmRleCxzb3VyY2Upe1xuICAgIGxldCBmaXJzdCA9IGRlc3RpbmF0aW9uLnN1YnN0cmluZygwLGluZGV4KTtcblxuICAgIGxldCBsYXN0ID0gZGVzdGluYXRpb24uc3Vic3RyaW5nKGluZGV4K3NvdXJjZS5sZW5ndGgpO1xuICAgIHJldHVybiAoZmlyc3Qrc291cmNlK2xhc3QpLnN1YnN0cmluZygwLGRlc3RpbmF0aW9uLmxlbmd0aClcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBkZWJvdW5jZWQoZm4sZGVsYXk9NTApe1xuICAgIGxldCB0bz0wXG4gICAgcmV0dXJuIGZ1bmN0aW9uKC4uLmFyZ3Mpe1xuICAgICAgICBjbGVhclRpbWVvdXQodG8pXG4gICAgICAgIHRvPXNldFRpbWVvdXQoKCk9PntcbiAgICAgICAgICAgIGZuKC4uLmFyZ3MpXG4gICAgICAgIH0sZGVsYXkpXG4gICAgfVxuICB9IiwiXG5cblxuLyoqXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxpbmVcbiAqIEByZXR1cm4geyBUb2tlbml6ZXJUb2tlbltdIH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGhpZ2hsaWdodChsaW5lKSB7XG4gICAgY29uc3QgdG9rZW5pemVyPWdldE5hbWVkVG9rZW5pemVyKCdqc3gnKVxuICAgIHJldHVybiB0b2tlbml6ZXIobGluZSlcbiAgfVxuZXhwb3J0IGNsYXNzIFRva2VuaXplck1hdGNoZXJEZWZ7XG4gICAgc3R5bGUgPSB7fVxuICAgIHBhdHRlcm4gPSAnJ1xufVxuZXhwb3J0IGNsYXNzIFRva2VuaXplckRlZntcbiAgICBuYW1lID0gJyc7XG4gICAgZmxhZ3M9J21naSdcbiAgICAvKipcbiAgICAgKlxuICAgICAqIEB0eXBlIHt7W25hbWU6c3RyaW5nXTpUb2tlbml6ZXJEZWZ9fVxuICAgICAqL1xuICAgIGRlZmluaXRpb25zID0ge31cbn1cbmV4cG9ydCBjbGFzcyBUb2tlbml6ZXJUb2tlbntcbiAgICB0b2tlbml6ZXJOYW1lPScnXG4gICAgdHlwZT0nJ1xuICAgIHN0eWxlPXt9XG4gICAgc3RhcnQ9MFxuICAgIGVuZD0wXG4gICAgeT0wXG4gICAgeD0wXG4gICAgdGV4dD0nJ1xuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1JlZ0V4cEV4ZWNBcnJheX0gbVxuICAgICAqIEBwYXJhbSB0b2tlbml6ZXJEZWZcbiAgICAgKiBAcmV0dXJuIHt7bmFtZTogdm9pZCB8IHN0cmluZywgdGV4dDogKiwgdHlwZTogc3RyaW5nLCBzdHlsZSwgc3RhcnQsIGVuZDogKn19XG4gICAgICovXG4gICAgc3RhdGljIGZyb21SZWdleHBNYXRjaChtLHRva2VuaXplckRlZix0b2tlbml6ZXJOYW1lLGxpbmVOdW1iZXIpe1xuICAgICAgICBjb25zdCBncm91cHMgPSBtLmdyb3VwcztcbiAgICAgICAgY29uc3QgdHlwZSA9IE9iamVjdC5rZXlzKGdyb3VwcykuZmluZChrZXkgPT4gZ3JvdXBzW2tleV0gIT09IHVuZGVmaW5lZCk7XG4gICAgICAgIGNvbnN0IHRva2VuRGVmID0gdG9rZW5pemVyRGVmLmRlZmluaXRpb25zW3R5cGVdXG4gICAgICAgIGNvbnN0IHR0ID0gbmV3IFRva2VuaXplclRva2VuKClcbiAgICAgICAgdHQudG9rZW5pemVyTmFtZT10b2tlbml6ZXJOYW1lXG4gICAgICAgIHR0LnRleHQ9IG1bMF1cbiAgICAgICAgdHQudHlwZT10eXBlXG4gICAgICAgIHR0LnN0eWxlPXRva2VuRGVmLnN0eWxlXG4gICAgICAgIHR0LnN0YXJ0PW0uaW5kZXhcbiAgICAgICAgdHQuZW5kPW0uaW5kZXgrbVswXS5sZW5ndGhcbiAgICAgICAgdHQueT1saW5lTnVtYmVyXG4gICAgICAgIHR0Lng9dHQuc3RhcnRcbiAgICAgICAgcmV0dXJuIHR0XG4gICAgfVxufVxuLyoqXG4gKiBAY29uc3RcbiAqIEB0eXBlIHtNYXA8c3RyaW5nLFRva2VuaXplck1hdGNoZXJEZWY+fX0gbmFtZWRUb2tlbml6ZXJzXG4gKi9cbmV4cG9ydCBjb25zdCBuYW1lZFRva2VuaXplcnM9e1xuICAgIGFueTp7bmFtZTonYW55JyxkZWZpbml0aW9uczp7XG4gICAgICAgIE51bWJlcjogICAgICAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1xcZCsoPzpcXC5cXGQrKT8vbWlnfSxcbiAgICAgICAgSWRlbnRpZmllcjogICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9bQS1aYS16X11cXHcqL21pZ30sXG4gICAgICAgIFN0cmluZzogICAgICAge3N0eWxlOiB7Zmc6J3llbGxvdyd9LHBhdHRlcm46L1wiKD86XFxcXC58W15cIl0pKlwifCcoPzpcXFxcLnxbXiddKSonL21pZ30sXG4gICAgICAgIE9wZXJhdG9yOiAgICAge3N0eWxlOiB7Zmc6J2N5YW4nfSxwYXR0ZXJuOi89PXwhPXw8PXw+PXxbK1xcLSovPTw+XS9taWd9LFxuICAgICAgICBwdW5jdHVhdGlvbjogIHtzdHlsZToge2ZnOidjeWFuJ30scGF0dGVybjovWygpXFxbXFxde30uLDs6P1xcXl0vbWlnfSxcbiAgICAgICAgV2hpdGVzcGFjZTogICB7c3R5bGU6IHtmZzond2hpdGUnfSxwYXR0ZXJuOi9cXHMrL21pZ30sXG4gICAgICAgIE90aGVyczogICAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovLio/L21pZ30sXG4gICAgfX0sXG4gICAganM6e25hbWU6J2pzJyxmbGFnczonbWcnLGRlZmluaXRpb25zOntcbiAgICAgICAgS2V5d29yZDogICAgICB7c3R5bGU6IHtmZzonbWFnZW50YSd9LHBhdHRlcm46L1xcYihhc3xmcm9tfGRlZmF1bHR8dGhpc3xjb25zdHxjb25zdHJ1Y3RvcnxsZXR8dmFyfGZ1bmN0aW9ufGlmfGVsc2V8Zm9yfHdoaWxlfHJldHVybnxjbGFzc3xpbXBvcnR8ZXhwb3J0fG5ld3xhd2FpdHxhc3luY3x0cnl8Y2F0Y2h8dGhyb3d8c3dpdGNofGNhc2V8YnJlYWt8Y29udGludWUpXFxiL21pZ30sXG4gICAgICAgIE51bWJlcjogICAgICAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1xcZCsoPzpcXC5cXGQrKT8vbWlnfSxcbiAgICAgICAgQ29tbWVudDogICAgICB7c3R5bGU6IHtmZzonIzc3OTk3Nyd9LHBhdHRlcm46L1xcL1xcLy4qJC9taWd9LFxuICAgICAgICAvLyBNQ29tbWVudDogICAgIHtzdHlsZToge2ZnOicjNzc5OTk5J30scGF0dGVybjonL1xcXFwqLipcXFxcKi8nfSxcbiAgICAgICAgU3RyaW5nOiAgICAgICB7c3R5bGU6IHtmZzoneWVsbG93J30scGF0dGVybjovXCIoPzpcXFxcLnxbXlwiXSkqXCJ8Jyg/OlxcXFwufFteJ10pKicvbWlnfSxcbiAgICAgICAgT3BlcmF0b3I6ICAgICB7c3R5bGU6IHtmZzonY3lhbid9LHBhdHRlcm46Lz09fCE9fDw9fD49fFsrXFwtKi89PD4lfCZcdTAwMWJdL21pZ30sXG4gICAgICAgIFB1bmN0dWF0aW9uOiAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1tcXFxcKClcXFtcXF17fS4sOzo/XiRdL21pZ30sXG4gICAgICAgIFdoaXRlc3BhY2U6ICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovXFxzKy9zbWlnfSxcbiAgICAgICAgSWRlbnRpZmllcjogICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9bQS1aYS16X11cXHcqL21pZ30sXG4gICAgICAgIE90aGVyczogICAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovW15dL3NtaWd9LFxuICAgIH19LFxuICAgIGpzeDp7bmFtZTonanN4JyxmbGFnczonbWcnLGRlZmluaXRpb25zOntcbiAgICAgICAgUmVhY3RUb2tlbjogICB7c3R5bGU6IHtmZzonI0ZGREQwMCd9LHBhdHRlcm46L1xcYnVzZVtBLVpdW2Etel0qXFxiL21pZ30sXG4gICAgICAgIEtleXdvcmQ6ICAgICAge3N0eWxlOiB7Zmc6J21hZ2VudGEnfSxwYXR0ZXJuOi9cXGIoYXN8ZnJvbXxkZWZhdWx0fGNvbnN0fGxldHx2YXJ8ZnVuY3Rpb258aWZ8ZWxzZXxmb3J8d2hpbGV8cmV0dXJufGNsYXNzfGltcG9ydHxleHBvcnR8bmV3fGF3YWl0fGFzeW5jfHRyeXxjYXRjaHx0aHJvd3xzd2l0Y2h8Y2FzZXxicmVha3xjb250aW51ZSlcXGIvbWlnfSxcbiAgICAgICAgSnN4VGFnOiAgICAgICB7c3R5bGU6IHtmZzonI0ZGREQwMCd9LHBhdHRlcm46LzwoXFwvKT9bYS16QS1aLV0qPi9taWd9LFxuICAgICAgICBDb21tZW50OiAgICAgIHtzdHlsZToge2ZnOicjNzc5OTc3J30scGF0dGVybjovXFwvXFwvLiokL21pZ30sXG4gICAgICAgIC8vIE1Db21tZW50OiAgICAge3N0eWxlOiB7Zmc6JyM3Nzk5OTknfSxwYXR0ZXJuOicvXFxcXCouKlxcXFwqLyd9LFxuICAgICAgICBOdW1iZXI6ICAgICAgIHtzdHlsZToge2ZnOidyZWQnfSxwYXR0ZXJuOi9cXGQrKD86XFwuXFxkKyk/L21pZ30sXG4gICAgICAgIFB1bmN0dWF0aW9uOiAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1tcXFxcKClcXFtcXF17fS4sOzo/XiRdL21pZ30sXG4gICAgICAgIE9wZXJhdG9yOiAgICAge3N0eWxlOiB7Zmc6J2N5YW4nfSxwYXR0ZXJuOi89PXwhPXw8PXw+PXxbK1xcLSovPTw+XS9taWd9LFxuICAgICAgICBXaGl0ZXNwYWNlOiAgIHtzdHlsZToge2ZnOid3aGl0ZSd9LHBhdHRlcm46L1xccysvbWlnfSxcbiAgICAgICAgSWRlbnRpZmllcjogICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9bQS1aYS16X11cXHcqL21pZ30sXG4gICAgICAgIE90aGVyczogICAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovLio/L21pZ30sXG4gICAgfX0sXG4gICAgYzp7bmFtZTonYycsZmxhZ3M6J21nJyxkZWZpbml0aW9uczp7XG4gICAgICAgIEtleXdvcmQ6ICAgICAge3N0eWxlOiB7Zmc6J21hZ2VudGEnfSxwYXR0ZXJuOi9cXGIoaW50fGNvbnN0fGNoYXJ8bG9uZ3xpZnxlbHNlfGZvcnx3aGlsZXxyZXR1cm58c3dpdGNofGNhc2V8YnJlYWt8Y29udGludWUpXFxiL21pZ30sXG4gICAgICAgIE51bWJlcjogICAgICAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1xcZCsoPzpcXC5cXGQrKT8vbWlnfSxcbiAgICAgICAgQ29tbWVudDogICAgICB7c3R5bGU6IHtmZzonIzc3OTk3Nyd9LHBhdHRlcm46L1xcL1xcLy4qJC9taWd9LFxuICAgICAgICAvLyBNQ29tbWVudDogICAgIHtzdHlsZToge2ZnOicjNzc5OTk5J30scGF0dGVybjonL1xcXFwqLipcXFxcKi8nfSxcbiAgICAgICAgU3RyaW5nOiAgICAgICB7c3R5bGU6IHtmZzoneWVsbG93J30scGF0dGVybjovXCIoPzpcXFxcLnxbXlwiXSkqXCJ8Jyg/OlxcXFwufFteJ10pKicvbWlnfSxcbiAgICAgICAgT3BlcmF0b3I6ICAgICB7c3R5bGU6IHtmZzonY3lhbid9LHBhdHRlcm46Lz09fCE9fDw9fD49fFsrXFwtKi89PD5dL21pZ30sXG4gICAgICAgIFB1bmN0dWF0aW9uOiAge3N0eWxlOiB7Zmc6J2N5YW4nfSxwYXR0ZXJuOi89PXwhPXw8PXw+PXxbK1xcLSovPTw+XS9taWd9LFxuICAgICAgICBXaGl0ZXNwYWNlOiAgIHtzdHlsZToge2ZnOid3aGl0ZSd9LHBhdHRlcm46L1xccysvbWlnfSxcbiAgICAgICAgSWRlbnRpZmllcjogICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9bQS1aYS16X11cXHcqL21pZ30sXG4gICAgICAgIE90aGVyczogICAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovLio/L21pZ30sXG4gICAgfX0sXG4gICAgd29yZHM6e25hbWU6J2MnLGZsYWdzOidtZycsZGVmaW5pdGlvbnM6e1xuICAgICAgICBXaGl0ZXNwYWNlOiAgICAgICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovXFxzKy9taWd9LFxuICAgICAgICBXb3JkOiAgICAgICAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9cXGIuKz9cXGIvbWlnfSxcbiAgICB9fSxcbiAgfVxuXG4vKipcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSBsYW5ndWFnZSBuYW1lXG4gKiBAcmV0dXJuIHtmdW5jdGlvbiAoY29kZTpzdHJpbmcsbGluZU51bWJlcjppbnQpOiBBcnJheTxUb2tlbml6ZXJUb2tlbj59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXROYW1lZFRva2VuaXplcihuYW1lKSB7XG4gICAgY29uc3QgdG9rZW5pemVyRGVmID0gbmFtZWRUb2tlbml6ZXJzW25hbWVdfHxuYW1lZFRva2VuaXplcnNbJ2FueSddXG4gICAgcmV0dXJuIGdldFRva2VuaXplcih0b2tlbml6ZXJEZWYpXG59XG4vKipcbiAqXG4gKiBAcGFyYW0ge1Rva2VuaXplckRlZn0gdG9rZW5pemVyRGVmIGxhbmd1YWdlIG5hbWVcbiAqIEByZXR1cm4ge2Z1bmN0aW9uIChjb2RlOnN0cmluZyxsaW5lTnVtYmVyOmludCk6IEFycmF5PFRva2VuaXplclRva2VuPn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFRva2VuaXplcih0b2tlbml6ZXJEZWYpIHtcbiAgICB0b2tlbml6ZXJEZWZbJ0FueSddPXtzdHlsZToge2ZnOicjZWVlZWVlJ30scGF0dGVybjovKFxcYnxeKS4rPyhcXGJ8JCkvc21pZ31cbiAgICBjb25zdCB0b2tlblJlZ2V4ID0gbmV3IFJlZ0V4cChcbiAgICAgICAgT2JqZWN0LmVudHJpZXModG9rZW5pemVyRGVmLmRlZmluaXRpb25zKVxuICAgICAgICAgICAgLm1hcCgoW25hbWUsIGRlZmluaXRpb25dKSA9PiBgKD88JHtuYW1lfT4ke2RlZmluaXRpb24ucGF0dGVybi5zb3VyY2V9KWApXG4gICAgICAgICAgICAuam9pbignfCcpLFxuICAgICAgICB0b2tlbml6ZXJEZWYuZmxhZ3N8fCdnJ1xuICAgICk7XG4gICAgLyoqXG4gICAgICogQHBhcmFtIHtUb2tlbml6ZXJNYXRjaGVyRGVmfSBjb2RlXG4gICAgICogQHJldHVybiB7QXJyYXk8VG9rZW5pemVyVG9rZW4+fVxuICAgICAqL1xuICAgIHJldHVybiBmdW5jdGlvbiB0b2tlbml6ZXIoY29kZSxsaW5lTnVtYmVyKXtcbiAgICAgICAgY29uc3QgdG9rZW5zPVtdXG4gICAgICAgIGZvciAoY29uc3QgbSBvZiAoY29kZSApLm1hdGNoQWxsKHRva2VuUmVnZXgpKSB7XG4gICAgICAgICAgICBjb25zdCBncm91cHMgPSBtLmdyb3VwcztcbiAgICAgICAgICAgIGNvbnN0IHR5cGUgPSBPYmplY3Qua2V5cyhncm91cHMpLmZpbmQoa2V5ID0+IGdyb3Vwc1trZXldICE9PSB1bmRlZmluZWQpO1xuICAgICAgICAgICAgY29uc3QgdG9rZW5EZWYgPSB0b2tlbml6ZXJEZWYuZGVmaW5pdGlvbnNbdHlwZV1cbiAgICAgICAgICAgIHRva2Vucy5wdXNoKFRva2VuaXplclRva2VuLmZyb21SZWdleHBNYXRjaChtLHRva2VuaXplckRlZix0b2tlbml6ZXJEZWYubmFtZSxsaW5lTnVtYmVyKSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdG9rZW5zXG4gICAgfVxufSIsIi8vIGltcG9ydCB7U2NyZWVuRXZlbnR9IGZyb20gJ3JlYWN0LWJsZXNzZWQnXG5pbXBvcnQge2dldFRva2VuaXplciwgVG9rZW5pemVyVG9rZW59IGZyb20gJy4vdG9rZW5pemVyLmpzJ1xuLyoqXG4gKlxuICogQHBhcmFtIHtTaW1wbGVUZXh0RWRpdG9yfSBldmVudERhdGFcbiAqIEByZXR1cm4geyhmdW5jdGlvbigpKXx1bmRlZmluZWR9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBMaXN0ZW5lcihldmVudERhdGEpe3JldHVybiAoKT0+e319XG5cblxuZXhwb3J0IGNsYXNzIEVkaXRvckV2ZW50IHtcbiAgICAvKipcbiAgICAgKiBAdHlwZSB7U2NyZWVuRXZlbnR9XG4gICAgICovXG4gICAgc2NyZWVuPSB7fVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3N0cmluZ1tdfVxuICAgICAqL1xuICAgIGxpbmVzPVtdXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7c3RyaW5nfVxuICAgICAqL1xuICAgIGxpbmU9XCJcIlxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3N0cmluZ1tdfVxuICAgICAqL1xuICAgIHZpc2libGVMaW5lcz1bXVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3t4OiBudW1iZXIsIHk6IG51bWJlcn19XG4gICAgICovXG4gICAgY3Vyc29yPXt4OjAseTowfVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3t4OiBudW1iZXIsIHk6IG51bWJlcn19XG4gICAgICovXG4gICAgY3Vyc29yU2NyZWVuPXt4OjAseTowfVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3N0cmluZ31cbiAgICAgKi9cbiAgICBidWZmZXI9XCJcIlxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge3N0cmluZ31cbiAgICAgKi9cbiAgICB2aXNpYmxlQnVmZmVyPVwiXCJcbiAgICAvKipcbiAgICAgKlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgaW5kZXg9MFxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge1Rva2VuaXplclRva2VuW119XG4gICAgICovXG4gICAgdG9rZW5zPVtdXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7VG9rZW5pemVyVG9rZW59XG4gICAgICovXG4gICAgdG9rZW5VbmRlckN1cnNvcj1udWxsXG4gICAgcGhyYXNlPVwiXCJcbn1cblxuZXhwb3J0IGNsYXNzIFNpbXBsZVRleHRFZGl0b3Ige1xuICAgIGJ1ZmZlcj1cIlwiXG4gICAgY3Vyc29ySW5kZXg9MFxuICAgIGhpZ2hsaWdodEluZGV4PTBcbiAgICBsaXN0ZW5lcnM9e1wiY3Vyc29yQ2hhbmdlZFwiOltdLFwiYnVmZmVyQ2hhbmdlZFwiOltdfVxuICAgIHZpZXdwb3J0SGVpZ2h0PTdcbiAgICB2aWV3cG9ydFdpZHRoPTMwXG4gICAgdmlld3BvcnRYPTBcbiAgICB2aWV3cG9ydFk9MFxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gYnVmZmVyXG4gICAgICovXG4gICAgY29uc3RydWN0b3IoYnVmZmVyKSB7XG4gICAgICAgIHRoaXMuYnVmZmVyID0gYnVmZmVyfHxcIlwiO1xuICAgIH1cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7XCJjdXJzb3JDaGFuZ2VkXCJ8XCJidWZmZXJDaGFuZ2VkXCJ9IGV2ZW50VHlwZVxuICAgICAqIEBwYXJhbSB7KGV2ZW50RGF0YTpTaW1wbGVUZXh0RWRpdG9yKT0+KCgpPT52b2lkKX0gbGlzdGVuZXJcbiAgICAgKi9cbiAgICBvbihldmVudFR5cGUsbGlzdGVuZXIpe1xuICAgICAgICB0aGlzLmxpc3RlbmVyc1tldmVudFR5cGVdPWxpc3RlbmVyXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1wiY3Vyc29yQ2hhbmdlZFwifFwiYnVmZmVyQ2hhbmdlZFwifSBldmVudFR5cGVcbiAgICAgKiBAcGFyYW0ge1NpbXBsZVRleHRFZGl0b3J9IHBheWxvYWRcbiAgICAgKi9cbiAgICBfZGlzcGF0Y2hFdmVudHMoZXZlbnRUeXBlLHBheWxvYWQpe1xuICAgICAgICBjb25zdCB0b0tlZXA9W11cbiAgICAgICAgZm9yKGxldCBsaXN0ZW5lciBvZiB0aGlzLmxpc3RlbmVyc1tldmVudFR5cGVdKXtcbiAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICBjb25zdCB1bnN1YnNjcmliZT1saXN0ZW5lcihwYXlsb2FkKVxuICAgICAgICAgICAgICAgIGlmKHR5cGVvZih1bnN1YnNjcmliZSkgPT09IFwiZnVuY3Rpb25cIil7XG4gICAgICAgICAgICAgICAgICAgIHVuc3Vic2NyaWJlKClcbiAgICAgICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICAgICAgdG9LZWVwLnB1c2gobGlzdGVuZXIpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfWNhdGNoKGVycil7XG5cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxpc3RlbmVyc1tldmVudFR5cGVdPXRvS2VlcFxuICAgIH1cbiAgICBzbGlkZVZpZXdwb3J0VG9DdXJzb3IoKXtcbiAgICAgICAgbGV0IHt4LHl9ID0gdGhpcy5jdXJzb3JDb29yZHMoKVxuICAgICAgICBsZXQge3ZpZXdwb3J0SGVpZ2h0OnZoLCB2aWV3cG9ydFdpZHRoOnZ3LCB2aWV3cG9ydFg6dngsIHZpZXdwb3J0WTp2eX09dGhpc1xuICAgICAgICBpZiAoeTx2eSl7XG4gICAgICAgICAgICB2eT15XG4gICAgICAgIH1cbiAgICAgICAgaWYoeT4odnkrdmgpKXtcbiAgICAgICAgICAgIHZ5Kz0xXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy52aWV3cG9ydFk9dnlcbiAgICB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtzdHJpbmdbXX1cbiAgICAgKi9cbiAgICByZW5kZXJUb0xpbmVzKHN0YXJ0PTAsaGVpZ2h0KXtcbiAgICAgICAgY29uc3QgbGluZXMgPSB0aGlzLmJ1ZmZlci5zcGxpdChcIlxcblwiKTtcbiAgICAgICAgY29uc3QgZT1zdGFydCsoaGVpZ2h0fHxsaW5lcy5sZW5ndGgpO1xuICAgICAgICByZXR1cm4gbGluZXMuc2xpY2Uoc3RhcnQsZSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge3t5OiBudW1iZXIsIHg6IG51bWJlcn19XG4gICAgICovXG4gICAgY3Vyc29yQ29vcmRzKCl7XG4gICAgICAgIHJldHVybiB0aGlzLmN1cnNvckluZGV4VG9Db29yZHModGhpcy5jdXJzb3JJbmRleClcbiAgICB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHt7eTogbnVtYmVyLCB4OiBudW1iZXJ9fVxuICAgICAqL1xuICAgIGhpZ2hsaWdodENvb3Jkcygpe1xuICAgICAgICByZXR1cm4gdGhpcy5jdXJzb3JJbmRleFRvQ29vcmRzKHRoaXMuaGlnaGxpZ2h0SW5kZXgpXG4gICAgfVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IGluZGV4XG4gICAgICogQHJldHVybiB7e3k6IG51bWJlciwgeDogbnVtYmVyfX1cbiAgICAgKi9cbiAgICBjdXJzb3JJbmRleFRvQ29vcmRzKGluZGV4KXtcbiAgICAgICAgY29uc3QgbGluZXNUbz10aGlzLmJ1ZmZlci5zdWJzdHJpbmcoMCxwYXJzZUludChpbmRleCkpLnNwbGl0KFwiXFxuXCIpO1xuICAgICAgICAvL2NvbnNvbGUubG9nKHtsaW5lc1RvfSlcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHk6bGluZXNUby5sZW5ndGgtMSxcbiAgICAgICAgICAgIHg6bGluZXNUb1tsaW5lc1RvLmxlbmd0aC0xXS5sZW5ndGhcbiAgICAgICAgfVxuICAgIH1cbiAgICBzZXRDdXJzb3IoeCx5KXtcbiAgICAgICAgdGhpcy5jdXJzb3JJbmRleD10aGlzLmN1cnNvckNvb3Jkc1RvSW5kZXgoe3gseX0pXG4gICAgfVxuICAgIHNldEhpZ2hsaWdodCh4LHkpe1xuICAgICAgICB0aGlzLmhpZ2hsaWdodEluZGV4PXRoaXMuY3Vyc29yQ29vcmRzVG9JbmRleCh7eCx5fSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7e3g6TnVtYmVyLHk6TnVtYmVyfX0gY29vcmRzXG4gICAgICogQHJldHVybiB7TnVtYmVyfVxuICAgICAqL1xuICAgIGN1cnNvckNvb3Jkc1RvSW5kZXgoY29vcmRzKXtcbiAgICAgICAgY29uc3Qge3gseX0gPSBjb29yZHNcbiAgICAgICAgY29uc3QgbGluZXM9dGhpcy5idWZmZXIuc3BsaXQoXCJcXG5cIikuc2xpY2UoMCx5KTtcbiAgICAgICAgLy9jb25zb2xlLmxvZyh7bGluZXN9KVxuICAgICAgICByZXR1cm4gbGluZXMucmVkdWNlKChjLGwpPT5jKzErbC5sZW5ndGgsMCkgKyB4O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IGNoXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IGtleVxuICAgICAqIEByZXR1cm4ge1NpbXBsZVRleHRFZGl0b3J9XG4gICAgICovXG4gICAgb25LZXkoY2gsa2V5KXtcbiAgICAgICAgc3dpdGNoIChrZXkubmFtZSkge1xuICAgICAgICAgICAgY2FzZSAndXAnOiAgICAgIHRoaXMubW92ZUN1cnNvclVwKCk7ICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2Rvd24nOiAgICB0aGlzLm1vdmVDdXJzb3JEb3duKCk7ICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2xlZnQnOiAgICB0aGlzLm1vdmVDdXJzb3JMZWZ0KCk7ICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ3JpZ2h0JzogICB0aGlzLm1vdmVDdXJzb3JSaWdodCgpOyBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2hvbWUnOiAgICB0aGlzLnRvSG9tZSgpOyA7YnJlYWs7XG4gICAgICAgICAgICBjYXNlICdlbmQnOiAgICAgIHRoaXMudG9FbmQoKTsgO2JyZWFrO1xuICAgICAgICAgICAgY2FzZSAnYmFja3NwYWNlJzogdGhpcy5iYWNrc3BhY2UoKTsgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnZGVsZXRlJzogICAgdGhpcy5kZWxldGUoKTsgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAncmV0dXJuJzogICAgdGhpcy5pbnNlcnQoXCJcXG5cIik7dGhpcy5tb3ZlQ3Vyc29yRG93bigpOyBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ3RhYic6ICAgIHRoaXMuaW5zZXJ0KFwiXFx0XCIpOyAgYnJlYWs7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIGlmIChjaCAmJiBjaC5sZW5ndGggPiAwKXtcbiAgICAgICAgICAgICAgICAgICAgaWYoa2V5Lm5hbWUgJiYga2V5Lm5hbWUubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmluc2VydChrZXkuc2VxdWVuY2UpXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmluc2VydChjaCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5zbGlkZVZpZXdwb3J0VG9DdXJzb3IoKVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cbiAgICB0b2tlblVuZGVyQ3Vyc29yKHgseSx0b2tlbml6ZXIpe1xuICAgICAgICBjb25zdCBsaW5lcyA9IHRoaXMucmVuZGVyVG9MaW5lcygpXG4gICAgICAgIGNvbnN0IGxpbmUgPSBsaW5lc1t5XTtcbiAgICAgICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemVyKGxpbmUseSlcbiAgICAgICAgY29uc3QgcGhyYXNlID0gdG9rZW5zLm1hcCh2PT52LnR5cGUpXG4gICAgICAgIGNvbnN0IHRva2VuVW5kZXJDdXJzb3IgPSB0b2tlbnMuZmluZCgodixpLGEpPT57XG4gICAgICAgICAgICByZXR1cm4gdi5zdGFydDw9eCAmJiB2LmVuZD49eDtcbiAgICAgICAgfSlcbiAgICAgICAgcmV0dXJuIHRva2VuVW5kZXJDdXJzb3JcbiAgICB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0gbHBvc1xuICAgICAqIEBwYXJhbSB7U2NyZWVufSBzY3JlZW5FdmVudFxuICAgICAqIEBwYXJhbSB0b2tlbml6ZXJcbiAgICAgKiBAcmV0dXJuIHtFZGl0b3JFdmVudH1cbiAgICAgKi9cbiAgICBnZXRFdmVudChscG9zLHNjcmVlbkV2ZW50LHRva2VuaXplcikge1xuICAgICAgICBjb25zdCB7eGkseWl9ID0gbHBvcztcbiAgICAgICAgY29uc3Qge3gseX0gPSBzY3JlZW5FdmVudDtcbiAgICAgICAgY29uc3QgY3Vyc29yID0gdGhpcy5jdXJzb3JDb29yZHMoKVxuICAgICAgICBjb25zdCBsaW5lcyA9IHRoaXMucmVuZGVyVG9MaW5lcygpXG4gICAgICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tjdXJzb3IueV07XG4gICAgICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplcihsaW5lLHkpXG4gICAgICAgIGNvbnN0IHBocmFzZSA9IHRva2Vucy5tYXAodj0+di50eXBlKVxuICAgICAgICBjb25zdCB0b2tlblVuZGVyQ3Vyc29yID0gdG9rZW5zLmZpbmQoKHYsaSxhKT0+e1xuICAgICAgICAgICAgcmV0dXJuIHYuc3RhcnQ8PWN1cnNvci54ICYmIHYuZW5kPj1jdXJzb3IueDtcbiAgICAgICAgfSlcbiAgICAgICAgLy90aGlzLnNldEN1cnNvcih4LXhpK3RoaXMudmlld3BvcnRYLHkteWkrdGhpcy52aWV3cG9ydFkpXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBldmVudDpzY3JlZW5FdmVudCxcbiAgICAgICAgICAgIHBhcmVudFBvczp7eDp4aSx5OnlpfSxcbiAgICAgICAgICAgIGxpbmVzOmxpbmVzLFxuICAgICAgICAgICAgbGluZSxcbiAgICAgICAgICAgIHZpc2libGVMaW5lczpsaW5lcyxcbiAgICAgICAgICAgIGN1cnNvcixcbiAgICAgICAgICAgIGN1cnNvclNjcmVlbjp7eDpjdXJzb3IueC10aGlzLnZpZXdwb3J0WCx5OmN1cnNvci55LXRoaXMudmlld3BvcnRZfSxcbiAgICAgICAgICAgIGJ1ZmZlcjp0aGlzLmJ1ZmZlcixcbiAgICAgICAgICAgIHZpc2libGVCdWZmZXI6dGhpcy5idWZmZXIsXG4gICAgICAgICAgICBpbmRleDp0aGlzLmN1cnNvckluZGV4LFxuICAgICAgICAgICAgdG9rZW5zLFxuICAgICAgICAgICAgdG9rZW5VbmRlckN1cnNvcixcbiAgICAgICAgICAgIHBocmFzZSxcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2ltcGxlVGV4dEVkaXRvcn1cbiAgICAgKi9cbiAgICBtb3ZlQ3Vyc29yVXAoKXtcbiAgICAgICAgbGV0IHt4LHl9ID0gdGhpcy5jdXJzb3JJbmRleFRvQ29vcmRzKHRoaXMuY3Vyc29ySW5kZXgpXG4gICAgICAgIGlmICh5PjApIHtcbiAgICAgICAgICAgIHRoaXMuY3Vyc29ySW5kZXg9dGhpcy5jdXJzb3JDb29yZHNUb0luZGV4KHt4OngseTp5LTF9KVxuICAgICAgICAgICAgdGhpcy5fZGlzcGF0Y2hFdmVudHMoXCJjdXJzb3JDaGFuZ2VkXCIsdGhpcylcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2ltcGxlVGV4dEVkaXRvcn1cbiAgICAgKi9cbiAgICBtb3ZlQ3Vyc29yRG93bigpe1xuICAgICAgICBsZXQge3gseX0gPSB0aGlzLmN1cnNvckluZGV4VG9Db29yZHModGhpcy5jdXJzb3JJbmRleClcbiAgICAgICAgY29uc3QgbGluZXM9dGhpcy5idWZmZXIuc3BsaXQoXCJcXG5cIilcbiAgICAgICAgaWYgKHk8KGxpbmVzLmxlbmd0aC0xKSkge1xuICAgICAgICAgICAgdGhpcy5jdXJzb3JJbmRleD10aGlzLmN1cnNvckNvb3Jkc1RvSW5kZXgoe3g6eCx5OnkrMX0pXG4gICAgICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIix0aGlzKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIG1vdmVDdXJzb3JMZWZ0KCl7XG4gICAgICAgIGlmKHRoaXMuY3Vyc29ySW5kZXg+MCl7XG4gICAgICAgICAgICB0aGlzLmN1cnNvckluZGV4LT0xXG4gICAgICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIix0aGlzKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIG1vdmVDdXJzb3JSaWdodCgpe1xuICAgICAgICBpZih0aGlzLmN1cnNvckluZGV4PHRoaXMuYnVmZmVyLmxlbmd0aCl7XG4gICAgICAgICAgICB0aGlzLmN1cnNvckluZGV4Kz0xXG4gICAgICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIix0aGlzKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIHRvSG9tZSgpe1xuICAgICAgICBsZXQge3gseX0gPSB0aGlzLmN1cnNvckluZGV4VG9Db29yZHModGhpcy5jdXJzb3JJbmRleClcbiAgICAgICAgdGhpcy5jdXJzb3JJbmRleD10aGlzLmN1cnNvckNvb3Jkc1RvSW5kZXgoe3g6MCx5Onl9KVxuICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIix0aGlzKVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2ltcGxlVGV4dEVkaXRvcn1cbiAgICAgKi9cbiAgICB0b0VuZCgpe1xuICAgICAgICBsZXQge3gseX0gPSB0aGlzLmN1cnNvckluZGV4VG9Db29yZHModGhpcy5jdXJzb3JJbmRleClcbiAgICAgICAgY29uc3QgbGluZT10aGlzLmJ1ZmZlci5zcGxpdChcIlxcblwiKVt5XVxuICAgICAgICB0aGlzLmN1cnNvckluZGV4PXRoaXMuY3Vyc29yQ29vcmRzVG9JbmRleCh7eDpsaW5lLmxlbmd0aCx5Onl9KVxuICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIix0aGlzKVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2ltcGxlVGV4dEVkaXRvcn1cbiAgICAgKi9cbiAgICBiYWNrc3BhY2UoKXtcbiAgICAgICAgaWYodGhpcy5jdXJzb3JJbmRleD4wKXtcbiAgICAgICAgICAgIHRoaXMuY3Vyc29ySW5kZXggLT0gMVxuICAgICAgICAgICAgdGhpcy5fZGlzcGF0Y2hFdmVudHMoXCJjdXJzb3JDaGFuZ2VkXCIsIHRoaXMpXG4gICAgICAgICAgICBjb25zdCBiZWZvcmU9dGhpcy5idWZmZXIuc3Vic3RyaW5nKDAsdGhpcy5jdXJzb3JJbmRleClcbiAgICAgICAgICAgIGNvbnN0IGFmdGVyPXRoaXMuYnVmZmVyLnN1YnN0cmluZyh0aGlzLmN1cnNvckluZGV4KzEpXG4gICAgICAgICAgICB0aGlzLmJ1ZmZlcj1iZWZvcmUrYWZ0ZXJcbiAgICAgICAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnRzKFwiYnVmZmVyQ2hhbmdlZFwiLHRoaXMpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIGRlbGV0ZSgpe1xuICAgICAgICBjb25zdCBiZWZvcmU9dGhpcy5idWZmZXIuc3Vic3RyaW5nKDAsdGhpcy5jdXJzb3JJbmRleCsxKVxuICAgICAgICBjb25zdCBhZnRlcj10aGlzLmJ1ZmZlci5zdWJzdHJpbmcodGhpcy5jdXJzb3JJbmRleCsyKVxuICAgICAgICB0aGlzLmJ1ZmZlcj1iZWZvcmUrYWZ0ZXJcbiAgICAgICAgdGhpcy5fZGlzcGF0Y2hFdmVudHMoXCJidWZmZXJDaGFuZ2VkXCIsdGhpcylcbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIGluc2VydChjaCl7XG4gICAgICAgIHRoaXMuY3Vyc29ySW5kZXgrPTFcbiAgICAgICAgY29uc3QgYmVmb3JlPXRoaXMuYnVmZmVyLnN1YnN0cmluZygwLHRoaXMuY3Vyc29ySW5kZXgtMSlcbiAgICAgICAgY29uc3QgYWZ0ZXI9dGhpcy5idWZmZXIuc3Vic3RyaW5nKHRoaXMuY3Vyc29ySW5kZXgtMSlcbiAgICAgICAgdGhpcy5idWZmZXI9YmVmb3JlK2NoK2FmdGVyXG4gICAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnRzKFwiYnVmZmVyQ2hhbmdlZFwiLHRoaXMpXG4gICAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnRzKFwiY3Vyc29yQ2hhbmdlZFwiLHRoaXMpXG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIGNvcHkoKXtcbiAgICAgICAgY29uc3QgbmV3U2ltcGxlVGV4dEJ1ZmZlcj0gbmV3IFNpbXBsZVRleHRFZGl0b3IoKVxuICAgICAgICBuZXdTaW1wbGVUZXh0QnVmZmVyLmJ1ZmZlciA9IHRoaXMuYnVmZmVyXG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIuY3Vyc29ySW5kZXggPSB0aGlzLmN1cnNvckluZGV4XG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIuaGlnaGxpZ2h0SW5kZXggPSB0aGlzLmhpZ2hsaWdodEluZGV4XG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIudmlld3BvcnRIZWlnaHQ9dGhpcy52aWV3cG9ydEhlaWdodFxuICAgICAgICBuZXdTaW1wbGVUZXh0QnVmZmVyLnZpZXdwb3J0V2lkdGg9dGhpcy52aWV3cG9ydFdpZHRoXG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIudmlld3BvcnRYPXRoaXMudmlld3BvcnRYXG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIudmlld3BvcnRZPXRoaXMudmlld3BvcnRZXG4gICAgICAgIHJldHVybiBuZXdTaW1wbGVUZXh0QnVmZmVyXG4gICAgfVxufSIsImltcG9ydCBSZWFjdCwge3VzZUVmZmVjdCwgdXNlUmVmLCB1c2VTdGF0ZX0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQge1xuICAgIExpc3RFbGVtZW50IGFzIGxpc3QsXG4gICAgQm94RWxlbWVudCBhcyBib3gsXG4gICAgQnV0dG9uRWxlbWVudCBhcyBidXR0b24sXG4gICAgVGV4dGFyZWFFbGVtZW50IGFzIHRleHRhcmVhLFxuICAgIFRleHRFbGVtZW50IGFzIHRleHRcbn0gZnJvbSAncmVhY3QtYmxlc3NlZCc7XG5pbXBvcnQge1NpbXBsZVRleHRFZGl0b3IsRWRpdG9yRXZlbnR9IGZyb20gXCIuL1NpbXBsZVRleHRFZGl0b3IuanNcIjtcbmltcG9ydCB7ZGVib3VuY2VkLCBzYWZlU3RyaW5naWZ5fSBmcm9tIFwiLi91dGlsXCI7XG5pbXBvcnQge2dldE5hbWVkVG9rZW5pemVyLCBnZXRUb2tlbml6ZXJ9IGZyb20gXCIuL3Rva2VuaXplclwiO1xuaW1wb3J0IHtTY3JlZW5FdmVudH0gZnJvbSBcInJlYWN0LWJsZXNzZWRcIjtcblxuXG4vKipcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBsaW5lc1xuICogQHBhcmFtIHtib29sZWFufSBlZGl0YWJsZVxuICogQHBhcmFtIHsoZWRpdG9yRXZlbnQ6RWRpdG9yRXZlbnQpPT52b2lkfSBvbkNsaWNrXG4gKiBAcGFyYW0geyhlZGl0b3JFdmVudDpFZGl0b3JFdmVudCk9PnZvaWR9IG9uTGluZUNsaWNrXG4gKiBAcGFyYW0geyhlZGl0b3JFdmVudDpFZGl0b3JFdmVudCk9PnZvaWR9IG9uTGluZUhvdmVyXG4gKiBAcGFyYW0geyhlZGl0b3JFdmVudDpFZGl0b3JFdmVudCk9PnZvaWR9IG9uVG9rZW5DbGlja1xuICogQHBhcmFtIHsoZWRpdG9yRXZlbnQ6RWRpdG9yRXZlbnQpPT52b2lkfSBvblRva2VuSG92ZXJcbiAqIEBwYXJhbSB7VG9rZW5pemVyRGVmfSB0b2tlbml6ZXJEZWZcbiAqIEBwYXJhbSB7Tm9kZVdpdGhFdmVudHNbXX0gY2hpbGRyZW5cbiAqIEBwYXJhbSB7YW55W119IGJveFByb3BzXG4gKiBAcmV0dXJuIHtFbGVtZW50fVxuICovXG5leHBvcnQgZnVuY3Rpb24gTGlzdENvbXBvbmVudCh7XG4gIGxpbmVzLFxuICBlZGl0YWJsZSA9IGZhbHNlLFxuICBkZWZhdWx0VGV4dD0nLi4uJyxcbiAgb25MaW5lQ2xpY2s9KGVkaXRvckV2ZW50KT0+e30sXG4gIG9uVG9rZW5DbGljaz0oZWRpdG9yRXZlbnQpPT57fSxcbiAgb25MaW5lSG92ZXI9KGVkaXRvckV2ZW50KT0+e30sXG4gIG9uVG9rZW5Ib3Zlcj0oZWRpdG9yRXZlbnQpPT57fSxcbiAgdG9rZW5pemVyRGVmLFxuICBjaGlsZHJlbixcbiAgLi4uYm94UHJvcHNcbn0pIHtcbiAgICBjb25zdCBib3hSZWYgPSB1c2VSZWYobnVsbCk7XG4gICAgY29uc3QgW2VkaXRvciwgc2V0RWRpdG9yXSA9IHVzZVN0YXRlKG51bGwpO1xuICAgIGNvbnN0IFtzaXplLCBzZXRTaXplXSAgICAgPSB1c2VTdGF0ZSh7IHJvd3M6IDEwLCBjb2xzOiAzMCB9KTtcblxuICAgIGxldCBjaGFuZ2VkVGltZW91dD0wXG4gICAgdXNlRWZmZWN0KCgpPT57XG4gICAgICAgIGxldCBuZXdFZGl0b3I9ZWRpdG9yXG4gICAgICAgIGlmKCFuZXdFZGl0b3Ipe1xuICAgICAgICAgICAgbmV3RWRpdG9yID0gbmV3IFNpbXBsZVRleHRFZGl0b3IobGluZXMuam9pbihcIlxcblwiKXx8ZGVmYXVsdFRleHQpXG4gICAgICAgIH1cbiAgICAgICAgaWYoKGxpbmVzLmpvaW4oXCJcXG5cIil8fGRlZmF1bHRUZXh0KS5zdWJzdHJpbmcobmV3RWRpdG9yLmN1cnNvckluZGV4KSE9PW5ld0VkaXRvci5idWZmZXIuc3Vic3RyaW5nKG5ld0VkaXRvci5jdXJzb3JJbmRleCkpe1xuICAgICAgICAgICAgbmV3RWRpdG9yLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpXG4gICAgICAgIH1cbiAgICAgICAgbmV3RWRpdG9yLmJ1ZmZlcj1saW5lcy5qb2luKFwiXFxuXCIpfHxkZWZhdWx0VGV4dFxuICAgICAgICBuZXdFZGl0b3Iudmlld3BvcnRIZWlnaHQgPSBzaXplLnJvd3MtMTtcbiAgICAgICAgbmV3RWRpdG9yLnZpZXdwb3J0V2lkdGggPSBzaXplLmNvbHM7XG4gICAgICAgIHNldEVkaXRvcihuZXdFZGl0b3IuY29weSgpKVxuICAgIH0sW2xpbmVzXSlcblxuICAgIC8vIDIpIHVwZGF0ZSBzaXplIG9uIHJlc2l6ZVxuICAgIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgICAgIGNvbnN0IGJveCA9IGJveFJlZi5jdXJyZW50O1xuICAgICAgICBpZiAoIWJveCkgcmV0dXJuO1xuICAgICAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XG4gICAgICAgICAgICBzZXRTaXplKHsgY29sczogYm94LndpZHRoLCByb3dzOiBib3guaGVpZ2h0LTIgfSk7XG4gICAgICAgIH07XG4gICAgICAgIHVwZGF0ZSgpO1xuICAgICAgICBib3gub24oJ3Jlc2l6ZScsIHVwZGF0ZSk7XG4gICAgICAgIHJldHVybiAoKSA9PiBib3gucmVtb3ZlTGlzdGVuZXIoJ3Jlc2l6ZScsIHVwZGF0ZSk7XG4gICAgfSwgW10pO1xuXG4gICAgLy8gcnVuIG9uY2Ugb24gc2l6ZSBjaGFuZ2VcbiAgICB1c2VFZmZlY3QoKCk9PntcbiAgICAgICAgaWYoZWRpdG9yKXtcbiAgICAgICAgICAgIGVkaXRvci52aWV3cG9ydFdpZHRoID0gc2l6ZS5jb2xzO1xuICAgICAgICAgICAgZWRpdG9yLnZpZXdwb3J0SGVpZ2h0ID0gc2l6ZS5yb3dzO1xuICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgIH1cbiAgICB9LCBbc2l6ZV0pO1xuXG4gICAgY29uc3QgaW50ZXJuYWxPbktleVByZXNzPShjaCxrZXkpPT57XG4gICAgICAgIGlmKGVkaXRhYmxlKSB7XG4gICAgICAgICAgICBlZGl0b3Iub25LZXkoY2gsIGtleSlcbiAgICAgICAgICAgIGNsZWFyVGltZW91dChjaGFuZ2VkVGltZW91dClcbiAgICAgICAgICAgIGNoYW5nZWRUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gb25DaGFuZ2UoZWRpdG9yKVxuICAgICAgICAgICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgICAgICAgICAgfSwgODApXG4gICAgICAgIH1lbHNlIGlmICgga2V5IGluIFsndXAnLCdkb3duJ10gKXtcbiAgICAgICAgICAgIGVkaXRvci5vbktleShjaCwga2V5KVxuICAgICAgICAgICAgY2hhbmdlZFRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBvbkNoYW5nZShlZGl0b3IpXG4gICAgICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgICAgICB9LCA4MClcbiAgICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBnZXRFdmVudCA9IChzY3JlZW5FdmVudCkgPT4ge1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB0b2tlbml6ZXI9Z2V0VG9rZW5pemVyKHRva2VuaXplckRlZnx8e1xuICAgICAgICAgICAgbmFtZTond29yZHMnLFxuICAgICAgICAgICAgZmxhZ3M6J21nJyxcbiAgICAgICAgICAgIGRlZmluaXRpb25zOntcbiAgICAgICAgICAgICAgICBXaGl0ZXNwYWNlOiAgICAgICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovXFxzKy9naX0sXG4gICAgICAgICAgICAgICAgV29yZDogICAgICAgICAgICAge3N0eWxlOiB7Zmc6J2dyZWVuJ30scGF0dGVybjovXFxiLis/XFxiL2dpfSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgZXZ0ID0gZWRpdG9yLmdldEV2ZW50KGJveFJlZi5jdXJyZW50Lmxwb3Msc2NyZWVuRXZlbnQsdG9rZW5pemVyKTtcblxuICAgICAgICAvLyBlZGl0b3Iuc2V0Q3Vyc29yKHNjcmVlbkV2ZW50LngtYm94UmVmLmN1cnJlbnQubHBvcy54aStlZGl0b3Iudmlld3BvcnRYLHNjcmVlbkV2ZW50LnktYm94UmVmLmN1cnJlbnQubHBvcy55aStlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICByZXR1cm4gZXZ0XG4gICAgfVxuICAgIGNvbnN0IG9ubW91c2Vtb3ZlPWRlYm91bmNlZCgoc2NyZWVuRXZlbnQpPT57XG4gICAgICAgIGNvbnN0IG5ld0V2ZW50ID0gZ2V0RXZlbnQoc2NyZWVuRXZlbnQpXG4gICAgICAgIGVkaXRvci5zZXRIaWdobGlnaHQobmV3RXZlbnQuY3Vyc29yU2NyZWVuLnggKyBlZGl0b3Iudmlld3BvcnRYLCBuZXdFdmVudC5jdXJzb3JTY3JlZW4ueSArIGVkaXRvci52aWV3cG9ydFkpXG4gICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgICAgICBvbkxpbmVIb3ZlcihuZXdFdmVudCk7XG4gICAgICAgIG9uVG9rZW5Ib3ZlcihuZXdFdmVudCk7XG4gICAgfSwxMClcbiAgICBjb25zdCBtb3VzZUFjdGlvbj0oc2NyZWVuRXZlbnQpID0+e1xuXG4gICAgICAgIHN3aXRjaChzY3JlZW5FdmVudC5hY3Rpb24pe1xuICAgICAgICAgICAgY2FzZSAnbW91c2Vtb3ZlJzoge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXdFdmVudCA9IGdldEV2ZW50KHNjcmVlbkV2ZW50KVxuICAgICAgICAgICAgICAgICAgICBlZGl0b3Iuc2V0SGlnaGxpZ2h0KG5ld0V2ZW50LmN1cnNvclNjcmVlbi54ICsgZWRpdG9yLnZpZXdwb3J0WCwgbmV3RXZlbnQuY3Vyc29yU2NyZWVuLnkgKyBlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICAgICAgICAgICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKT0+e1xuICAgICAgICAgICAgICAgICAgICAgICAgb25MaW5lSG92ZXIobmV3RXZlbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2tlbkhvdmVyKG5ld0V2ZW50KTtcbiAgICAgICAgICAgICAgICAgICAgfSwxKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ21vdXNlZG93bic6IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3RXZlbnQgPSBnZXRFdmVudChzY3JlZW5FdmVudClcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGl0b3Iuc2V0Q3Vyc29yKHNjcmVlbkV2ZW50LngtYm94UmVmLmN1cnJlbnQubHBvcy54aStlZGl0b3Iudmlld3BvcnRYLHNjcmVlbkV2ZW50LnktYm94UmVmLmN1cnJlbnQubHBvcy55aStlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICAgICAgICAgICAgICAgICAgZWRpdG9yLnNldEhpZ2hsaWdodChuZXdFdmVudC5jdXJzb3JTY3JlZW4ueCArIGVkaXRvci52aWV3cG9ydFgsIG5ld0V2ZW50LmN1cnNvclNjcmVlbi55ICsgZWRpdG9yLnZpZXdwb3J0WSlcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgICAgICAgICAgICAgICAgICB9LCAxKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ21vdXNldXAnOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0V2ZW50ID0gZ2V0RXZlbnQoc2NyZWVuRXZlbnQpXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHt4LHl9ID0gc2NyZWVuRXZlbnQ7XG4gICAgICAgICAgICAgICAgICAgIC8vIHNldExhc3RFdmVudChuZXdFdmVudCk7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCk9PntcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkaXRvci5zZXRIaWdobGlnaHQobnVsbClcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkaXRvci5zZXRDdXJzb3Ioc2NyZWVuRXZlbnQueC1ib3hSZWYuY3VycmVudC5scG9zLnhpK2VkaXRvci52aWV3cG9ydFgsc2NyZWVuRXZlbnQueS1ib3hSZWYuY3VycmVudC5scG9zLnlpK2VkaXRvci52aWV3cG9ydFkpXG4gICAgICAgICAgICAgICAgICAgICAgICBlZGl0b3Iuc2V0SGlnaGxpZ2h0KG5ld0V2ZW50LmN1cnNvclNjcmVlbi54ICsgZWRpdG9yLnZpZXdwb3J0WCwgbmV3RXZlbnQuY3Vyc29yU2NyZWVuLnkgKyBlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICAgICAgICAgICAgICAgICAgb25MaW5lQ2xpY2sobmV3RXZlbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2tlbkNsaWNrKG5ld0V2ZW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgICAgICAgICAgICAgICAgICB9LDEpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnd2hlZWx1cCc6IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3RXZlbnQgPSBnZXRFdmVudChzY3JlZW5FdmVudClcbiAgICAgICAgICAgICAgICAgICAgZWRpdG9yLm1vdmVDdXJzb3JVcCgpLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpO1xuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpPT57XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGl0b3Iuc2V0SGlnaGxpZ2h0KG51bGwpXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBlZGl0b3Iuc2V0Q3Vyc29yKHNjcmVlbkV2ZW50LngtYm94UmVmLmN1cnJlbnQubHBvcy54aStlZGl0b3Iudmlld3BvcnRYLHNjcmVlbkV2ZW50LnktYm94UmVmLmN1cnJlbnQubHBvcy55aStlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgICAgICAgICAgICAgIH0sMSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICd3aGVlbGRvd24nOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0V2ZW50ID0gZ2V0RXZlbnQoc2NyZWVuRXZlbnQpXG4gICAgICAgICAgICAgICAgICAgIGVkaXRvci5tb3ZlQ3Vyc29yRG93bigpLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpO1xuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpPT57XG4gICAgICAgICAgICAgICAgICAgICAgICBlZGl0b3Iuc2V0SGlnaGxpZ2h0KG51bGwpXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBlZGl0b3Iuc2V0Q3Vyc29yKHNjcmVlbkV2ZW50LngtYm94UmVmLmN1cnJlbnQubHBvcy54aStlZGl0b3Iudmlld3BvcnRYLHNjcmVlbkV2ZW50LnktYm94UmVmLmN1cnJlbnQubHBvcy55aStlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgICAgICAgICAgICAgIH0sMSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBkZWZhdWx0OiB0aHJvdyBuZXcgRXJyb3Ioc2FmZVN0cmluZ2lmeShzY3JlZW5FdmVudCkpOyBicmVhaztcbiAgICAgICAgfVxuICAgIH1cbiAgICBjb25zdCByZW5kZXJMaW5lcyA9ICgpID0+IHtcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qge3ZpZXdwb3J0WTp2eSx2aWV3cG9ydEhlaWdodDp2aH0gPSBlZGl0b3JcbiAgICAgICAgcmV0dXJuIGVkaXRvci5yZW5kZXJUb0xpbmVzKClcbiAgICAgICAgICAgIC5maWx0ZXIoKGwseSkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiAoeSA+PXZ5ICYmIHkgPD0gKHZ5ICsgdmgpKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAuZmxhdE1hcCgobGluZSxpbmRleCxhcnIpPT57XG4gICAgICAgICAgICAgICAgY29uc3QgcmVuZGVyYWJsZXMgPSBbXG4gICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgIGtleT17YGxpc3RjLWxpbmUtJHtpbmRleH0tJHtEYXRlLm5vd31gfVxuICAgICAgICAgICAgICAgICAgICAgICAgdG9wPXtpbmRleH0gbGVmdD17MH0gaGVpZ2h0PXsxfSB3aWR0aD17bGluZS5sZW5ndGh8fDF9XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50PXtsaW5lfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICBjb25zdCB0b2tlbml6ZXI9Z2V0VG9rZW5pemVyKHRva2VuaXplckRlZnx8e1xuICAgICAgICAgICAgICAgICAgICBuYW1lOid3b3JkcycsXG4gICAgICAgICAgICAgICAgICAgIGZsYWdzOidtZycsXG4gICAgICAgICAgICAgICAgICAgIGRlZmluaXRpb25zOntcbiAgICAgICAgICAgICAgICAgICAgICAgIFdoaXRlc3BhY2U6ICAgICAgIHtzdHlsZToge2ZnOidyZWQnfSxwYXR0ZXJuOi9cXHMrL21pZ30sXG4gICAgICAgICAgICAgICAgICAgICAgICBXb3JkOiAgICAgICAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9cXGIuKz9cXGIvbWlnfSxcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemVyKGxpbmUsaW5kZXgpXG4gICAgICAgICAgICAgICAgdG9rZW5zLmZvckVhY2goKHRva2VuLGopPT57XG4gICAgICAgICAgICAgICAgICAgIHJlbmRlcmFibGVzLnB1c2goXG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAga2V5PXtgbGlzdGMtbGluZS0ke2luZGV4fS10b2tlbi0ke2p9LSR7RGF0ZS5ub3d9YH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b3A9e2luZGV4fSBsZWZ0PXt0b2tlbi5zdGFydH0gaGVpZ2h0PXsxfSB3aWR0aD17dG9rZW4udGV4dC5sZW5ndGh8fDF9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudD17dG9rZW4udGV4dH0gc3R5bGU9e3Rva2VuLnN0eWxlfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz4pXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVuZGVyYWJsZXNcbiAgICAgICAgICAgIH0pXG4gICAgfVxuICAgIGNvbnN0IHJlbmRlckN1cnNvciA9ICgpID0+IHtcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaSA9IGVkaXRvci5jdXJzb3JJbmRleFxuICAgICAgICBjb25zdCB7eCx5fSA9IGVkaXRvci5jdXJzb3JDb29yZHMoKVxuICAgICAgICBjb25zdCB7Y3Vyc29ySW5kZXg6Y2ksdmlld3BvcnRYOnZ4LHZpZXdwb3J0WTp2eSx2aWV3cG9ydEhlaWdodDp2aCx2aWV3cG9ydFdpZHRoOnZ3fSA9IGVkaXRvcjtcbiAgICAgICAgcmV0dXJuICg8Ym94XG4gICAgICAgICAgICBrZXk9e2BlZGl0b3ItY3Vyc29yLSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgdG9wPXt5LXZ5fVxuICAgICAgICAgICAgbGVmdD17eC12eH1cbiAgICAgICAgICAgIHdpZHRoPXsxfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBzdHlsZT17e2ludmVyc2U6dHJ1ZX19XG4gICAgICAgICAgICBjb250ZW50PXtlZGl0b3IuYnVmZmVyLnN1YnN0cmluZyhpLGkrMSl9XG4gICAgICAgIC8+KVxuICAgIH1cbiAgICBjb25zdCByZW5kZXJIaWdobGlnaHQ9KCk9PntcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaSA9IGVkaXRvci5jdXJzb3JJbmRleFxuICAgICAgICBjb25zdCB7eCx5fSA9IGVkaXRvci5oaWdobGlnaHRDb29yZHMoKVxuICAgICAgICBjb25zdCB7Y3Vyc29ySW5kZXg6Y2ksdmlld3BvcnRYOnZ4LHZpZXdwb3J0WTp2eSx2aWV3cG9ydEhlaWdodDp2aCx2aWV3cG9ydFdpZHRoOnZ3fSA9IGVkaXRvcjtcbiAgICAgICAgY29uc3QgdG9rZW5pemVyPWdldFRva2VuaXplcih0b2tlbml6ZXJEZWZ8fHtcbiAgICAgICAgICAgIG5hbWU6J3dvcmRzJyxcbiAgICAgICAgICAgIGZsYWdzOidtZycsXG4gICAgICAgICAgICBkZWZpbml0aW9uczp7XG4gICAgICAgICAgICAgICAgV2hpdGVzcGFjZTogICAgICAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1xccysvbWlnfSxcbiAgICAgICAgICAgICAgICBXb3JkOiAgICAgICAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9cXGIuKz9cXGIvbWlnfSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgdG9rZW5VbmRlckN1cnNvcj1lZGl0b3IudG9rZW5VbmRlckN1cnNvcih4LHksdG9rZW5pemVyKVxuICAgICAgICBpZih0b2tlblVuZGVyQ3Vyc29yKSB7XG4gICAgICAgICAgICByZXR1cm4gKDxib3hcbiAgICAgICAgICAgICAgICBrZXk9e2BlZGl0b3ItaGlnaGxpZ2h0LSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgICAgIHRvcD17eSAtIHZ5fVxuICAgICAgICAgICAgICAgIGxlZnQ9e3Rva2VuVW5kZXJDdXJzb3Iuc3RhcnR9XG4gICAgICAgICAgICAgICAgd2lkdGg9e3Rva2VuVW5kZXJDdXJzb3IudGV4dC5sZW5ndGh9IGhlaWdodD17MX1cbiAgICAgICAgICAgICAgICBzdHlsZT17ey4uLnRva2VuVW5kZXJDdXJzb3Iuc3R5bGUsIGludmVyc2U6IHRydWV9fVxuICAgICAgICAgICAgICAgIGNvbnRlbnQ9e3Rva2VuVW5kZXJDdXJzb3IudGV4dH1cbiAgICAgICAgICAgIC8+KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIFtdXG4gICAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgcmVuZGVyU2Nyb2xsYmFyID0gKCkgPT4ge1xuICAgICAgICBjb25zdCBiYXJFbGVtZW50cz0gWyg8Ym94XG4gICAgICAgICAgICBrZXk9e2BzY3JvbGxiYXItYmctJHtEYXRlLm5vdygpfWB9XG4gICAgICAgICAgICByaWdodD17MH1cbiAgICAgICAgICAgIHdpZHRoPXsxfVxuICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgIHN0eWxlPXt7Zmc6ICdjeWFuJyxiZzogJ2dyZXknfX1cbiAgICAgICAgLz4pXTtcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm4gYmFyRWxlbWVudHNcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB0aD1lZGl0b3IucmVuZGVyVG9MaW5lcygpLmxlbmd0aFxuXG4gICAgICAgIGNvbnN0IHtjdXJzb3JJbmRleDpjaSx2aWV3cG9ydFg6dngsdmlld3BvcnRZOnZ5LHZpZXdwb3J0SGVpZ2h0OnZoLHZpZXdwb3J0V2lkdGg6dnd9ID0gZWRpdG9yO1xuICAgICAgICBjb25zdCBzaD1NYXRoLmZsb29yKHZoKnZoL3RoKSsxXG4gICAgICAgIGNvbnN0IHN5PU1hdGguZmxvb3IodnkqdmgvdGgpKzFcbiAgICAgICAgYmFyRWxlbWVudHMucHVzaCgoPGJveFxuICAgICAgICAgICAga2V5PXtgc2Nyb2xsYmFyLWJ0bi0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgIHJpZ2h0PXswfVxuICAgICAgICAgICAgd2lkdGg9ezF9XG4gICAgICAgICAgICB0b3A9e3N5fVxuICAgICAgICAgICAgaGVpZ2h0PXtzaH1cbiAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICBpbnB1dFxuICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICBmb2N1c2VkXG4gICAgICAgICAgICBzdHlsZT17e2ZnOiAnY3lhbicsYmc6ICdjeWFuJ319XG4gICAgICAgIC8+KSlcbiAgICAgICAgcmV0dXJuIGJhckVsZW1lbnRzXG4gICAgfVxuICAgIGNvbnN0IHJlbmRlclN0YXR1cz0oKT0+e1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB7dmlld3BvcnRYOnZ4LHZpZXdwb3J0WTp2eSx2aWV3cG9ydEhlaWdodDp2aCx2aWV3cG9ydFdpZHRoOnZ3fSA9IGVkaXRvclxuICAgICAgICBjb25zdCB0PUpTT04uc3RyaW5naWZ5KGVkaXRvci5jdXJzb3JDb29yZHMoKSkucmVwbGFjZSgvXCIvZ2ksJycpXG4gICAgICAgIHJldHVybiAoPGJveFxuICAgICAgICAgICAgbW91c2Uga2V5c1xuICAgICAgICAgICAga2V5PXtgZWRpdG9yLXN0YXR1cy0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgIHRvcD17LTF9XG4gICAgICAgICAgICBsZWZ0PXt2dy0xMX1cbiAgICAgICAgICAgIHdpZHRoPXt0Lmxlbmd0aH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgc3R5bGU9e3tpbnZlcnNlOnRydWV9fVxuICAgICAgICAgICAgY29udGVudD17dH1cbiAgICAgICAgLz4pXG4gICAgfVxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3hcbiAgICAgICAgICAgIHJlZj17Ym94UmVmfVxuICAgICAgICAgICAgey4uLmJveFByb3BzfVxuICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgIHN0eWxlPXt7IGJvcmRlcjogeyBmZzogJ2N5YW4nIH0gfX1cbiAgICAgICAgICAgIHRhZ3M9e2ZhbHNlfSAgICAgICAgICAgLy8gcmF3IEFOU0lcbiAgICAgICAgICAgIHNjcm9sbGFibGU9e2ZhbHNlfVxuICAgICAgICAgICAgb25LZXlwcmVzcz17aW50ZXJuYWxPbktleVByZXNzfVxuICAgICAgICAgICAgb25Nb3VzZT17bW91c2VBY3Rpb259XG4gICAgICAgID5cbiAgICAgICAgICAgIHsvKmxhYmVsID0ge2Ake2JveFByb3BzLmxhYmVsIHx8ICdFZGl0aW5nJ30gJHtKU09OLnN0cmluZ2lmeShlZGl0b3IuY3Vyc29yQ29vcmRzKCkpfSAke2VkaXRvci5jdXJzb3JJbmRleH1gfSovfVxuICAgICAgICAgICAge3JlbmRlckxpbmVzKCl9XG4gICAgICAgICAgICB7cmVuZGVyQ3Vyc29yKCl9XG4gICAgICAgICAgICB7cmVuZGVyU2Nyb2xsYmFyKCl9XG4gICAgICAgICAgICB7Y2hpbGRyZW58fFtdfVxuICAgICAgICAgICAge3JlbmRlckhpZ2hsaWdodCgpfVxuICAgICAgICAgICAge3JlbmRlclN0YXR1cygpfVxuICAgICAgICA8L2JveD4pXG59IiwiLy8gc3JjL0ZpbGVUcmVlLmpzXG5pbXBvcnQgUmVhY3QsIHtDb21wb25lbnQsIHVzZUVmZmVjdCwgdXNlUmVmLCB1c2VTdGF0ZX0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHsgTGlzdEVsZW1lbnQgYXMgbGlzdCwgVGV4dEVsZW1lbnQgYXMgdGV4dCwgQm94RWxlbWVudCBhcyBib3ggfSBmcm9tICdyZWFjdC1ibGVzc2VkJztcbmltcG9ydCB7IFdvcmtzcGFjZSxJTm9kZSB9IGZyb20gJy4vV29ya3NwYWNlJztcbmltcG9ydCB7aW5zZXJ0QXQsIHNhZmVTdHJpbmdpZnl9IGZyb20gXCIuL3V0aWxcIjtcbmltcG9ydCB7TGlzdENvbXBvbmVudH0gZnJvbSBcIi4vTGlzdENvbXBvbmVudFwiO1xuaW1wb3J0IE1vZGFsRGlhbG9nIGZyb20gXCIuL01vZGFsRGlhbG9nXCI7XG5jb25zdCBsaXN0aW5nVG9rZW5pemVyRGVmaW5pdGlvbj17XG4gICAgbmFtZTonbGlzdGluZycsXG4gICAgZmxhZ3M6J21nJyxcbiAgICBkZWZpbml0aW9uczp7XG4gICAgICAgIFwiV2hpdGVzcGFjZVwiOiAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovXFxzKy9tZ2l9LFxuICAgICAgICBcIkZvbGRlclwiOiAgICAgICAgIHtzdHlsZToge2ZnOid3aGl0ZSd9LHBhdHRlcm46Lyg/PD1cXFtbLStdXSlcXFMrL21naX0sXG4gICAgICAgIFwiT3BlbkJ1dHRvblwiOiAgICAge3N0eWxlOiB7Zmc6J3llbGxvdyd9LHBhdHRlcm46L1xcW1xcK10vbWdpfSxcbiAgICAgICAgXCJDbG9zZUJ1dHRvblwiOiAgICB7c3R5bGU6IHtmZzoneWVsbG93J30scGF0dGVybjovXFxbLV0vbWdpfSxcbiAgICAgICAgXCJBZGREaXJCdXR0b25cIjogICB7c3R5bGU6IHtmZzonY3lhbid9LHBhdHRlcm46L1xcW1xcK0RdL21naX0sXG4gICAgICAgIFwiQWRkRmlsZUJ1dHRvblwiOiAge3N0eWxlOiB7Zmc6J21hZ2VudGEnfSxwYXR0ZXJuOi9cXFtcXCtGXS9tZ2l9LFxuICAgICAgICBcIlJlbmFtZUJ1dHRvblwiOiAgIHtzdHlsZToge2ZnOidibHVlJ30scGF0dGVybjovXFxbcl0vbWdpfSxcbiAgICAgICAgXCJEZWxldGVCdXR0b25cIjogICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovXFxbeF0vbWdpfSxcbiAgICAgICAgXCJOb2RlTmFtZVwiOiAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9bYS16QS1aMC05Xz17fVxcW1xcXSUqKCltLC46OyE/QH4tXSsvbWdpfSxcbiAgICAgICAgXCJXb3JkXCI6ICAgICAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9cXHMuKz9cXHMvbWdpfSxcbiAgICB9XG59XG4vKipcbiAqXG4gKiBAcGFyYW0ge0lOb2RlW119IHRyZWVcbiAqIEBwYXJhbSB7KG5vZGU6SU5vZGUpLT51bmRlZmluZWR9IG9uRGlyU2VsZWN0XG4gKiBAcGFyYW0geyhub2RlOklOb2RlKS0+dW5kZWZpbmVkfSBvbkZpbGVTZWxlY3RcbiAqIEByZXR1cm5zIHtKU1guRWxlbWVudH1cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBGaWxlVHJlZSh7XG4gICAgY2hpbGRyZW4sXG4gICAgcm9vdERpcixcbiAgICBvbkRpclNlbGVjdCxcbiAgICBvbkZpbGVTZWxlY3QsXG4gICAgbGFiZWwsXG4gICAgaW5vZGVGaWx0ZXI9KGlub2RlLGluZGV4LG5vZGVzLHBhcmVudCk9PntyZXR1cm4gdHJ1ZX0sXG4gICAgY3Vyc29yPXRydWUsXG4gICAgLi4uYm94UHJvcHNcbn0pe1xuICAgIGNvbnN0IGJveFJlZiA9IHVzZVJlZigpO1xuICAgIGNvbnN0IFttZXNzYWdlLCBzZXRNZXNzYWdlXSA9IFJlYWN0LnVzZVN0YXRlKGZhbHNlKTtcbiAgICBjb25zdCBbc2VsZWN0ZWQsIHNldFNlbGVjdGVkXSA9IFJlYWN0LnVzZVN0YXRlKG51bGwpO1xuICAgIGNvbnN0IFtjdXJzb3JEYXRhLCBzZXRDdXJzb3JEYXRhXSA9IFJlYWN0LnVzZVN0YXRlKG51bGwpO1xuICAgIGNvbnN0IFt3b3Jrc3BhY2Usc2V0V29ya3NwYWNlXSA9IHVzZVN0YXRlKG5ldyBXb3Jrc3BhY2UoaW5vZGVGaWx0ZXIpKTtcblxuXG5cbiAgICAvLyBmb2N1cyB0aGUgbW9kYWwgc28gaXQgY2FuIGNhdGNoIGtleXByZXNzZXNcbiAgICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgICAgICBjb25zdCBub2RlID0gYm94UmVmLmN1cnJlbnQ7XG4gICAgICAgIGlmIChub2RlKSBub2RlLmZvY3VzKCk7XG4gICAgICAgIHdvcmtzcGFjZS5pbml0KHJvb3REaXIpXG4gICAgICAgICAgICAudGhlbih3ayA9PiB3b3Jrc3BhY2Uub3Blbih3b3Jrc3BhY2Uucm9vdE5vZGUpKVxuICAgICAgICAgICAgLnRoZW4od2sgPT4ge1xuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCk9PntcbiAgICAgICAgICAgICAgICAgICAgc2V0V29ya3NwYWNlKHdrLmNvcHkoKSlcbiAgICAgICAgICAgICAgICB9LDEwMClcbiAgICAgICAgICAgICAgICAvLy8gc2V0TWVzc2FnZShgbG9hZGVkIHRyZWUgZGF0YSAke0pTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICAvLy8gICB3a1xuICAgICAgICAgICAgICAgIC8vLyB9KX1gKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgLy8gc2V0V29ya3NwYWNlKHdvcmtzcGFjZS5jb3B5KCkpXG4gICAgfSwgW3Jvb3REaXJdKTtcbiAgICBsZXQgYmFzZUxldmVsPXJvb3REaXIuc3BsaXQoXCIvXCIpLmxlbmd0aCoyXG4gICAgaWYgKGJhc2VMZXZlbD4wKSB7XG4gICAgICAgYmFzZUxldmVsID0gYmFzZUxldmVsLTFcbiAgICB9XG4gICAgbGV0IGxpbmVzID0gKCkgPT4ge1xuICAgICAgICB0cnl7XG4gICAgICAgICAgICBjb25zdCBscG9zID0gYm94UmVmLmN1cnJlbnQubHBvc1xuICAgICAgICAgICAgY29uc3QgdHJlZURhdGEgPSB3b3Jrc3BhY2UuZmxhdHRlbigpLmZpbHRlcihpbm9kZUZpbHRlcilcblxuICAgICAgICAgICAgcmV0dXJuICh0cmVlRGF0YSB8fCBbXSkubWFwKCh2LCBpLCBhKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGluZUJ1ZmZlciA9IFwiIFwiLnJlcGVhdChscG9zLndpZHRoKVxuICAgICAgICAgICAgICAgIGNvbnN0IHQgPSB2LnRvVGV4dCgpLnN1YnN0cmluZyhiYXNlTGV2ZWwpXG4gICAgICAgICAgICAgICAgbGV0IHJyID0gaW5zZXJ0QXQobGluZUJ1ZmZlciwwLHQpXG4gICAgICAgICAgICAgICAgc3dpdGNoICh2LnR5cGUuc3Vic3RyaW5nKDAsIDEpKSB7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgJ2QnOlxuICAgICAgICAgICAgICAgICAgICAgICAgcnI9aW5zZXJ0QXQocnIsbHBvcy53aWR0aC0xNywnWytEXVsrRl1bcl1beF0nKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJyXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICBycj1pbnNlcnRBdChycixscG9zLndpZHRoLTksJ1tyXVt4XScpXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcnJcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9Y2F0Y2goZXJyKXtcbiAgICAgICAgICAgIHJldHVybiBbXVxuICAgICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG9uVG9rZW5DbGljaz0oZXZlbnREYXRhKT0+e1xuICAgICAgICBjb25zdCB0cmVlRGF0YSA9IHdvcmtzcGFjZS5mbGF0dGVuKCkuZmlsdGVyKGlub2RlRmlsdGVyKVxuICAgICAgICBjb25zdCB7bGluZXMsIHZpc2libGVMaW5lcywgbGluZSwgY3Vyc29yOnt4LHl9LGN1cnNvclNjcmVlbiwgYnVmZmVyLCB2aXNpYmxlQnVmZmVyLCBpbmRleCx0b2tlbnMsdG9rZW5VbmRlckN1cnNvcixwaHJhc2V9ID0gZXZlbnREYXRhXG4gICAgICAgIGNvbnN0IG5vZGUgPSB0cmVlRGF0YVt5XTtcbiAgICAgICAgLy8gdGhyb3cgSlNPTi5zdHJpbmdpZnkoe25vZGUseX0sbnVsbCwgJyAnKVxuICAgICAgICAvLyBpZiAobm9kZS50eXBlLmluZGV4T2YoJ2QnKT4tMSkge1xuICAgICAgICBzd2l0Y2gocGhyYXNlLmZpbHRlcih2ID0+IHYhPT0nV2hpdGVzcGFjZScpLmpvaW4oXCIsXCIpKXtcbiAgICAgICAgICAgIGNhc2UgXCJXaGl0ZXNwYWNlLE5vZGVOYW1lXCI6XG4gICAgICAgICAgICBjYXNlIFwiTm9kZU5hbWUsUmVuYW1lQnV0dG9uLERlbGV0ZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgIHN3aXRjaCgodG9rZW5VbmRlckN1cnNvcnx8e3R5cGU6J3VuZGVmaW5lZCd9KS50eXBlKXtcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIk5vZGVOYW1lXCI6XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRTZWxlY3RlZChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG9uRmlsZVNlbGVjdChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDowLHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJSZW5hbWVCdXR0b25cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYFJlbmFtZVxcbiR7bm9kZS5mdWxsUGF0aH1gKVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIkRlbGV0ZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgRGVsZXRlXFxuJHtub2RlLmZ1bGxQYXRofWApXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzZXRDdXJzb3JEYXRhKHtjdXJzb3I6e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5fSxjdXJzb3JTY3JlZW46e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5OmN1cnNvclNjcmVlbi55fSxjb250ZW50OnRva2VuVW5kZXJDdXJzb3IudGV4dCxzdHlsZTp0b2tlblVuZGVyQ3Vyc29yLnN0eWxlfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgXCJXaGl0ZXNwYWNlLE9wZW5CdXR0b24sV2hpdGVzcGFjZSxOb2RlTmFtZVwiOlxuICAgICAgICAgICAgY2FzZSBcIldoaXRlc3BhY2UsQ2xvc2VCdXR0b24sV2hpdGVzcGFjZSxOb2RlTmFtZVwiOlxuICAgICAgICAgICAgY2FzZSBcIk9wZW5CdXR0b24sTm9kZU5hbWUsQWRkRGlyQnV0dG9uLEFkZEZpbGVCdXR0b24sUmVuYW1lQnV0dG9uLERlbGV0ZUJ1dHRvblwiOlxuICAgICAgICAgICAgY2FzZSBcIkNsb3NlQnV0dG9uLE5vZGVOYW1lLEFkZERpckJ1dHRvbixBZGRGaWxlQnV0dG9uLFJlbmFtZUJ1dHRvbixEZWxldGVCdXR0b25cIjpcbiAgICAgICAgICAgICAgICBzd2l0Y2goKHRva2VuVW5kZXJDdXJzb3J8fHt0eXBlOid1bmRlZmluZWQnfSkudHlwZSl7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJPcGVuQnV0dG9uXCI6XG4gICAgICAgICAgICAgICAgICAgICAgICBub2RlLm9wZW4od29ya3NwYWNlLnJvb3REaXIsd29ya3NwYWNlLmlnKS50aGVuKG4gPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHdrPXdvcmtzcGFjZS5jb3B5KClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZCA9IHdrLmZsYXR0ZW4oKS5maWx0ZXIoaW5vZGVGaWx0ZXIpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0V29ya3NwYWNlKHdrKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eCx5fSxjdXJzb3JTY3JlZW46e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5OmN1cnNvclNjcmVlbi55fSxjb250ZW50OnRva2VuVW5kZXJDdXJzb3IudGV4dCxzdHlsZTp0b2tlblVuZGVyQ3Vyc29yLnN0eWxlfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIkNsb3NlQnV0dG9uXCI6XG4gICAgICAgICAgICAgICAgICAgICAgICBub2RlLmNsb3NlKClcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHdrPXdvcmtzcGFjZS5jb3B5KClcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRkID0gd2suZmxhdHRlbigpLmZpbHRlcihpbm9kZUZpbHRlcilcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldFdvcmtzcGFjZSh3aylcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJOb2RlTmFtZVwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0U2VsZWN0ZWQobm9kZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBvbkRpclNlbGVjdChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJBZGREaXJCdXR0b25cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYEFkZERpclxcbiR7bm9kZS5mdWxsUGF0aH1gKVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIkFkZEZpbGVCdXR0b25cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYEFkZEZpbGVcXG4ke25vZGUuZnVsbFBhdGh9YClcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJSZW5hbWVCdXR0b25cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYFJlbmFtZVxcbiR7bm9kZS5mdWxsUGF0aH1gKVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIkRlbGV0ZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgRGVsZXRlXFxuJHtub2RlLmZ1bGxQYXRofWApXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzZXRDdXJzb3JEYXRhKHtjdXJzb3I6e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5fSxjdXJzb3JTY3JlZW46e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5OmN1cnNvclNjcmVlbi55fSxjb250ZW50OnRva2VuVW5kZXJDdXJzb3IudGV4dCxzdHlsZTp0b2tlblVuZGVyQ3Vyc29yLnN0eWxlfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIHBocmFzZSBTdHJ1Y3R1cmUgJyR7cGhyYXNlfSdgKVxuICAgICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGN1cnNvckV4dHJhPSgpPT57XG4gICAgICAgIGlmKCFjdXJzb3JEYXRhKSByZXR1cm4gPGJveCB0b3A9ezB9IGxlZnQ9ezB9IHdpZHRoPXsxfSBoZWlnaHQ9ezF9IGNvbnRlbnQ9eycgJ30vPjtcbiAgICAgICAgY29uc3Qge2N1cnNvcixjdXJzb3JTY3JlZW4sY29udGVudH0gPSBjdXJzb3JEYXRhXG4gICAgICAgIHJldHVybiA8Ym94IGtleT17YHhjdXJzb3ItJHtNYXRoLnJhbmRvbSgpfS0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgIHRvcD17Y3Vyc29yU2NyZWVuLnl9IGxlZnQ9e2N1cnNvclNjcmVlbi54fVxuICAgICAgICAgICAgd2lkdGg9e2NvbnRlbnQubGVuZ3RofSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBzdHlsZT17e2ludmVyc2U6IHRydWV9fVxuICAgICAgICAgICAgY29udGVudD17Y29udGVudH1cbiAgICAgICAgLz5cbiAgICB9XG4gICAgcmV0dXJuIChcbiAgICAgICAgPD5cbiAgICAgICAgPGJveCB7Li4uYm94UHJvcHN9IHJlZj17Ym94UmVmfT5cbiAgICAgICAgICAgIDxMaXN0Q29tcG9uZW50XG4gICAgICAgICAgICAgICAgc2Nyb2xsYmFyPXt7IGNoOiAnPScsIHRyYWNrOiB7IGZnOidibHVlJywgYmc6ICdncmV5JyB9IH19XG4gICAgICAgICAgICAgICAgdG9wPXswfVxuICAgICAgICAgICAgICAgIGJvdHRvbT17Mn1cbiAgICAgICAgICAgICAgICBsaW5lcz17bGluZXMoKX1cbiAgICAgICAgICAgICAgICBrZXlzIG1vdXNlXG4gICAgICAgICAgICAgICAgc3R5bGU9e3sgc2VsZWN0ZWQ6IHsgYmc6ICdibHVlJyB9IH19XG4gICAgICAgICAgICAgICAgb25Ub2tlbkNsaWNrPXtvblRva2VuQ2xpY2t9XG4gICAgICAgICAgICAgICAgdG9rZW5pemVyRGVmPXtsaXN0aW5nVG9rZW5pemVyRGVmaW5pdGlvbn1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICB7Lyo8Ym94IHRvcD17MH0gY29udGVudD17c2VsZWN0ZWQgPyBzZWxlY3RlZC5mdWxsUGF0aCA6ICcnICsgJyAnICsgbGFiZWx9IGhlaWdodD17MX0vPiovfVxuICAgICAgICAgICAge2NoaWxkcmVufHxbXX1cbiAgICAgICAgICAgIHtjdXJzb3I/Y3Vyc29yRXh0cmEoKTpbXX1cbiAgICAgICAgPC9ib3g+XG4gICAgICAgIHttZXNzYWdlICYmIChcbiAgICAgICAgICAgIDxNb2RhbERpYWxvZ1xuICAgICAgICAgICAgICAgIGxhYmVsPXsnTWVzc2FnZSd9XG4gICAgICAgICAgICAgICAgdGl0bGU9XCJNZXNzYWdlXCJcbiAgICAgICAgICAgICAgICBvbkNsb3NlPXsoKSA9PiBzZXRNZXNzYWdlKGZhbHNlKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8dGV4dD57bWVzc2FnZX08L3RleHQ+XG4gICAgICAgICAgICA8L01vZGFsRGlhbG9nPlxuICAgICAgICApfVxuICAgIDwvPlxuICAgICk7XG59XG5cbiIsIi8vIGNvbXBvbmVudHMvTW9kYWxEaWFsb2cuanNcbmltcG9ydCBSZWFjdCwgeyB1c2VFZmZlY3QsIHVzZVJlZix1c2VTdGF0ZSB9IGZyb20gJ3JlYWN0JztcbmltcG9ydCB7IEJveEVsZW1lbnQgYXMgYm94LCBUZXh0RWxlbWVudCBhcyB0ZXh0LCBCdXR0b25FbGVtZW50IGFzIGJ1dHRvbiB9IGZyb20gJ3JlYWN0LWJsZXNzZWQnO1xuaW1wb3J0IEZpbGVUcmVlIGZyb20gXCIuL0ZpbGVUcmVlXCI7XG5pbXBvcnQge1dvcmtzcGFjZX0gZnJvbSBcIi4vV29ya3NwYWNlXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEZvbGRlclBpY2tlckRpYWxvZyh7XG4gICAgdGl0bGUgPSAnRGlhbG9nJyxcbiAgICB3aWR0aCA9ICc1MCUnLFxuICAgIGhlaWdodCA9ICc1MCUnLFxuICAgIG9uRm9sZGVyU2VsZWN0LFxufSkge1xuICAgIGNvbnN0IFtzZWxlY3RlZCwgc2V0U2VsZWN0ZWRdID0gUmVhY3QudXNlU3RhdGUobnVsbCk7XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8RmlsZVRyZWVcbiAgICAgICAgICAgIHRvcD1cImNlbnRlclwiXG4gICAgICAgICAgICBsZWZ0PVwiY2VudGVyXCJcbiAgICAgICAgICAgIGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX1cbiAgICAgICAgICAgIHN0eWxlPXt7IGJnOiAnYmxhY2snLCBmZzogJ3doaXRlJyB9fVxuICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgLy8gY2xvc2Ugb24gRVNDXG4gICAgICAgICAgICBvbktleT17KGNoLCBrZXkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoa2V5Lm5hbWUgPT09ICdlc2NhcGUnKSBvbkZvbGRlclNlbGVjdChudWxsKTtcbiAgICAgICAgICAgIH19XG4gICAgICAgICAgICBsYWJlbD17c2VsZWN0ZWQ/c2VsZWN0ZWQuZnVsbE5hbWU6J1BpY2sgV29ya3NwYWNlJ31cbiAgICAgICAgICAgIHJvb3REaXI9eycvJ31cbiAgICAgICAgICAgIGlub2RlRmlsdGVyPXsoaW5vZGUsaW5kZXgsbm9kZXMscGFyZW50KT0+e3JldHVybiBpbm9kZS50eXBlLmluZGV4T2YoJ2QnKT4tMX19XG4gICAgICAgICAgICBvbkRpclNlbGVjdD17KHNlbGVjdERpcikgPT4ge1xuICAgICAgICAgICAgICAgIC8vIHRocm93IEpTT04uc3RyaW5naWZ5KHNlbGVjdERpcixudWxsLCcgJyk7XG4gICAgICAgICAgICAgICAgc2V0U2VsZWN0ZWQoc2VsZWN0RGlyKTtcbiAgICAgICAgICAgIH19XG4gICAgICAgICAgICBvbkZpbGVTZWxlY3Q9eygpPT57fX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgICAgIGxlZnQ9ezB9XG4gICAgICAgICAgICAgICAgYm90dG9tPXswfVxuICAgICAgICAgICAgICAgIGhlaWdodD17M31cbiAgICAgICAgICAgICAgICB3aWR0aD17JzQ1JSd9XG4gICAgICAgICAgICAgICAgdmFsaWduPXsnbWlkZGxlJ31cbiAgICAgICAgICAgICAgICBhbGlnbj17J2NlbnRlcid9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3tiZzonI2ZmYWEwMCcsZmc6JyMzMzMzMzMnLGhvdmVyOntiZzonI2ZmZGQ4OCcsZmc6JyMzMzMzMzMnfX19XG4gICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAvKiBkbyBzb21ldGhpbmcgKi9cbiAgICAgICAgICAgICAgICAgICAgb25Gb2xkZXJTZWxlY3Qoc2VsZWN0ZWQpXG4gICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICBjb250ZW50PXsnc2VsZWN0J31cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgICAgICAgICAgcmlnaHQ9ezB9XG4gICAgICAgICAgICAgICAgICAgIGJvdHRvbT17MH1cbiAgICAgICAgICAgICAgICAgICAgaGVpZ2h0PXszfVxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249eydtaWRkbGUnfVxuICAgICAgICAgICAgICAgICAgICBhbGlnbj17J2NlbnRlcid9XG4gICAgICAgICAgICAgICAgICAgIHdpZHRoPXsnNDUlJ31cbiAgICAgICAgICAgICAgICAgICAgc3R5bGU9e3tiZzonI2ZmYWEwMCcsZmc6JyMzMzMzMzMnLGhvdmVyOntiZzonI2ZmZGQ4OCcsZmc6JyMzMzMzMzMnfX19XG4gICAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgb25Gb2xkZXJTZWxlY3QobnVsbClcbiAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ9eydjYW5jZWwnfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgPC9GaWxlVHJlZT5cbiAgICApXG59XG4iLCIvLyBjb21wb25lbnRzL1ZUYWJzLmpzXG5pbXBvcnQgUmVhY3QsIHsgdXNlU3RhdGUgfSBmcm9tICdyZWFjdCc7XG5pbXBvcnQgeyBCb3hFbGVtZW50IGFzIGJveCwgVGV4dEVsZW1lbnQgYXMgdGV4dCB9IGZyb20gJ3JlYWN0LWJsZXNzZWQnO1xuaW1wb3J0IHsgR3JpZCxHcmlkSXRlbSB9IGZyb20gJ3JlYWN0LWJsZXNzZWQtY29udHJpYi0xNydcblxuLyoqXG4gKiA8VlRhYnMgdGFiV2lkdGg9XCIyMCVcIj5cbiAqICAgPFRhYiBuYW1lPVwiUHJvamVjdFwiPuKApjwvVGFiPlxuICogICA8VGFiIG5hbWU9XCJHaXRcIj7igKY8L1RhYj5cbiAqIDwvVlRhYnM+XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBWVGFicyh7IGNoaWxkcmVuLCAuLi5ib3hQcm9wc30pIHtcbiAgICBjb25zdCB0YWJzID0gUmVhY3QuQ2hpbGRyZW4udG9BcnJheShjaGlsZHJlbilcbiAgICAgICAgLmZpbHRlcihjaGlsZCA9PiBSZWFjdC5pc1ZhbGlkRWxlbWVudChjaGlsZCkgJiYgY2hpbGQucHJvcHMubmFtZSk7XG5cbiAgICBjb25zdCBbYWN0aXZlSW5kZXgsIHNldEFjdGl2ZUluZGV4XSA9IHVzZVN0YXRlKDApO1xuICAgIGNvbnN0IHRhYlNlbGVjdG9yU3R5bGU9e2ZnOicjZmZhYTAwJyxiZzonIzMzMzMzMycsaG92ZXI6e2JnOicjZmZkZDg4JyxmZzonIzMzMzMzMyd9fVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCB7Li4uYm94UHJvcHN9PlxuICAgICAgICA8R3JpZCByb3dzPXsxfSBjb2xzPXs2fSBoaWRlQm9yZGVyPlxuICAgICAgICAgICAgey8qIFRhYiBsaXN0ICovfVxuICAgICAgICAgICAgPGJveCByb3c9ezB9IGNvbD17MH0gcm93U3Bhbj17MX0gY29sU3Bhbj17MX0+XG4gICAgICAgICAgICAgICAge3RhYnMubWFwKCh0YWIsIGkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBrZXk9e3RhYi5wcm9wcy5uYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvcD17aSAqIDN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaGVpZ2h0PXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhZ3M9e2ZhbHNlfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXRBY3RpdmVJbmRleChpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFic1tpXS5wcm9wcy5vblRhYkNsaWNrKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfWNhdGNoKGVycil7fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3R5bGU9e3suLi50YWJTZWxlY3RvclN0eWxlLCBpbnZlcnNlOiAoYWN0aXZlSW5kZXggPT0gaSl9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ9eydcXG4gJyt0YWIucHJvcHMubmFtZX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICB9KX1cbiAgICAgICAgICAgIDwvYm94PlxuXG4gICAgICAgICAgICB7LyogQWN0aXZlIHRhYiBwYW5lbCAqL31cbiAgICAgICAgICAgIDxib3ggcm93PXswfSBjb2w9ezF9IHJvd1NwYW49ezF9IGNvbFNwYW49ezV9PlxuICAgICAgICAgICAgICAgIHt0YWJzW2FjdGl2ZUluZGV4XS5wcm9wcy5jaGlsZHJlbn1cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L0dyaWQ+XG4gICAgICAgIDwvYm94PlxuICAgICk7XG59XG5cbi8qKlxuICogSnVzdCBhIHNlbWFudGljIHdyYXBwZXIgdG8gY2FycnkgdGhlIGBuYW1lYCBwcm9wXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBUYWIoeyBjaGlsZHJlbiB9KSB7XG4gICAgcmV0dXJuIDw+e2NoaWxkcmVufTwvPjtcbn1cbiIsImltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQge2dldE5hbWVkVG9rZW5pemVyLCBUb2tlbml6ZXJUb2tlbn0gZnJvbSAnLi90b2tlbml6ZXIuanMnO1xuaW1wb3J0IHtzYWZlU3RyaW5naWZ5fSBmcm9tIFwiLi91dGlsXCI7XG5cbi8vIHRlc3QgdGVzdFxuXG5cbmV4cG9ydCBjbGFzcyBDdXJzb3JQb2ludHtcbiAgeD0tMVxuICB5PS0xXG4gIGNoYXI9Jy0nXG4gIHN0eWxlPXt9XG4gIGNvbnN0cnVjdG9yKHgseSxjaGFyLHN0eWxlKXtcbiAgICB0aGlzLng9eHx8LTFcbiAgICB0aGlzLnk9eXx8LTFcbiAgICB0aGlzLmNoYXI9Y2hhcnx8Jy0nXG4gICAgdGhpcy5zdHlsZT1zdHlsZXx8e31cbiAgfVxufVxuZXhwb3J0IGNsYXNzIENvZGVCdWZmZXJFZGl0b3JTZWxlY3Rpb257XG4gIHN0YXJ0PSBuZXcgQ3Vyc29yUG9pbnQoKVxuICBlbmQ9IG5ldyBDdXJzb3JQb2ludCgpXG59XG5cbmV4cG9ydCBjbGFzcyBDb2RlQnVmZmVyRWRpdG9yIHtcbiAgLyoqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aFxuICAgKiBAcGFyYW0ge3tyb3dzOm51bWJlciwgY29sczpudW1iZXJ9fSB3aW5kb3dTaXplXG4gICAqL1xuICBjb25zdHJ1Y3RvcihmaWxlUGF0aCwgd2luZG93U2l6ZSkge1xuICAgIHRoaXMuZmlsZVBhdGggICAgICAgID0gZmlsZVBhdGg7XG4gICAgdGhpcy52aWV3cG9ydFkgID0gMDtcbiAgICB0aGlzLnZpZXdwb3J0WCAgPSAwO1xuICAgIHRoaXMudmlld3BvcnRIZWlnaHQgICAgICA9IHdpbmRvd1NpemUucm93cztcbiAgICB0aGlzLnZpZXdwb3J0V2lkdGggICAgICA9IHdpbmRvd1NpemUuY29scztcbiAgICB0aGlzLmxpbmVzICAgICAgICAgICA9IFtdO1xuICAgIHRoaXMudG9rZW5zPVtdXG4gICAgdGhpcy50b2tlbml6ZXI9ZnVuY3Rpb24obGluZSxsaW5lTnVtYmVyKXtcbiAgICAgIHJldHVybiBsaW5lLnNwbGl0KFwiIFwiKS5mbGF0TWFwKG4gPT4gW24sJyAnXSlcbiAgICB9XG4gICAgdGhpcy5fdG91dDAwMCAgICAgICAgICAgICA9IDBcbiAgICB0aGlzLl9zYXZlZCAgICAgICAgICAgPSAnJ1xuXG4gICAgdGhpcy5zZXRGaWxlUGF0aChmaWxlUGF0aClcbiAgICAvKipcbiAgICAgKlxuICAgICAqIEB0eXBlIHtDdXJzb3JQb2ludFtdfVxuICAgICAqL1xuICAgIHRoaXMuY3Vyc29ycz1bXVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge0NvZGVCdWZmZXJFZGl0b3JTZWxlY3Rpb25bXX1cbiAgICAgKi9cbiAgICB0aGlzLnNlbGVjdGlvbnM9W11cbiAgfVxuICBzZXRGaWxlUGF0aChmaWxlUGF0aCl7XG4gICAgY29uc3QgcHMgPSB0aGlzLmZpbGVQYXRoLnNwbGl0KCcuJylcbiAgICB0aGlzLnRva2VuaXplciA9IGdldE5hbWVkVG9rZW5pemVyKHBzW3BzLmxlbmd0aC0xXSlcbiAgICB0aGlzLmZpbGVQYXRoICAgICAgICA9IGZpbGVQYXRoO1xuICAgIHRoaXMubGluZXM9ZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLHtlbmNvZGluZzondXRmLTgnfSkuc3BsaXQoJ1xcbicpXG4gICAgdGhpcy51cGRhdGVUb2tlbnMoKVxuICB9XG4gIHNhdmUoKXtcbiAgICBjbGVhclRpbWVvdXQodGhpcy5fdG91dDAwMClcbiAgICB0aGlzLl90b3V0MDAwID0gc2V0VGltZW91dCgoKT0+e1xuICAgICAgZnMud3JpdGVGaWxlU3luYyh0aGlzLmZpbGVQYXRoLHRoaXMubGluZXMuam9pbignXFxuJykpXG4gICAgICB0aGlzLl9zYXZlZCA9IGBzYXZlZCAke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1gXG4gICAgfSwxMDAwKVxuICB9XG5cbiAgLy8g4pSA4pSAIHByaXZhdGUg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgc2Nyb2xsVmlld3BvcnQobikge1xuICAgIGxldCBuZXh0WT10aGlzLnZpZXdwb3J0WStuXG4gICAgbGV0IG1heFkgPSB0aGlzLmxpbmVzLmxlbmd0aCAtIDFcbiAgICBpZiAobmV4dFkgPCAwKSB7XG4gICAgICB0aGlzLnZpZXdwb3J0WT0wO1xuICAgIH0gZWxzZSBpZiAoIChuZXh0WSArdGhpcy52aWV3cG9ydEhlaWdodCkgID4gbWF4WSkge1xuICAgICAgdGhpcy52aWV3cG9ydFk9bWF4WS10aGlzLnZpZXdwb3J0SGVpZ2h0O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnZpZXdwb3J0WSA9IG5leHRZXG4gICAgfVxuICB9XG4gIF9lbnN1cmVDdXJzb3JJblZpZXcoY3Vyc29yKSB7XG4gICAgaWYgKGN1cnNvci55IDwgdGhpcy52aWV3cG9ydFkpIHtcbiAgICAgIHRoaXMudmlld3BvcnRZID0gY3Vyc29yLnk7XG4gICAgfSBlbHNlIGlmIChjdXJzb3IueSA+PSAodGhpcy52aWV3cG9ydFkgKyB0aGlzLnZpZXdwb3J0SGVpZ2h0KSkge1xuICAgICAgdGhpcy52aWV3cG9ydFkgPSBjdXJzb3IueSAtIHRoaXMudmlld3BvcnRIZWlnaHQ7XG4gICAgfVxuICAgIGlmIChjdXJzb3IueCA8IHRoaXMudmlld3BvcnRYKSB7XG4gICAgICB0aGlzLnZpZXdwb3J0WCA9IGN1cnNvci54O1xuICAgIH0gZWxzZSBpZiAoY3Vyc29yLnggPj0gdGhpcy52aWV3cG9ydFggKyB0aGlzLnZpZXdwb3J0V2lkdGgpIHtcbiAgICAgIHRoaXMudmlld3BvcnRYID0gY3Vyc29yLnggLSB0aGlzLnZpZXdwb3J0V2lkdGg7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSBsaW5lTnVtYmVyXG4gICAqL1xuICB1cGRhdGVUb2tlbnNMaW5lKGxpbmVOdW1iZXIpe1xuICAgIHRoaXMudG9rZW5zW2xpbmVOdW1iZXJdPXRoaXMudG9rZW5pemVyKHRoaXMubGluZXNbbGluZU51bWJlcl0sIGxpbmVOdW1iZXIpXG4gIH1cbiAgLyoqXG4gICAqXG4gICAqL1xuICB1cGRhdGVUb2tlbnMoKXtcbiAgICB0aGlzLnRva2Vucz10aGlzLmxpbmVzLm1hcCgobGluZSxsaW5lTnVtYmVyKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy50b2tlbml6ZXIobGluZSwgbGluZU51bWJlcilcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0geFxuICAgKiBAcGFyYW0geVxuICAgKiBAcmV0dXJucyB7Q3Vyc29yUG9pbnR9XG4gICAqL1xuICBnZXRDdXJzb3Ioe3gseX0pe1xuICAgIGxldCBjcnMgPSBuZXcgQ3Vyc29yUG9pbnQoKVxuICAgIC8vIGNsYW1wIHgseVxuICAgIHk9eTwwPzA6KHk+KHRoaXMubGluZXMubGVuZ3RoLTEpPyh0aGlzLmxpbmVzLmxlbmd0aC0xKTp5KVxuICAgIGNvbnN0IGxpbmU9dGhpcy5saW5lc1t5XVxuICAgIHg9eDwwPzA6KHg+KGxpbmUubGVuZ3RoKT8obGluZS5sZW5ndGgpOngpXG4gICAgY3JzLng9eFxuICAgIGNycy55PXlcblxuICAgIGNvbnN0IGxpbmVOdW1iZXI9cGFyc2VJbnQoeSlcblxuICAgIGxldCB0b2tlbnM9bnVsbFxuICAgIHRyeSB7XG4gICAgICB0b2tlbnMgPSB0aGlzLnRva2VuaXplcihsaW5lLGxpbmVOdW1iZXIpXG4gICAgfWNhdGNoKGVycil7XG4gICAgICB0b2tlbnMgPSB0aGlzLnRva2Vuc1t5XVxuICAgIH1cblxuICAgIC8vIDMpIHNjYW4gdG9rZW5zIHRvIGZpbmQgd2hpY2ggb25lIGNvdmVycyBjb2xJbldpbmRvd1xuICAgIGxldCBjb2wgPSAwO1xuICAgIGNycy5jaGFyID0gdGhpcy5saW5lc1t5XVt4XXx8JyAnXG4gICAgZm9yIChjb25zdCB0b2sgb2YgdG9rZW5zKSB7XG4gICAgICBpZiggeCA+PSB0b2suc3RhcnQgJiYgeCA8IHRvay5lbmQpIHtcbiAgICAgICAgY3JzLnN0eWxlID0gdG9rLnN0eWxlO1xuICAgICAgICBicmVha1xuICAgICAgfVxuICAgICAgY29sICs9IHRvay50ZXh0Lmxlbmd0aDtcbiAgICB9XG5cbiAgICAvLyA0KSBmYWxsYmFjayB0byBsYXN0IHRva2Vu4oCZcyBzdHlsZSAoZS5nLiBwYXN0IEVPTClcbiAgICBpZihjcnMuc3R5bGUpe1xuICAgICAgY29uc3QgbGFzdCA9IHRva2Vucy5zbGljZSgtMSlbMF07XG4gICAgICBjcnMuc3R5bGUgPSBsYXN0ID8gbGFzdC5zdHlsZSA6IHt9O1xuICAgIH1cbiAgICByZXR1cm4gY3JzXG4gIH1cbiAgLyoqXG4gICogQHBhcmFtIHsoY29kZTpzdHJpbmcpPT5Ub2tlbml6ZXJUb2tlbltdfSB0b2tlbml6ZXJcbiAgKiBAcmV0dXJucyB7e1tsaW5lTnVtYmVyOnN0cmluZ106VG9rZW5pemVyVG9rZW5bXX19XG4gICpcbiAgKiAqL1xuICByZW5kZXJWaWV3cG9ydCgpIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy50b2tlbnMpLnJlZHVjZShcbiAgICAgICh2aXNpYmxlLGxpbmVJZCkgPT4ge1xuICAgICAgICBjb25zdCBsaW5lTnVtYmVyPXBhcnNlSW50KGxpbmVJZClcbiAgICAgICAgaWYobGluZU51bWJlcj49dGhpcy52aWV3cG9ydFkgJiYgbGluZU51bWJlcjw9KHRoaXMudmlld3BvcnRZK3RoaXMudmlld3BvcnRIZWlnaHQpKXtcbiAgICAgICAgICB2aXNpYmxlW2xpbmVJZF09dGhpcy50b2tlbnNbbGluZUlkXVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB2aXNpYmxlXG4gICAgICB9LFxuICAgICAge31cbiAgICApXG4gIH1cblxuICBvbk1vdXNlKHNjcmVlbkV2ZW50LHZpZXdwb3J0UG9zaXRpb24pe1xuICAgIGNvbnN0IFRISVMgPSB0aGlzXG4gICAgbGV0IGhhc0NoYW5nZWQ9ZmFsc2VcbiAgICBsZXQgbXVzdFJlbmRlcj1mYWxzZVxuICAgIGNvbnN0IGNsaWNrcyA9IEFycmF5LmZyb20oc2NyZWVuRXZlbnQuYnVmfHxbXSkuZmlsdGVyKHYgPT4gdiA9PT0gNzcpLmxlbmd0aFxuICAgIHN3aXRjaChzY3JlZW5FdmVudC5hY3Rpb24pe1xuICAgICAgY2FzZSAnbW91c2Vtb3ZlJzpicmVhaztcbiAgICAgIGNhc2UgJ21vdXNlZG93bic6XG4gICAgICAgIGNvbnN0IHBhZExlbmd0aD1NYXRoLmNlaWwoTWF0aC5sb2cxMCh0aGlzLnZpZXdwb3J0SGVpZ2h0K3RoaXMudmlld3BvcnRZKSkrMVxuICAgICAgICBjb25zdCB7eGkseWl9ID0gdmlld3BvcnRQb3NpdGlvbjtcbiAgICAgICAgY29uc3Qge3gseX0gPSBzY3JlZW5FdmVudDtcbiAgICAgICAgY29uc3QgY3Vyc29yPSB7eDooeC14aSAtIHBhZExlbmd0aCAtIDEgLSAxIC0gMSArIHRoaXMudmlld3BvcnRYKSwgeTooeS15aSAtIDEgKyB0aGlzLnZpZXdwb3J0WSl9XG4gICAgICAgIGNvbnN0IGNycz10aGlzLmdldEN1cnNvcihjdXJzb3IpXG4gICAgICAgIGlmKHNjcmVlbkV2ZW50Lm1ldGEpe1xuICAgICAgICAgIHRoaXMuY3Vyc29ycy5wdXNoKGNycylcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgdGhpcy5jdXJzb3JzPVtjcnNdXG4gICAgICAgIH1cbiAgICAgICAgaGFzQ2hhbmdlZD10cnVlXG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnbW91c2V1cCc6XG5cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd3aGVlbHVwJzpcbiAgICAgICAgdGhpcy5zY3JvbGxWaWV3cG9ydCgtY2xpY2tzKVxuICAgICAgICBtdXN0UmVuZGVyPXRydWVcbiAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnd2hlZWxkb3duJzpcbiAgICAgICAgdGhpcy5zY3JvbGxWaWV3cG9ydChjbGlja3MpXG4gICAgICAgIG11c3RSZW5kZXI9dHJ1ZVxuICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OiB0aHJvdyBuZXcgRXJyb3Ioc2FmZVN0cmluZ2lmeShzY3JlZW5FdmVudCkpOyBicmVhaztcbiAgICB9XG4gICAgcmV0dXJuIFtoYXNDaGFuZ2VkLG11c3RSZW5kZXJdXG4gIH1cbiAgb25LZXkoY2gsa2V5LG9uQ2hhbmdlPSgpPT57fSl7XG4gIGNvbnN0IFRISVMgPSB0aGlzXG4gIGxldCBoYXNDaGFuZ2VkPWZhbHNlXG4gICAgc3dpdGNoIChrZXkubmFtZSkge1xuICAgICAgY2FzZSAndXAnOlxuICAgICAgICB0aGlzLmN1cnNvcnM9dGhpcy5jdXJzb3JzLm1hcChjcnMgPT4gVEhJUy5tb3ZlQ3Vyc29yVXAoY3JzKSk7XG4gICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2Rvd24nOlxuICAgICAgICB0aGlzLmN1cnNvcnM9dGhpcy5jdXJzb3JzLm1hcChjcnMgPT4gVEhJUy5tb3ZlQ3Vyc29yRG93bihjcnMpKTtcbiAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnbGVmdCc6XG4gICAgICAgIHRoaXMuY3Vyc29ycz10aGlzLmN1cnNvcnMubWFwKGNycyA9PiBUSElTLm1vdmVDdXJzb3JMZWZ0KGNycykpO1xuICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdyaWdodCc6XG4gICAgICAgIHRoaXMuY3Vyc29ycz10aGlzLmN1cnNvcnMubWFwKGNycyA9PiBUSElTLm1vdmVDdXJzb3JSaWdodChjcnMpKTtcbiAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnaG9tZSc6XG4gICAgICAgIHRoaXMuY3Vyc29ycz10aGlzLmN1cnNvcnMubWFwKGNycyA9PiBUSElTLmdldEN1cnNvcih7eDowLHk6Y3JzLnl9KSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZW5kJzpcbiAgICAgICAgdGhpcy5jdXJzb3JzPXRoaXMuY3Vyc29ycy5tYXAoY3JzID0+IFRISVMuZ2V0Q3Vyc29yKHt4OnRoaXMubGluZXNbY3JzLnldLmxlbmd0aCx5OmNycy55fSkpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3BhZ2V1cCc6XG4gICAgICAgIHRoaXMuc2Nyb2xsVmlld3BvcnQoLXRoaXMudmlld3BvcnRIZWlnaHQpO1xuICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdwYWdlZG93bic6XG4gICAgICAgIHRoaXMuc2Nyb2xsVmlld3BvcnQodGhpcy52aWV3cG9ydEhlaWdodCk7XG4gICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2JhY2tzcGFjZSc6XG4gICAgICAgIHRoaXMuY3Vyc29ycy5mb3JFYWNoKGNycyA9PiBUSElTLmJhY2tzcGFjZShjcnMpKVxuICAgICAgICB0aGlzLnNhdmUoKTtcbiAgICAgICAgaGFzQ2hhbmdlZD10cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICAgIHRoaXMuY3Vyc29ycy5mb3JFYWNoKGNycyA9PiBUSElTLmRlbGV0ZShjcnMpKVxuICAgICAgICB0aGlzLnNhdmUoKTtcbiAgICAgICAgaGFzQ2hhbmdlZD10cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3JldHVybic6XG4gICAgICAgIHRoaXMuY3Vyc29yc1xuICAgICAgICAgICAgLnRvU29ydGVkKChhLGIpID0+IChhLnktYi55KSlcbiAgICAgICAgICAgIC5mb3JFYWNoKChjcnMseSkgPT4ge1xuICAgICAgICAgICAgICBjcnMueSs9eVxuICAgICAgICAgICAgICBUSElTLmluc2VydChcIlxcblwiLCBjcnMpXG4gICAgICAgICAgICAgIGNycy55Kz0xXG4gICAgICAgICAgICAgIGNycy54PTBcbiAgICAgICAgICAgIH0pXG4gICAgICAgIHRoaXMuc2F2ZSgpO1xuICAgICAgICBoYXNDaGFuZ2VkPXRydWU7XG4gICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3RhYic6XG4gICAgICAgIHRoaXMuY3Vyc29yc1xuICAgICAgICAgICAgLnRvU29ydGVkKChhLGIpID0+IChhLnktYi55KSlcbiAgICAgICAgICAgIC5mb3JFYWNoKChjcnMseSkgPT4ge1xuICAgICAgICAgICAgICBUSElTLmluc2VydChcIlxcdFwiLCBjcnMpXG4gICAgICAgICAgICB9KVxuICAgICAgICB0aGlzLnNhdmUoKTtcbiAgICAgICAgaGFzQ2hhbmdlZD10cnVlO1xuICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAoY2ggJiYgY2gubGVuZ3RoID4gMCAmJiAha2V5LmN0cmwgJiYgIWtleS5tZXRhKXtcbiAgICAgICAgICBpZihrZXkuc2VxdWVuY2UgJiYga2V5LnNlcXVlbmNlLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgICAgdGhpcy5jdXJzb3JzLmZvckVhY2goY3JzID0+IFRISVMuaW5zZXJ0KGtleS5zZXF1ZW5jZSxjcnMpKVxuICAgICAgICAgICAgdGhpcy5zYXZlKCk7XG4gICAgICAgICAgICBoYXNDaGFuZ2VkPXRydWU7XG4gICAgICAgICAgfSBlbHNlIGlmKGtleS5uYW1lICYmIGtleS5uYW1lLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgICAgdGhpcy5jdXJzb3JzLmZvckVhY2goY3JzID0+IFRISVMuaW5zZXJ0KGtleS5uYW1lLGNycykpXG4gICAgICAgICAgICB0aGlzLnNhdmUoKTtcbiAgICAgICAgICAgIGhhc0NoYW5nZWQ9dHJ1ZTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5jdXJzb3JzLmZvckVhY2goY3JzID0+IFRISVMuaW5zZXJ0KGNoLGNycykpXG4gICAgICAgICAgICBoYXNDaGFuZ2VkPXRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBoYXNDaGFuZ2VkXG4gIH1cblxuICAvKipcbiAgICpcbiAgICogQHBhcmFtIHtDdXJzb3JQb2ludH0gY3Vyc29yXG4gICAqIEByZXR1cm5zIHtDdXJzb3JQb2ludH1cbiAgICovXG4gIG1vdmVDdXJzb3JVcChjdXJzb3IpIHtcbiAgICBpZiAoY3Vyc29yLnkgPiAwKSB7XG4gICAgICBjdXJzb3IueS0tO1xuICAgICAgY29uc3QgbGluZSA9IHRoaXMubGluZXNbY3Vyc29yLnldXG4gICAgICBpZiAoY3Vyc29yLnggPj0gbGluZS5sZW5ndGgpIHtcbiAgICAgICAgY3Vyc29yLnggPSBsaW5lLmxlbmd0aFxuICAgICAgfVxuICAgICAgdGhpcy5fZW5zdXJlQ3Vyc29ySW5WaWV3KGN1cnNvcik7XG4gICAgfVxuICAgIHJldHVybiBjdXJzb3JcbiAgfVxuXG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0ge0N1cnNvclBvaW50fSBjdXJzb3JcbiAgICogQHJldHVybnMge0N1cnNvclBvaW50fVxuICAgKi9cbiAgbW92ZUN1cnNvckRvd24oY3Vyc29yKSB7XG4gICAgaWYgKChjdXJzb3IueSsxKSA8IHRoaXMubGluZXMubGVuZ3RoKSB7XG4gICAgICBpZiAoY3Vyc29yLnggPj0gdGhpcy5saW5lc1tjdXJzb3IueSsxXS5sZW5ndGgpIHtcbiAgICAgICAgY3Vyc29yLnggPSB0aGlzLmxpbmVzW2N1cnNvci55KzFdLmxlbmd0aFxuICAgICAgfVxuICAgICAgY3Vyc29yLnkrKztcbiAgICAgIHRoaXMuX2Vuc3VyZUN1cnNvckluVmlldyhjdXJzb3IpO1xuICAgIH1cbiAgICByZXR1cm4gY3Vyc29yXG4gIH1cblxuICAvKipcbiAgICpcbiAgICogQHBhcmFtIHtDdXJzb3JQb2ludH0gY3Vyc29yXG4gICAqIEByZXR1cm5zIHtDdXJzb3JQb2ludH1cbiAgICovXG4gIG1vdmVDdXJzb3JMZWZ0KGN1cnNvcikge1xuICAgIGlmIChjdXJzb3IueCA+IDApIHtcbiAgICAgIGN1cnNvci54LS07XG4gICAgICB0aGlzLl9lbnN1cmVDdXJzb3JJblZpZXcoY3Vyc29yKTtcbiAgICB9XG4gICAgcmV0dXJuIGN1cnNvclxuICB9XG5cbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSB7Q3Vyc29yUG9pbnR9IGN1cnNvclxuICAgKiBAcmV0dXJucyB7Q3Vyc29yUG9pbnR9XG4gICAqL1xuICBtb3ZlQ3Vyc29yUmlnaHQoY3Vyc29yKSB7XG4gICAgY29uc3QgbGluZSA9IHRoaXMubGluZXNbY3Vyc29yLnldXG4gICAgaWYgKGN1cnNvci54IDwgbGluZS5sZW5ndGgpIHtcbiAgICAgIGN1cnNvci54KytcbiAgICB9IGVsc2Uge1xuICAgICAgY3Vyc29yLnggPSBsaW5lLmxlbmd0aFxuICAgIH1cbiAgICB0aGlzLl9lbnN1cmVDdXJzb3JJblZpZXcoY3Vyc29yKVxuICAgIHJldHVybiBjdXJzb3JcbiAgfVxuXG4gIG1vdmVDdXJzb3JWZXJ0aWNhbGx5KG4sY3Vyc29yKXtcbiAgICBpZihuPjApe1xuICAgICAgICBmb3IobGV0IGk9MDtpPG47aSsrKXtcbiAgICAgICAgICAgIHRoaXMubW92ZUN1cnNvckRvd24oY3Vyc29yKVxuICAgICAgICB9XG4gICAgfWVsc2UgaWYobjwwKXtcbiAgICAgICAgZm9yKGxldCBpPW47aTw9MDtpKyspe1xuICAgICAgICAgICAgdGhpcy5tb3ZlQ3Vyc29yVXAoY3Vyc29yKVxuICAgICAgICB9XG4gICAgfVxuICB9XG4gIG1vdmVDdXJzb3JIb3Jpem9udGFsbHkobixjdXJzb3Ipe1xuICAgIGlmKG4+MCl7XG4gICAgICAgIGZvcihsZXQgaT0wO2k8bjtpKyspe1xuICAgICAgICAgICAgdGhpcy5tb3ZlQ3Vyc29yUmlnaHQoY3Vyc29yKVxuICAgICAgICB9XG4gICAgfWVsc2UgaWYobjwwKXtcbiAgICAgICAgZm9yKGxldCBpPW47aTw9MDtpKyspe1xuICAgICAgICAgICAgdGhpcy5tb3ZlQ3Vyc29yTGVmdChjdXJzb3IpXG4gICAgICAgIH1cbiAgICB9XG4gIH1cbiAgLy8g4pSA4pSAIGVkaXRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gIGluc2VydCh0ZXh0LGN1cnNvcikge1xuICAgIGNvbnN0IG9sZExpbmU9dGhpcy5saW5lc1tjdXJzb3IueV1cbiAgICBjb25zdCBiZWZvcmU9b2xkTGluZS5zdWJzdHJpbmcoMCxjdXJzb3IueClcbiAgICBjb25zdCBhZnRlcj1vbGRMaW5lLnN1YnN0cmluZyhjdXJzb3IueClcbiAgICBjb25zdCBuZXdMaW5lPWJlZm9yZSt0ZXh0K2FmdGVyXG4gICAgbGV0IG5ld0xpbmVzPXRoaXMubGluZXMuc2xpY2UoMCxjdXJzb3IueSlcbiAgICBsZXQgb2xkTGluZXNBZnRlcj10aGlzLmxpbmVzLnNsaWNlKGN1cnNvci55KzEpXG4gICAgdGhpcy5saW5lcz1uZXdMaW5lcy5jb25jYXQobmV3TGluZS5zcGxpdCgnXFxuJykpLmNvbmNhdChvbGRMaW5lc0FmdGVyKVxuICAgIGlmKG5ld0xpbmUuaW5kZXhPZihcIlxcblwiKT4tMSl7XG4gICAgICB0aGlzLnVwZGF0ZVRva2VucygpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudXBkYXRlVG9rZW5zTGluZShjdXJzb3IueSlcbiAgICB9XG4gICAgY3Vyc29yLngrK1xuICAgIHRoaXMuX2Vuc3VyZUN1cnNvckluVmlldyhjdXJzb3IpO1xuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBkZWxldGUoY3Vyc29yKSB7XG4gICAgaWYoY3Vyc29yLng9PT10aGlzLmxpbmVzW2N1cnNvci55XS5sZW5ndGgpe1xuICAgICAgbGV0IG5ld0xpbmVzPXRoaXMubGluZXMuc2xpY2UoMCxjdXJzb3IueSlcbiAgICAgIGxldCBjdXJyZW50TGluZT10aGlzLmxpbmVzW2N1cnNvci55XVxuICAgICAgY29uc3QgbmV4dExpbmU9dGhpcy5saW5lc1tjdXJzb3IueSsxXVxuICAgICAgbGV0IHJlc3RMaW5lcz10aGlzLmxpbmVzLnNsaWNlKGN1cnNvci55KzIpXG4gICAgICB0aGlzLmxpbmVzPW5ld0xpbmVzLmNvbmNhdChbY3VycmVudExpbmUrbmV4dExpbmVdKS5jb25jYXQocmVzdExpbmVzKVxuICAgICAgdGhpcy51cGRhdGVUb2tlbnMoKVxuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgbmV3TGluZXM9dGhpcy5saW5lcy5zbGljZSgwLGN1cnNvci55KVxuICAgICAgY29uc3Qgb2xkTGluZT10aGlzLmxpbmVzW2N1cnNvci55XVxuICAgICAgY29uc3QgYmVmb3JlPW9sZExpbmUuc3Vic3RyaW5nKDAsY3Vyc29yLngpXG4gICAgICBjb25zdCBhZnRlcj1vbGRMaW5lLnN1YnN0cmluZyhjdXJzb3IueCsxKVxuICAgICAgY29uc3QgbmV3TGluZT1iZWZvcmUrYWZ0ZXJcbiAgICAgIGxldCBvbGRMaW5lc0FmdGVyPXRoaXMubGluZXMuc2xpY2UoY3Vyc29yLnkrMSlcbiAgICAgIHRoaXMubGluZXM9bmV3TGluZXMuY29uY2F0KG5ld0xpbmUuc3BsaXQoJ1xcbicpKS5jb25jYXQob2xkTGluZXNBZnRlcilcbiAgICAgIHRoaXMudXBkYXRlVG9rZW5zTGluZShjdXJzb3IueSlcbiAgICB9XG4gICAgdGhpcy5fZW5zdXJlQ3Vyc29ySW5WaWV3KGN1cnNvcik7XG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIGJhY2tzcGFjZShjdXJzb3IpIHtcbiAgICBpZiAoY3Vyc29yLng+MCkge1xuICAgICAgY3Vyc29yLngtLTtcbiAgICAgIHRoaXMuZGVsZXRlKGN1cnNvcilcbiAgICB9IGVsc2UgaWYgKGN1cnNvci55PjApIHtcbiAgICAgIGNvbnN0IG5ld0NvbD10aGlzLmxpbmVzW2N1cnNvci55LTFdLmxlbmd0aFxuICAgICAgY3Vyc29yLnktLTtcbiAgICAgIGN1cnNvci54ID0gbmV3Q29sOyAvLyB3aWxsIGNsYW1wIGFmdGVyIHJlYWRpbmcgZnVsbCBsaW5lIG5leHQgdGltZVxuICAgICAgdGhpcy5kZWxldGUoY3Vyc29yKVxuICAgICAgdGhpcy51cGRhdGVUb2tlbnNMaW5lKGN1cnNvci55KVxuICAgIH1cbiAgICB0aGlzLl9lbnN1cmVDdXJzb3JJblZpZXcoY3Vyc29yKTtcbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLy8g4pSA4pSAIGNsb25lIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gIC8qKiByZXR1cm4gYSBuZXcgaW5zdGFuY2Ugd2l0aCBpZGVudGljYWwgc3RhdGUgKi9cbiAgY29weSgpIHtcbiAgICBjb25zdCBjbG9uZSA9IG5ldyBDb2RlQnVmZmVyRWRpdG9yKHRoaXMuZmlsZVBhdGgsIHtcbiAgICAgIHJvd3M6IHRoaXMudmlld3BvcnRIZWlnaHQsXG4gICAgICBjb2xzOiB0aGlzLnZpZXdwb3J0V2lkdGhcbiAgICB9KTtcbiAgICBjbG9uZS5maWxlUGF0aD10aGlzLmZpbGVQYXRoXG4gICAgY2xvbmUudmlld3BvcnRZPXRoaXMudmlld3BvcnRZXG4gICAgY2xvbmUudmlld3BvcnRYPXRoaXMudmlld3BvcnRYXG4gICAgY2xvbmUubGluZXM9dGhpcy5saW5lc1xuICAgIGNsb25lLmN1cnNvcnM9dGhpcy5jdXJzb3JzXG4gICAgY2xvbmUudG9rZW5zPXRoaXMudG9rZW5zXG4gICAgY2xvbmUudG9rZW5pemVyPXRoaXMudG9rZW5pemVyXG4gICAgY2xvbmUuc2VsZWN0aW9ucz10aGlzLnNlbGVjdGlvbnNcbiAgICBjbG9uZS5fc2F2ZWQ9dGhpcy5fc2F2ZWRcbiAgICByZXR1cm4gY2xvbmU7XG4gIH1cbiAgZ2V0U3RhdHVzKCl7XG4gICAgY29uc3QgcmFuZ2U9T2JqZWN0LmtleXModGhpcy5yZW5kZXJWaWV3cG9ydCgpKVxuICAgIGNvbnN0IGpzb249e1xuICAgICAgY3Vyc29yOnRoaXMuY3Vyc29ycyxcbiAgICAgIHY6e3g6dGhpcy52aWV3cG9ydFgseTp0aGlzLnZpZXdwb3J0WSx3OnRoaXMudmlld3BvcnRXaWR0aCxoOnRoaXMudmlld3BvcnRIZWlnaHR9LFxuICAgICAgczp0aGlzLl9zYXZlZCxcbiAgICAgIGw6cmFuZ2VbMF0rJyAuLi4gJytyYW5nZVtyYW5nZS5sZW5ndGgtMV1cbiAgICB9XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGpzb24pLnJlcGxhY2UoL1wiL2dpLCcnKVxuICB9XG59IiwiaW1wb3J0IFJlYWN0LCB7dXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlfSBmcm9tICdyZWFjdCc7XG5pbXBvcnQge0NvZGVCdWZmZXJFZGl0b3IsIEN1cnNvclBvaW50fSBmcm9tICcuL0NvZGVCdWZmZXJFZGl0b3IuanMnO1xuaW1wb3J0IHsgQm94RWxlbWVudCBhcyBib3gsIFRleHRFbGVtZW50IGFzIHRleHQgfSBmcm9tICdyZWFjdC1ibGVzc2VkJztcbmltcG9ydCB7c2FmZVN0cmluZ2lmeX0gZnJvbSBcIi4vdXRpbFwiO1xuXG5cbmV4cG9ydCBmdW5jdGlvbiBDb2RlQnVmZmVyRWRpdG9yQ29tcG9uZW50KHtcbiAgICBmaWxlUGF0aCxcbiAgICBvbktleXByZXNzPShjaCxrZXkpID0+e30sXG4gICAgb25DaGFuZ2UgPSAoe2VkaXRvcixjaCxrZXksc2NyZWVuRXZlbnQsdmlld3BvcnR9KSA9PiB7fSxcbiAgICBvbkV2ZW50ID0gKHtlZGl0b3IsY2gsa2V5LHNjcmVlbkV2ZW50LHZpZXdwb3J0fSkgPT4ge30sXG4gICAgLi4uYm94UHJvcHNcbn0pIHtcbiAgY29uc3QgYm94UmVmID0gdXNlUmVmKCk7XG4gIC8qKlxuICAgKiBAY29uc3RhbnQge1tDb2RlQnVmZmVyRWRpdG9yLChlZDpDb2RlQnVmZmVyRWRpdG9yKT0+dm9pZF19IFtlZGl0b3IsIHNldEVkaXRvcl1cbiAgICovXG5cblx0XG4gIGNvbnN0IFtlZGl0b3IsIHNldEVkaXRvcl0gPSB1c2VTdGF0ZShudWxsKTtcbiAgY29uc3QgW3NpemUsIHNldFNpemVdICAgICA9IHVzZVN0YXRlKHsgcm93czogMTAsIGNvbHM6IDMwIH0pO1xuICBjb25zdFtsYXN0RXZlbnQsc2V0TGFzdEV2ZW50XSA9IHVzZVN0YXRlKHtlZGl0b3I6bnVsbCxjaDpudWxsLGtleTpudWxsLHNjcmVlbkV2ZW50Om51bGwsdmlld3BvcnQ6bnVsbH0pXG5cblxuICAvLyAxKSAoUmUpY3JlYXRlIGVkaXRvciB3aGVuZXZlciBmaWxlUGF0aCBjaGFuZ2VzXG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgaWYgKGZpbGVQYXRoKSB7XG4gICAgICBjb25zdCBlZCA9IG5ldyBDb2RlQnVmZmVyRWRpdG9yKGZpbGVQYXRoLCB7IHJvd3M6IHNpemUucm93cywgY29sczogc2l6ZS5jb2xzIH0pO1xuICAgICAgLy8gaW1tZWRpYXRlbHkgcmVuZGVyIHRoZSBuZXcgZmlsZVxuICAgICAgZWQudmlld3BvcnRIZWlnaHQgPSBzaXplLnJvd3MtMTtcbiAgICAgIGVkLnZpZXdwb3J0V2lkdGggPSBzaXplLmNvbHM7XG4gICAgICBzZXRFZGl0b3IoZWQpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzZXRFZGl0b3IobnVsbCk7XG4gICAgfVxuICB9LCBbZmlsZVBhdGhdKTtcblxuICAvLyAyKSB1cGRhdGUgc2l6ZSBvbiByZXNpemVcbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBib3ggPSBib3hSZWYuY3VycmVudDtcbiAgICBpZiAoIWJveCkgcmV0dXJuO1xuICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IHtcbiAgICAgIHNldFNpemUoeyBjb2xzOiBib3gud2lkdGgsIHJvd3M6IGJveC5oZWlnaHQtMiB9KTtcbiAgICB9O1xuICAgIHVwZGF0ZSgpO1xuICAgIGJveC5vbigncmVzaXplJywgdXBkYXRlKTtcbiAgICByZXR1cm4gKCkgPT4gYm94LnJlbW92ZUxpc3RlbmVyKCdyZXNpemUnLCB1cGRhdGUpO1xuICB9LCBbXSk7XG5cbiAgLy8gcnVuIG9uY2Ugb24gc2l6ZSBjaGFuZ2VcbiAgdXNlRWZmZWN0KCgpPT57XG4gICAgaWYoZWRpdG9yKXtcbiAgICAgIGVkaXRvci52aWV3cG9ydFdpZHRoID0gc2l6ZS5jb2xzO1xuICAgICAgZWRpdG9yLnZpZXdwb3J0SGVpZ2h0ID0gc2l6ZS5yb3dzO1xuICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgfVxuICB9LCBbc2l6ZV0pO1xuICBjb25zdCBjdXJzb3JzID0gKCk9PntcbiAgICBpZighZWRpdG9yKXtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICA8Ym94IGtleT17YDAtMS1uby1maWxlYH1cbiAgICAgICAgICAgIGxlZnQ9ezR9IHRvcD17MX0gd2lkdGg9ezF9IGhlaWdodD17MX1cbiAgICAgICAgICAgIHN0eWxlPXt7Ymxpbms6dHJ1ZX19XG4gICAgICAgICAgICBjb250ZW50PXsnXyd9XG4gICAgICAgICAgLz5cbiAgICAgICAgKVxuICAgIH1cbiAgICBjb25zdCBwYWRMZW5ndGg9TWF0aC5jZWlsKE1hdGgubG9nMTAoZWRpdG9yLnZpZXdwb3J0SGVpZ2h0K2VkaXRvci52aWV3cG9ydFkpKSsxXG5cbiAgICByZXR1cm4gWy4uLmVkaXRvci5jdXJzb3JzXVxuICAgICAgICAuZmlsdGVyKChjdXJzb3IseSk9PntcbiAgICAgICAgICByZXR1cm4gY3Vyc29yLnk+PWVkaXRvci52aWV3cG9ydFkgJiYgY3Vyc29yLnkgPD0gKGVkaXRvci52aWV3cG9ydFkrZWRpdG9yLnZpZXdwb3J0SGVpZ2h0KVxuICAgICAgICB9KVxuICAgICAgICAubWFwKChjcnMsaWQpPT57XG4gICAgICAgICAgY29uc3QgY3Vyc29yID0gZWRpdG9yLmdldEN1cnNvcih7Li4uY3JzfSlcbiAgICAgICAgICByZXR1cm4gPGJveCBrZXk9e2BjdXJzb3ItJHtpZH0tJHtEYXRlLm5vdygpfWB9XG4gICAgICAgICAgICAgIGxlZnQ9e2N1cnNvci54LWVkaXRvci52aWV3cG9ydFgrcGFkTGVuZ3RoKzErIDF9IHRvcD17Y3Vyc29yLnktZWRpdG9yLnZpZXdwb3J0WX0gd2lkdGg9ezF9IGhlaWdodD17MX1cbiAgICAgICAgICAgICAgc3R5bGU9e3suLi5jdXJzb3Iuc3R5bGUsdW5kZXJsaW5lOiB0cnVlLGJvbGQ6dHJ1ZSxpbnZlcnNlOnRydWV9fVxuICAgICAgICAgICAgICB0YWdzPXtmYWxzZX1cbiAgICAgICAgICAgICAgY29udGVudD17Y3Vyc29yLmNoYXJ9XG4gICAgICAgICAgLz5cbiAgICAgICAgfSlcblxuICB9XG5cbiAgY29uc3QgdG9rZW5MaXN0ID0gKCk9PntcbiAgICBpZighZWRpdG9yKXtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICA8Ym94IGtleT17YDAtMC1uby1maWxlYH0gXG4gICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgbGVmdD17KHNpemUuY29scz4+MSkgLSA4fSB0b3A9eyhzaXplLnJvd3M+PjEpLTF9IHdpZHRoPXsxNn0gaGVpZ2h0PXszfSBcbiAgICAgICAgICAgIHN0eWxlPXt7Ymc6JyNlZWVlMDAnLGZnOicjMTExMTExJ319XG4gICAgICAgICAgICBjb250ZW50PXsnXFxuIE5vIEZpbGUgTG9hZGVkJ31cbiAgICAgICAgICAvPlxuICAgICAgICApXG4gICAgfVxuICAgIFxuICAgIGNvbnN0IHBhZExlbmd0aD1NYXRoLmNlaWwoTWF0aC5sb2cxMChlZGl0b3Iudmlld3BvcnRIZWlnaHQrZWRpdG9yLnZpZXdwb3J0WSkpKzFcbiAgICBjb25zdCBsaW5lcyA9IGVkaXRvci5yZW5kZXJWaWV3cG9ydCgpO1xuICAgIHJldHVybiBPYmplY3Qua2V5cyhsaW5lcykuZmxhdE1hcCgobGluZU51bWJlciwgaykgPT4ge1xuICAgICAgY29uc3QgbGluZSA9IGxpbmVzW2xpbmVOdW1iZXJdXG4gICAgICBjb25zdCBsaW5lTnVtYmVyVGV4dCA9IGAke1N0cmluZyhsaW5lTnVtYmVyKS5wYWRTdGFydChwYWRMZW5ndGgsICcgJyl9YFxuICAgICAgY29uc3QgbGluZU51bWJlckJveCA9IChcbiAgICAgICAgICA8Ym94IGtleT17YCR7bGluZU51bWJlcn0tbGluZU51bWJlci0ke0RhdGUubm93fWB9XG4gICAgICAgICAgICAgICBsZWZ0PXswfSB0b3A9e2t9IHdpZHRoPXtwYWRMZW5ndGggKyAxfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgICBzdHlsZT17e2JnOiAnIzIyMjIyMicsIGZnOiAnIzMzYWFiYicsIGludmVyc2U6IGVkaXRvci5jdXJzb3JzLm1hcChjID0+Yy55KS5pbmRleE9mKGxpbmVOdW1iZXIpPi0xfX1cbiAgICAgICAgICAgICAgIGNvbnRlbnQ9e2xpbmVOdW1iZXJUZXh0KyfilIInfVxuICAgICAgICAgIC8+KVxuICAgICAgY29uc3QgcGxhaW5MaW5lVGV4dCA9IChcbiAgICAgICAgICA8Ym94IGtleT17YGNvZGUtJHtsaW5lTnVtYmVyfS0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgICAgIGxlZnQ9e3BhZExlbmd0aCArIDEgKyAxfSB0b3A9e2t9IHdpZHRoPXtlZGl0b3IubGluZXNbbGluZU51bWJlcl0ubGVuZ3RofSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgICBzdHlsZT17e2JnOiAnIzIyMjIyMicsIGZnOiAnIzMzYWFiYicsIGludmVyc2U6IGVkaXRvci5jdXJzb3JzLm1hcChjID0+Yy55KS5pbmRleE9mKGxpbmVOdW1iZXIpPi0xfX1cbiAgICAgICAgICAgICAgIGNvbnRlbnQ9e2VkaXRvci5saW5lc1tsaW5lTnVtYmVyXX1cbiAgICAgICAgICAvPilcbiAgICAgIHJldHVybiBsaW5lLnJlZHVjZSgoYSwgdCkgPT4ge1xuICAgICAgICBhLnB1c2goXG4gICAgICAgICAgICA8Ym94IGtleT17YCR7dC54fS0ke3QueX0tJHtEYXRlLm5vdygpfWB9XG4gICAgICAgICAgICAgICAgIGxlZnQ9e3QueCArIHBhZExlbmd0aCArIDEgKyAxfSB0b3A9e3QueSAtIGVkaXRvci52aWV3cG9ydFl9IHdpZHRoPXt0LnRleHQubGVuZ3RofSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgICAgIHN0eWxlPXt0LnN0eWxlfVxuICAgICAgICAgICAgICAgICBjb250ZW50PXt0LnRleHR9XG4gICAgICAgICAgICAvPlxuICAgICAgICApXG4gICAgICAgIHJldHVybiBhXG4gICAgICB9LCBbXG4gICAgICAgIGxpbmVOdW1iZXJCb3gsXG4gICAgICAgIHBsYWluTGluZVRleHQvKixcbiAgICAgICAgPGJveFxuICAgICAgICAgIGtleT17YHRlcm1pbmF0b3ItJHtsaW5lTnVtYmVyfS0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICBsZWZ0PXtwYWRMZW5ndGggKyAxICsgbGluZS5sZW5ndGh9IHRvcD17bGluZU51bWJlciAtIGVkaXRvci52aWV3cG9ydFl9IHdpZHRoPXsxfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgc3R5bGU9e3tiZzpcIiMxMTMzMTFcIixmZzpcIiM1NTU1NTVcIn19XG4gICAgICAgICAgY29udGVudD17J8KsJ31cbiAgICAgICAgLz4qL1xuICAgICAgXSlcbiAgICB9KVxuICB9XG5cbiAgLy8gMykgT24ga2V5cHJlc3MsIHVwZGF0ZSBlZGl0b3IgdGhlbiByZS1yZW5kZXJcbiAgY29uc3QgaW50ZXJuYWxPbktleXByZXNzID0gKGNoLCBrZXkpID0+IHtcbiAgICBvbktleXByZXNzKGNoLGtleSlcbiAgICBpZihlZGl0b3IgPT0gbnVsbCB8fCBmaWxlUGF0aD09bnVsbCl7XG4gICAgICAgIHJldHVyblxuICAgIH1cbiAgICBjb25zdCBoYXNDaGFuZ2VkID0gZWRpdG9yLm9uS2V5KGNoLGtleSlcbiAgICBpZihoYXNDaGFuZ2VkKXtcbiAgICAgIGNvbnN0IG5ld0xhc3RFdmVudCA9IHsuLi5sYXN0RXZlbnQsZWRpdG9yLGNoLGtleSx2aWV3cG9ydDpib3hSZWYuY3VycmVudC5scG9zfVxuICAgICAgb25DaGFuZ2UobmV3TGFzdEV2ZW50KVxuICAgICAgc2V0TGFzdEV2ZW50KG5ld0xhc3RFdmVudClcbiAgICB9XG4gICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgLy8gcmVmcmVzaCgpO1xuICB9O1xuXG4gIGNvbnN0IG1vdXNlQWN0aW9uPShzY3JlZW5FdmVudCkgPT57XG4gICAgaWYoIWVkaXRvcil7XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgY29uc3QgW211c3RDaGFuZ2UsbXVzdFJlbmRlcl0gPSBlZGl0b3Iub25Nb3VzZShzY3JlZW5FdmVudCxib3hSZWYuY3VycmVudC5scG9zKVxuICAgIGlmKG11c3RDaGFuZ2Upe1xuICAgICAgY29uc3QgbmV3TGFzdEV2ZW50ID0gey4uLmxhc3RFdmVudCxlZGl0b3Isc2NyZWVuRXZlbnQsdmlld3BvcnQ6Ym94UmVmLmN1cnJlbnQubHBvc31cbiAgICAgIG9uQ2hhbmdlKG5ld0xhc3RFdmVudClcbiAgICAgIHNldExhc3RFdmVudChuZXdMYXN0RXZlbnQpXG4gICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICB9IGVsc2UgaWYgKG11c3RSZW5kZXIpIHtcbiAgICAgIGNvbnN0IG5ld0xhc3RFdmVudCA9IHsuLi5sYXN0RXZlbnQsZWRpdG9yLHNjcmVlbkV2ZW50LHZpZXdwb3J0OmJveFJlZi5jdXJyZW50Lmxwb3N9XG4gICAgICBvbkV2ZW50KG5ld0xhc3RFdmVudClcbiAgICAgIHNldExhc3RFdmVudChuZXdMYXN0RXZlbnQpXG4gICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICB9XG4gIH1cbiAgcmV0dXJuIChcbiAgICA8Ym94XG4gICAgICByZWY9e2JveFJlZn1cbiAgICAgIHsuLi5ib3hQcm9wc31cbiAgICAgIG1vdXNlXG4gICAgICBrZXlzXG4gICAgICBpbnB1dFxuICAgICAgY2xpY2thYmxlXG4gICAgICBmb2N1c2VkXG4gICAgICBib3JkZXI9e3sgdHlwZTogJ2xpbmUnIH19XG4gICAgICBzdHlsZT17eyBib3JkZXI6IHsgZmc6ICdjeWFuJyB9IH19XG4gICAgICB0YWdzPXtmYWxzZX0gICAgICAgICAgIC8vIHJhdyBBTlNJXG4gICAgICBzY3JvbGxhYmxlPXtmYWxzZX1cbiAgICAgIG9uS2V5cHJlc3M9e2ludGVybmFsT25LZXlwcmVzc31cbiAgICAgIG9uTW91c2U9e21vdXNlQWN0aW9ufVxuICAgICAgbGFiZWw9e2BFZGl0aW5nOiAke2ZpbGVQYXRofWB9XG4gICAgPlxuICAgICAgey8qIHN0YXR1c1xuICAgICAgb25DbGljaz17c2V0Q3Vyc29yUG9zaXRpb259XG4gICAgICBvblNjcm9sbD17c2Nyb2xsQ3Vyc29yfVxuICAgICAgKi99XG4gICAgICB7dG9rZW5MaXN0KCl9XG4gICAgICB7Lyogc3RhdHVzICovfVxuICAgICAgPGJveFxuICAgICAgICBrZXk9e2BzdGF0dXNgfVxuICAgICAgICB0b3A9e3NpemUucm93c31cbiAgICAgICAgbGVmdD17Mn1cbiAgICAgICAgd2lkdGg9e3NpemUuY29scy02fVxuICAgICAgICBoZWlnaHQ9ezF9XG4gICAgICAgIGNvbnRlbnQ9e2VkaXRvcj8uZ2V0U3RhdHVzKCl9XG4gICAgICAgIHRhZ3M9e2ZhbHNlfVxuICAgICAgICBzdHlsZT17e2ZnOidibGFjaycsYmc6J3llbGxvdyd9fVxuICAgICAgLz5cbiAgICAgIHtjdXJzb3JzKCl9XG4gICAgPC9ib3g+XG4gICk7XG59IiwiY29uc3QgdXRpbCA9IHJlcXVpcmUoJ3V0aWwnKTtcbmNvbnN0IGNwID0gcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpO1xuY29uc3QgZXhlYyA9IHV0aWwucHJvbWlzaWZ5KGNwLmV4ZWMpO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0U3RhdHVzKGN3ZCkge1xuICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXhlYyhgZ2l0IHN0YXR1cyAtLXBvcmNlbGFpbmAsIHsgY3dkIH0pO1xuICByZXR1cm4gc3Rkb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0Q29tbWl0cyhjd2QpIHtcbiAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4ZWMoYGdpdCBsb2cgLS1wcmV0dHk9Zm9ybWF0OlwiJWggJXNcIiAtLWFiYnJldj00MCB8IHRlZWAsIHsgY3dkIH0pO1xuICBjb25zdCBsaW5lcyA9IHN0ZG91dC5zcGxpdCgnXFxuJykuZmlsdGVyKEJvb2xlYW4pXG4gIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbChsaW5lcy5tYXAoYXN5bmMgdiA9PiB7XG4gICAgY29uc3QgaWQgPSB2LnN1YnN0cmluZygwLDQwKVxuICAgIGNvbnN0IG1lc3NhZ2UgPSB2LnN1YnN0cmluZyg0MSlcbiAgICBjb25zdCB7IHN0ZG91dDp0YWdzIH0gPSBhd2FpdCBleGVjKGBnaXQgdGFnIC0tcG9pbnRzLWF0ICR7aWR9YCwgeyBjd2QgfSk7XG4gICAgcmV0dXJuIGAke2lkLnN1YnN0cmluZygwLDgpfeKUgiR7KHRhZ3M/dGFncy50cmltKFwiXFxuXCIpOlwiXCIpLnBhZEVuZCg5LCcgJyl94pSCJHttZXNzYWdlfWBcbiAgICAvLyByZXR1cm4gYCR7aWQuc3Vic3RyaW5nKDAsOCl9ICR7bWVzc2FnZX1gXG4gIH0pKTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRCcmFuY2goY3dkKSB7XG4gIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleGVjKGBnaXQgYnJhbmNoIC0tc2hvdy1jdXJyZW50YCwgeyBjd2QgfSk7XG4gIHJldHVybiBzdGRvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRDdXJyZW50VGFnKGN3ZCkge1xuICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXhlYyhgZ2l0IGRlc2NyaWJlIC0tdGFncyAtLWV4YWN0LW1hdGNoIDI+L2Rldi9udWxsIHx8IGVjaG8gXCJub25lXCJgLCB7IGN3ZCB9KTtcbiAgcmV0dXJuIHN0ZG91dC5zcGxpdCgnXFxuJykuZmlsdGVyKEJvb2xlYW4pO1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldFJlbW90ZXMoY3dkKSB7XG4gIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleGVjKGBnaXQgcmVtb3RlIC12YCwgeyBjd2QgfSk7XG4gIHJldHVybiBzdGRvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRUYWdzKGN3ZCkge1xuICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXhlYyhgZ2l0IHRhZyB8IHRlZWAsIHsgY3dkIH0pO1xuICByZXR1cm4gc3Rkb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2l0U3RhZ2UoY3dkLCBmaWxlUGF0aCkge1xuICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXhlYyhgZ2l0IGFkZCAtZiBcIiR7ZmlsZVBhdGh9XCJgLCB7IGN3ZCB9KTtcbiAgcmV0dXJuIHN0ZG91dC5zcGxpdCgnXFxuJykuZmlsdGVyKEJvb2xlYW4pO1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdpdFVuc3RhZ2UoY3dkLCBmaWxlUGF0aCkge1xuICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXhlYyhgZ2l0IHJlc3RvcmUgLS1zdGFnZWQgXCIke2ZpbGVQYXRofVwiYCwgeyBjd2QgfSk7XG4gIHJldHVybiBzdGRvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnaXRDb21taXQoY3dkLGNvbW1pdE1lc3NhZ2UpIHtcbiAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4ZWMoYGdpdCBjb21taXQgLW0gXCIke2NvbW1pdE1lc3NhZ2V9XCJgLCB7IGN3ZCB9KTtcbiAgcmV0dXJuIHN0ZG91dC5zcGxpdCgnXFxuJykuZmlsdGVyKEJvb2xlYW4pO1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdpdFRhZyhjd2QsdGFnKSB7XG4gIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleGVjKGBnaXQgdGFnIFwiJHt0YWd9XCJgLCB7IGN3ZCB9KTtcbiAgcmV0dXJuIHN0ZG91dC5zcGxpdCgnXFxuJykuZmlsdGVyKEJvb2xlYW4pO1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdpdFB1c2goY3dkLHJlbW90ZSxicmFuY2gpIHtcbiAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4ZWMoYGdpdCBwdXNoIFwiJHtyZW1vdGV9XCIgXCIke2JyYW5jaH1cIiAtLXRhZ3NgLCB7IGN3ZCB9KTtcbiAgcmV0dXJuIHN0ZG91dC5zcGxpdCgnXFxuJykuZmlsdGVyKEJvb2xlYW4pO1xufSIsIlxuaW1wb3J0IFJlYWN0LCB7dXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlfSBmcm9tIFwicmVhY3RcIjtcbmltcG9ydCB7XG4gICAgTGlzdEVsZW1lbnQgYXMgbGlzdCxcbiAgICBCb3hFbGVtZW50IGFzIGJveCxcbiAgICBCdXR0b25FbGVtZW50IGFzIGJ1dHRvbixcbiAgICBUZXh0YXJlYUVsZW1lbnQgYXMgdGV4dGFyZWEsXG4gICAgVGV4dEVsZW1lbnQgYXMgdGV4dFxufSBmcm9tICdyZWFjdC1ibGVzc2VkJztcbmltcG9ydCB7U2ltcGxlVGV4dEVkaXRvcn0gZnJvbSBcIi4vU2ltcGxlVGV4dEVkaXRvci5qc1wiO1xuaW1wb3J0IHtzYWZlU3RyaW5naWZ5fSBmcm9tIFwiLi91dGlsXCI7XG5jb25zdCBkZWZhdWx0VGV4dD1cIi4uLlwiXG4gICAgLnNwbGl0KFwiLFwiKS5qb2luKFwiXFxuXCIpXG5leHBvcnQgZnVuY3Rpb24gU2ltcGxlVGV4dEVkaXRvckNvbXBvbmVudCh7aW5pdGlhbFRleHQsIG9uQ2hhbmdlLC4uLmJveFByb3BzfSkge1xuICAgIGNvbnN0IGJveFJlZiA9IHVzZVJlZihudWxsKTtcbiAgICBjb25zdCBbZWRpdG9yLCBzZXRFZGl0b3JdID0gdXNlU3RhdGUobnVsbCk7XG4gICAgY29uc3QgW21vdXNlQ29vcmRzLCBzZXRNb3VzZUNvb3Jkc10gPSB1c2VTdGF0ZSh7eDowLHk6MH0pO1xuICAgIGNvbnN0IFtzaXplLCBzZXRTaXplXSAgICAgPSB1c2VTdGF0ZSh7IHJvd3M6IDEwLCBjb2xzOiAzMCB9KTtcbiAgICBsZXQgY2hhbmdlZFRpbWVvdXQ9MFxuICAgIHVzZUVmZmVjdCgoKT0+e1xuICAgICAgICBsZXQgbmV3RWRpdG9yPWVkaXRvclxuICAgICAgICBpZighbmV3RWRpdG9yKXtcbiAgICAgICAgICAgIG5ld0VkaXRvciA9IG5ldyBTaW1wbGVUZXh0RWRpdG9yKGluaXRpYWxUZXh0fHxkZWZhdWx0VGV4dClcbiAgICAgICAgfVxuICAgICAgICBpZigoaW5pdGlhbFRleHR8fGRlZmF1bHRUZXh0KS5zdWJzdHJpbmcobmV3RWRpdG9yLmN1cnNvckluZGV4KSE9PW5ld0VkaXRvci5idWZmZXIuc3Vic3RyaW5nKG5ld0VkaXRvci5jdXJzb3JJbmRleCkpe1xuICAgICAgICAgICAgbmV3RWRpdG9yLmN1cnNvckluZGV4ID0gMFxuICAgICAgICAgICAgbmV3RWRpdG9yLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpXG4gICAgICAgIH1cbiAgICAgICAgbmV3RWRpdG9yLmJ1ZmZlcj1pbml0aWFsVGV4dHx8ZGVmYXVsdFRleHRcbiAgICAgICAgbmV3RWRpdG9yLnZpZXdwb3J0SGVpZ2h0ID0gc2l6ZS5yb3dzLTE7XG4gICAgICAgIG5ld0VkaXRvci52aWV3cG9ydFdpZHRoID0gc2l6ZS5jb2xzO1xuICAgICAgICBzZXRFZGl0b3IobmV3RWRpdG9yLmNvcHkoKSlcbiAgICB9LFtpbml0aWFsVGV4dF0pXG5cbiAgICAvLyAyKSB1cGRhdGUgc2l6ZSBvbiByZXNpemVcbiAgICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgICAgICBjb25zdCBib3ggPSBib3hSZWYuY3VycmVudDtcbiAgICAgICAgaWYgKCFib3gpIHJldHVybjtcbiAgICAgICAgY29uc3QgdXBkYXRlID0gKCkgPT4ge1xuICAgICAgICAgICAgc2V0U2l6ZSh7IGNvbHM6IGJveC53aWR0aCwgcm93czogYm94LmhlaWdodC0yIH0pO1xuICAgICAgICB9O1xuICAgICAgICB1cGRhdGUoKTtcbiAgICAgICAgYm94Lm9uKCdyZXNpemUnLCB1cGRhdGUpO1xuICAgICAgICByZXR1cm4gKCkgPT4gYm94LnJlbW92ZUxpc3RlbmVyKCdyZXNpemUnLCB1cGRhdGUpO1xuICAgIH0sIFtdKTtcbiAgICAvLyAkJV4mKigpXG4gICAgaWYoMSA9PT0gMSAmJiAyPT0zMyl7fVxuICAgIC8vIHJ1biBvbmNlIG9uIHNpemUgY2hhbmdlXG4gICAgdXNlRWZmZWN0KCgpPT57XG4gICAgICAgIGlmKGVkaXRvcil7XG4gICAgICAgICAgICBlZGl0b3Iudmlld3BvcnRXaWR0aCA9IHNpemUuY29scztcbiAgICAgICAgICAgIGVkaXRvci52aWV3cG9ydEhlaWdodCA9IHNpemUucm93cztcbiAgICAgICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgICAgICB9XG4gICAgfSwgW3NpemVdKTtcblxuICAgIGNvbnN0IGludGVybmFsT25LZXlQcmVzcz0oY2gsa2V5KT0+e1xuICAgICAgICBlZGl0b3Iub25LZXkoY2gsa2V5KVxuICAgICAgICBjbGVhclRpbWVvdXQoY2hhbmdlZFRpbWVvdXQpXG4gICAgICAgIGNoYW5nZWRUaW1lb3V0ID0gc2V0VGltZW91dCgoKT0+e1xuICAgICAgICAgICAgb25DaGFuZ2UoZWRpdG9yKVxuICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgIH0sODApXG4gICAgfVxuICAgIGNvbnN0IHNldEN1cnNvclBvc2l0aW9uID0gKHNjcmVlbkV2ZW50KSA9PiB7XG4gICAgICAgIGlmKCFlZGl0b3Ipe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHt4aSx5aX0gPSBib3hSZWYuY3VycmVudC5scG9zO1xuICAgICAgICBjb25zdCB7eCx5fSA9IHNjcmVlbkV2ZW50O1xuICAgICAgICBlZGl0b3Iuc2V0Q3Vyc29yKHgteGktMStlZGl0b3Iudmlld3BvcnRYLHkteWktMStlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICB9O1xuICAgIGNvbnN0IG1vdXNlQWN0aW9uPShldmVudCkgPT57XG4gICAgICAgIGNvbnN0IHt4LHl9ID0gZXZlbnRcblxuICAgICAgICAvLyBzd2l0Y2goZXZlbnQuYWN0aW9uKXtcbiAgICAgICAgLy8gICAgIGNhc2UgJ21vdXNlbW92ZSc6YnJlYWs7XG4gICAgICAgIC8vICAgICBjYXNlICdtb3VzZWRvd24nOmJyZWFrO1xuICAgICAgICAvLyAgICAgY2FzZSAnbW91c2V1cCc6YnJlYWs7XG4gICAgICAgIC8vICAgICBjYXNlICd3aGVlbHVwJzplZGl0b3IubW92ZUN1cnNvclVwKCkuc2xpZGVWaWV3cG9ydFRvQ3Vyc29yKCk7c2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpO2JyZWFrO1xuICAgICAgICAvLyAgICAgY2FzZSAnd2hlZWxkb3duJzplZGl0b3IubW92ZUN1cnNvckRvd24oKS5zbGlkZVZpZXdwb3J0VG9DdXJzb3IoKTtzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSk7YnJlYWs7XG4gICAgICAgIC8vICAgICBkZWZhdWx0OiB0aHJvdyBuZXcgRXJyb3Ioc2FmZVN0cmluZ2lmeShldmVudCkpOyBicmVhaztcbiAgICAgICAgLy8gfVxuICAgICAgICAvLyBzZXRNb3VzZUNvb3Jkcyh7eCx5fSk7XG4gICAgfVxuICAgIGNvbnN0IHJlbmRlckxpbmVzID0gKCkgPT4ge1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB7dmlld3BvcnRZOnZ5LHZpZXdwb3J0SGVpZ2h0OnZofSA9IGVkaXRvclxuICAgICAgICByZXR1cm4gZWRpdG9yLnJlbmRlclRvTGluZXMoKVxuICAgICAgICAgICAgLmZpbHRlcigobCx5KSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICh5ID49dnkgJiYgeSA8PSAodnkgKyB2aCkpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5tYXAoKGxpbmUsaW5kZXgpPT57XG4gICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgdG9wPXtpbmRleH0gbGVmdD17MH0gaGVpZ2h0PXsxfSB3aWR0aD17bGluZS5sZW5ndGh8fDF9XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXk9e2Bjb21taXQtZWRpdG9yLWxpbmUtJHtpbmRleH1gfVxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudD17bGluZX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICB9KVxuICAgIH1cbiAgICBjb25zdCByZW5kZXJDdXJzb3IgPSAoKSA9PiB7XG4gICAgICAgIGlmKCFlZGl0b3Ipe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGkgPSBlZGl0b3IuY3Vyc29ySW5kZXhcbiAgICAgICAgY29uc3Qge3gseX0gPSBlZGl0b3IuY3Vyc29yQ29vcmRzKClcbiAgICAgICAgY29uc3Qge2N1cnNvckluZGV4OmNpLHZpZXdwb3J0WDp2eCx2aWV3cG9ydFk6dnksdmlld3BvcnRIZWlnaHQ6dmgsdmlld3BvcnRXaWR0aDp2d30gPSBlZGl0b3I7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBlZGl0b3IuYnVmZmVyLnN1YnN0cmluZyhpLGkrMSlcbiAgICAgICAgcmV0dXJuICg8Ym94XG4gICAgICAgICAgICBrZXk9e2BlZGl0b3ItY3Vyc29yLSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgdG9wPXt5LXZ5fVxuICAgICAgICAgICAgbGVmdD17eC12eH1cbiAgICAgICAgICAgIHdpZHRoPXsxfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBzdHlsZT17e2ludmVyc2U6dHJ1ZSx1bmRlcmxpbmU6dHJ1ZX19XG4gICAgICAgICAgICBjb250ZW50PXtjb250ZW50fVxuICAgICAgICAvPilcbiAgICB9XG4gICAgY29uc3QgcmVuZGVyU3RhdHVzID0gKCkgPT4ge1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB7Y3Vyc29ySW5kZXg6Y2ksdmlld3BvcnRYOnZ4LHZpZXdwb3J0WTp2eSx2aWV3cG9ydEhlaWdodDp2aCx2aWV3cG9ydFdpZHRoOnZ3fSA9IGVkaXRvcjtcbiAgICAgICAgY29uc3Qge3g6Y3gseTpjeX0gPSBlZGl0b3IuY3Vyc29yQ29vcmRzKClcbiAgICAgICAgY29uc3Qge3g6bXgseTpteX0gPSBtb3VzZUNvb3Jkc1xuICAgICAgICBsZXQgY3Vyc29yQ29udGVudCA9IGVkaXRvci5idWZmZXIuc3Vic3RyaW5nKGNpLGNpKzEpXG4gICAgICAgIGxldCBjb250ZW50PWN1cnNvckNvbnRlbnRcbiAgICAgICAgaWYoYm94UmVmLmN1cnJlbnQgJiYgYm94UmVmLmN1cnJlbnQubHBvcykge1xuICAgICAgICAgICAgY29uc3Qge3hpLHlpfSA9IGJveFJlZi5jdXJyZW50Lmxwb3M7XG4gICAgICAgICAgICBjb25zdCBmZWVkYmFjaz17XG4gICAgICAgICAgICAgICAgQzpgJHtjeH0sJHtjeX0sWyR7Y2l9XT0ke2N1cnNvckNvbnRlbnR9YCxcbiAgICAgICAgICAgICAgICBCOmAke3hpfSwke3lpfWAsXG4gICAgICAgICAgICAgICAgVjpgJHt2eH0sJHt2eX0sJHt2d30sJHt2aH1gLFxuICAgICAgICAgICAgICAgIE06YEEke214fSwke215fVIke214LXhpLTF9LCR7bXkteWktMX1gXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250ZW50ID0gc2FmZVN0cmluZ2lmeShmZWVkYmFjaykucmVwbGFjZSgvW3t9IFwiXS9naSwnJylcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gKDxib3hcbiAgICAgICAgICAgIGtleT17YGVkaXRvci1zdGF0dXMtJHtEYXRlLm5vdygpfWB9XG4gICAgICAgICAgICB0b3A9ezd9XG4gICAgICAgICAgICBsZWZ0PXsyfVxuICAgICAgICAgICAgd2lkdGg9e2NvbnRlbnQubGVuZ3RofSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBzdHlsZT17e2ludmVyc2U6dHJ1ZSx1bmRlcmxpbmU6dHJ1ZX19XG4gICAgICAgICAgICBjb250ZW50PXtjb250ZW50fVxuICAgICAgICAvPilcbiAgICB9XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveFxuICAgICAgICAgICAgcmVmPXtib3hSZWZ9XG4gICAgICAgICAgICB7Li4uYm94UHJvcHN9XG4gICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgYm9yZGVyPXt7IHR5cGU6ICdsaW5lJyB9fVxuICAgICAgICAgICAgc3R5bGU9e3sgYm9yZGVyOiB7IGZnOiAnY3lhbicgfSB9fVxuICAgICAgICAgICAgdGFncz17ZmFsc2V9ICAgICAgICAgICAvLyByYXcgQU5TSVxuICAgICAgICAgICAgc2Nyb2xsYWJsZT17ZmFsc2V9XG4gICAgICAgICAgICBvbktleXByZXNzPXtpbnRlcm5hbE9uS2V5UHJlc3N9XG4gICAgICAgICAgICBvbkNsaWNrPXtzZXRDdXJzb3JQb3NpdGlvbn1cbiAgICAgICAgICAgIG9uTW91c2U9e21vdXNlQWN0aW9ufVxuICAgICAgICA+XG4gICAgICAgICAgICB7LypsYWJlbCA9IHtgJHtib3hQcm9wcy5sYWJlbCB8fCAnRWRpdGluZyd9ICR7SlNPTi5zdHJpbmdpZnkoZWRpdG9yLmN1cnNvckNvb3JkcygpKX0gJHtlZGl0b3IuY3Vyc29ySW5kZXh9YH0qL31cbiAgICAgICAgICAgIHtyZW5kZXJMaW5lcygpfVxuICAgICAgICAgICAge3JlbmRlckN1cnNvcigpfVxuICAgICAgICAgICAge3JlbmRlclN0YXR1cygpfVxuICAgICAgICA8L2JveD4pXG59IiwiaW1wb3J0IHt2ZXJzaW9ufSBmcm9tIFwidml0ZVwiO1xuXG5leHBvcnQgY2xhc3MgU2VtdmVyIHtcbiAgICBtYWpvciA9IDBcbiAgICBtaW5vciA9IDBcbiAgICBwYXRjaCA9IDBcblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHZcbiAgICAgKiBAcmV0dXJuIHtTZW12ZXJ9XG4gICAgICovXG4gICAgc3RhdGljIGZyb20odil7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBbbWFqb3IsIG1pbm9yLCBwYXRjaF0gPSAodiB8fCAnMC4wLjAnKS5zcGxpdCgnLicpXG4gICAgICAgICAgICByZXR1cm4gbmV3IFNlbXZlcihtYWpvciwgbWlub3IsIHBhdGNoKVxuICAgICAgICB9Y2F0Y2goZSl7XG4gICAgICAgICAgICBjb25zdCBbbWFqb3IsIG1pbm9yLCBwYXRjaF0gPSAnMC4wLjAnLnNwbGl0KCcuJylcbiAgICAgICAgICAgIHJldHVybiBuZXcgU2VtdmVyKG1ham9yLCBtaW5vciwgcGF0Y2gpXG4gICAgICAgIH1cbiAgICB9XG4gICAgY29uc3RydWN0b3IobWFqb3IsbWlub3IscGF0Y2gpIHtcbiAgICAgICAgdGhpcy5tYWpvciA9IG1ham9yXG4gICAgICAgIHRoaXMubWlub3IgPSBtaW5vclxuICAgICAgICB0aGlzLnBhdGNoID0gcGF0Y2hcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NlbXZlcn1cbiAgICAgKi9cbiAgICBuZXh0TWFqb3IoKXtcbiAgICAgICAgcmV0dXJuIG5ldyBTZW12ZXIoKHBhcnNlSW50KHRoaXMubWFqb3IpKzEpLnRvU3RyaW5nKCksIFwiMFwiLFwiMFwiKVxuICAgIH1cbiAgICBwcmV2TWFqb3IoKXtcbiAgICAgICAgbGV0IHYgPSBwYXJzZUludCh0aGlzLm1ham9yKVxuICAgICAgICB2PXY+MD92LTE6dlxuICAgICAgICByZXR1cm4gbmV3IFNlbXZlcih2LnRvU3RyaW5nKCksIFwiMFwiLFwiMFwiKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2VtdmVyfVxuICAgICAqL1xuICAgIG5leHRNaW5vcigpe1xuICAgICAgICByZXR1cm4gbmV3IFNlbXZlcih0aGlzLm1ham9yLChwYXJzZUludCh0aGlzLm1pbm9yKSsxKS50b1N0cmluZygpLCBcIjBcIilcbiAgICB9XG4gICAgcHJldk1pbm9yKCl7XG4gICAgICAgIGxldCB2ID0gcGFyc2VJbnQodGhpcy5taW5vcilcbiAgICAgICAgdj12PjA/di0xOnZcbiAgICAgICAgcmV0dXJuIG5ldyBTZW12ZXIodGhpcy5tYWpvcix2LnRvU3RyaW5nKCksIFwiMFwiKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2VtdmVyfVxuICAgICAqL1xuICAgIG5leHRQYXRjaCgpe1xuICAgICAgICByZXR1cm4gbmV3IFNlbXZlcih0aGlzLm1ham9yLHRoaXMubWlub3IsIChwYXJzZUludCh0aGlzLnBhdGNoKSsxKS50b1N0cmluZygpKVxuICAgIH1cbiAgICBwcmV2UGF0Y2goKXtcbiAgICAgICAgbGV0IHYgPSBwYXJzZUludCh0aGlzLnBhdGNoKVxuICAgICAgICB2PXY+MD92LTE6dlxuICAgICAgICByZXR1cm4gbmV3IFNlbXZlcih0aGlzLm1ham9yLHRoaXMubWlub3IsIHYudG9TdHJpbmcoKSlcbiAgICB9XG5cblxuICAgIHRvU3RyaW5nKCl7XG4gICAgICAgIHJldHVybiBgJHt0aGlzLm1ham9yfS4ke3RoaXMubWlub3J9LiR7dGhpcy5wYXRjaH1gXG4gICAgfVxuICAgIGNvcHkoKXtcbiAgICAgICAgcmV0dXJuIG5ldyBTZW12ZXIodGhpcy5tYWpvcix0aGlzLm1pbm9yLCB0aGlzLnBhdGNoKVxuICAgIH1cbn0iLCJpbXBvcnQgUmVhY3QsIHtDb21wb25lbnQsIHVzZUVmZmVjdCwgdXNlUmVmLCB1c2VTdGF0ZX0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHtcbiAgICBMaXN0RWxlbWVudCBhcyBsaXN0LFxuICAgIEJveEVsZW1lbnQgYXMgYm94LFxuICAgIEJ1dHRvbkVsZW1lbnQgYXMgYnV0dG9uLFxuICAgIFRleHRhcmVhRWxlbWVudCBhcyB0ZXh0YXJlYSxcbiAgICBUZXh0RWxlbWVudCBhcyB0ZXh0XG59IGZyb20gJ3JlYWN0LWJsZXNzZWQnO1xuaW1wb3J0IHtTZW12ZXJ9IGZyb20gXCIuL1NlbXZlci5qc1wiO1xuXG4vLyBjb21tZW50IFxuZXhwb3J0IGZ1bmN0aW9uIFNlbXZlckNvbnRyb2woe2luaXRpYWwsb25DaGFuZ2UsLi4uYm94UHJvcHN9KXtcbiAgICBjb25zdCBbc2VtdmVyLCBzZXRTZW12ZXJdID0gdXNlU3RhdGUoU2VtdmVyLmZyb20oaW5pdGlhbCkpO1xuICAgIHVzZUVmZmVjdCgoKT0+e1xuICAgICAgICBzZXRTZW12ZXIoU2VtdmVyLmZyb20oaW5pdGlhbCkpO1xuICAgIH0sW2luaXRpYWxdKVxuICAgIGNvbnN0IGRlY01ham9yPSgpPT57XG4gICAgICAgIGNvbnN0IG5ld1NlbXZlcj1zZW12ZXIucHJldk1ham9yKClcbiAgICAgICAgb25DaGFuZ2UobmV3U2VtdmVyKVxuICAgICAgICBzZXRTZW12ZXIobmV3U2VtdmVyKVxuICAgIH1cbiAgICBjb25zdCBpbmNNYWpvcj0oKT0+e1xuICAgICAgICBjb25zdCBuZXdTZW12ZXI9c2VtdmVyLm5leHRNYWpvcigpXG4gICAgICAgIG9uQ2hhbmdlKG5ld1NlbXZlcilcbiAgICAgICAgc2V0U2VtdmVyKG5ld1NlbXZlcilcbiAgICB9XG4gICAgY29uc3QgZGVjTWlub3I9KCk9PntcbiAgICAgICAgY29uc3QgbmV3U2VtdmVyPXNlbXZlci5wcmV2TWlub3IoKVxuICAgICAgICBvbkNoYW5nZShuZXdTZW12ZXIpXG4gICAgICAgIHNldFNlbXZlcihuZXdTZW12ZXIpXG4gICAgfVxuICAgIGNvbnN0IGluY01pbm9yPSgpPT57XG4gICAgICAgIGNvbnN0IG5ld1NlbXZlcj1zZW12ZXIubmV4dE1pbm9yKClcbiAgICAgICAgb25DaGFuZ2UobmV3U2VtdmVyKVxuICAgICAgICBzZXRTZW12ZXIobmV3U2VtdmVyKVxuICAgIH1cbiAgICBjb25zdCBkZWNQYXRjaD0oKT0+e1xuICAgICAgICBjb25zdCBuZXdTZW12ZXI9c2VtdmVyLnByZXZQYXRjaCgpXG4gICAgICAgIG9uQ2hhbmdlKG5ld1NlbXZlcilcbiAgICAgICAgc2V0U2VtdmVyKG5ld1NlbXZlcilcbiAgICB9XG4gICAgY29uc3QgaW5jUGF0Y2g9KCk9PntcbiAgICAgICAgY29uc3QgbmV3U2VtdmVyPXNlbXZlci5uZXh0UGF0Y2goKVxuICAgICAgICBvbkNoYW5nZShuZXdTZW12ZXIpXG4gICAgICAgIHNldFNlbXZlcihuZXdTZW12ZXIpXG4gICAgfVxuICAgIHJldHVybiAoPGJveCB7Li4uYm94UHJvcHN9PlxuICAgICAgICA8Ym94IG1vdXNlIGZvY3VzZWQgY2xpY2thYmxlIG9uQ2xpY2s9e2RlY01ham9yfSBsZWZ0PXsxfSBoZWlnaHQ9ezF9IHdpZHRoPXsxfSAgY29udGVudD17J3YnfS8+XG4gICAgICAgIDxib3ggbW91c2UgZm9jdXNlZCBjbGlja2FibGUgb25DbGljaz17aW5jTWFqb3J9IGxlZnQ9ezJ9IGhlaWdodD17MX0gd2lkdGg9e3NlbXZlci5tYWpvci5sZW5ndGh9IGNvbnRlbnQ9e3NlbXZlci5tYWpvcn0vPlxuICAgICAgICA8Ym94IG1vdXNlIGZvY3VzZWQgY2xpY2thYmxlIG9uQ2xpY2s9e2RlY01pbm9yfSBsZWZ0PXsyK3NlbXZlci5tYWpvci5sZW5ndGh9IGhlaWdodD17MX0gd2lkdGg9ezF9ICBjb250ZW50PXsnLid9Lz5cbiAgICAgICAgPGJveCBtb3VzZSBmb2N1c2VkIGNsaWNrYWJsZSBvbkNsaWNrPXtpbmNNaW5vcn0gbGVmdD17MytzZW12ZXIubWFqb3IubGVuZ3RofSBoZWlnaHQ9ezF9IHdpZHRoPXtzZW12ZXIubWlub3IubGVuZ3RofSAgY29udGVudD17c2VtdmVyLm1pbm9yfS8+XG4gICAgICAgIDxib3ggbW91c2UgZm9jdXNlZCBjbGlja2FibGUgb25DbGljaz17ZGVjUGF0Y2h9IGxlZnQ9ezMrc2VtdmVyLm1ham9yLmxlbmd0aCtzZW12ZXIubWlub3IubGVuZ3RofSBoZWlnaHQ9ezF9IHdpZHRoPXsxfSBjb250ZW50PXsnLid9Lz5cbiAgICAgICAgPGJveCBtb3VzZSBmb2N1c2VkIGNsaWNrYWJsZSBvbkNsaWNrPXtpbmNQYXRjaH0gbGVmdD17NCtzZW12ZXIubWFqb3IubGVuZ3RoK3NlbXZlci5taW5vci5sZW5ndGh9IGhlaWdodD17MX0gd2lkdGg9e3NlbXZlci5wYXRjaC5sZW5ndGh9IGNvbnRlbnQ9e3NlbXZlci5wYXRjaH0vPlxuICAgIDwvYm94Pilcbn0iLCIvLyBjb21wb25lbnRzL0dpdFBhbmVsLmpzXG5pbXBvcnQgUmVhY3QsIHtDb21wb25lbnQsIHVzZUVmZmVjdCwgdXNlUmVmLCB1c2VTdGF0ZX0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHtcbiAgICBMaXN0RWxlbWVudCBhcyBsaXN0LFxuICAgIFRhYmxlRWxlbWVudCBhcyB0YWJsZSxcbiAgICBCb3hFbGVtZW50IGFzIGJveCxcbiAgICBCdXR0b25FbGVtZW50IGFzIGJ1dHRvbixcbiAgICBUZXh0YXJlYUVsZW1lbnQgYXMgdGV4dGFyZWEsXG4gICAgVGV4dEVsZW1lbnQgYXMgdGV4dFxufSBmcm9tICdyZWFjdC1ibGVzc2VkJztcbmltcG9ydCB7V29ya3NwYWNlfSBmcm9tIFwiLi9Xb3Jrc3BhY2VcIjtcbmltcG9ydCB7Z2V0U3RhdHVzLGdldENvbW1pdHMsZ2V0QnJhbmNoLGdldEN1cnJlbnRUYWcsZ2V0UmVtb3RlcyxnZXRUYWdzLGdpdFN0YWdlLGdpdFVuc3RhZ2UsZ2l0Q29tbWl0LGdpdFRhZyxnaXRQdXNofSBmcm9tIFwiLi9HaXRDb21wb25lbnQuc2VydmljZVwiO1xuaW1wb3J0IE1vZGFsRGlhbG9nIGZyb20gXCIuL01vZGFsRGlhbG9nXCI7XG5pbXBvcnQge1NpbXBsZVRleHRFZGl0b3JDb21wb25lbnR9IGZyb20gXCIuL1NpbXBsZVRleHRFZGl0b3IuanN4XCI7XG5pbXBvcnQge1NlbXZlckNvbnRyb2x9IGZyb20gXCIuL1NlbXZlci5qc3hcIjtcbmltcG9ydCB7c2FmZVN0cmluZ2lmeX0gZnJvbSBcIi4vdXRpbFwiO1xuXG5leHBvcnQgZnVuY3Rpb24gR2l0Q29tcG9uZW50KHtcbiAgICAgICAgcm9vdERpcixcbiAgICAgICAgb25GaWxlU2VsZWN0ICxcbiAgICAgICAgLi4uYm94UHJvcHNcbiAgICB9KSB7XG4gICAgY29uc3QgW21lc3NhZ2UsIHNldE1lc3NhZ2VdID0gdXNlU3RhdGUoZmFsc2UpO1xuICAgIGNvbnN0IFtnaXRTdGF0dXMsIHNldEdpdFN0YXR1c10gPSB1c2VTdGF0ZShbXSk7XG4gICAgY29uc3QgW2dpdENvbW1pdHMsIHNldEdpdENvbW1pdHNdID0gdXNlU3RhdGUoW10pO1xuICAgIGNvbnN0IFtnaXRCcmFuY2gsIHNldEdpdEJyYW5jaF0gPSB1c2VTdGF0ZShcIlwiKTtcbiAgICBjb25zdCBbZ2l0Q3VycmVudFRhZywgc2V0R2l0Q3VycmVudFRhZ10gPSB1c2VTdGF0ZShcIlwiKTtcbiAgICBjb25zdCBbZ2l0VGFncywgc2V0R2l0VGFnc10gPSB1c2VTdGF0ZShbXSk7XG4gICAgY29uc3QgW2dpdFJlbW90ZXMsIHNldEdpdFJlbW90ZXNdID0gdXNlU3RhdGUoW10pO1xuICAgIGNvbnN0IFtjb21taXRNZXNzYWdlLCBzZXRDb21taXRNZXNzYWdlXSA9IHVzZVN0YXRlKG51bGwpO1xuICAgIGNvbnN0IFttb3VzZUNvb3Jkcywgc2V0TW91c2VDb29yZHNdID0gdXNlU3RhdGUoe3g6MCx5OjB9KTtcblxuICAgIGNvbnN0IHNvcnRGaWxlc0ZuID0gKGEsYikgPT4gYS5zdWJzdHJpbmcoMyk+Yi5zdWJzdHJpbmcoMyk/MTooYS5zdWJzdHJpbmcoMyk9PT1iLnN1YnN0cmluZygzKT8wOi0xKVxuICAgIGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hBbGwoKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgICAgIGdldFN0YXR1cyhyb290RGlyKSxcbiAgICAgICAgICAgIGdldENvbW1pdHMocm9vdERpciksXG4gICAgICAgICAgICBnZXRCcmFuY2gocm9vdERpciksXG4gICAgICAgICAgICBnZXRDdXJyZW50VGFnKHJvb3REaXIpLFxuICAgICAgICAgICAgZ2V0UmVtb3Rlcyhyb290RGlyKSxcbiAgICAgICAgICAgIGdldFRhZ3Mocm9vdERpciksXG4gICAgICAgIF0pXG4gICAgICAgIHNldEdpdFN0YXR1cyhBcnJheS5mcm9tKHJlc3VsdFswXSkudG9Tb3J0ZWQoc29ydEZpbGVzRm4pKVxuICAgICAgICBzZXRHaXRDb21taXRzKHJlc3VsdFsxXSlcbiAgICAgICAgc2V0R2l0QnJhbmNoKHJlc3VsdFsyXSlcbiAgICAgICAgc2V0R2l0Q3VycmVudFRhZyhyZXN1bHRbM10pXG4gICAgICAgIHNldEdpdFJlbW90ZXMoQXJyYXkuZnJvbShyZXN1bHRbNF0pLm1hcCh2ID0+e1xuICAgICAgICAgICAgY29uc3QgdGsgPSB2LnNwbGl0KC9cXHMrL2dpKVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBuYW1lOiB0a1swXSxcbiAgICAgICAgICAgICAgICB1cmw6IHRrWzFdLFxuICAgICAgICAgICAgICAgIGtpbmQ6IHRrWzJdLFxuICAgICAgICAgICAgfVxuICAgICAgICB9KSlcbiAgICAgICAgc2V0R2l0VGFncyhyZXN1bHRbNV0pXG4gICAgfVxuICAgIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgICAgIHJlZnJlc2hBbGwoKVxuICAgIH0sIFtdKTtcbiAgICBjb25zdCBvbkZpbGVQYXRoU2VsZWN0ID0gKGV2ZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IHN0YWdlZCA9IGV2ZW50LmNvbnRlbnQuc3Vic3RyaW5nKDAsMSlcbiAgICAgICAgY29uc3QgY2hhbmdlZCA9IGV2ZW50LmNvbnRlbnQuc3Vic3RyaW5nKDEsMilcbiAgICAgICAgY29uc3Qge3gseX0gPSBtb3VzZUNvb3Jkc1xuXG4gICAgICAgIGNvbnN0IGZpbGUgPSBldmVudC5jb250ZW50LnN1YnN0cmluZygzKTtcbiAgICAgICAgaWYgKHN0YWdlZCA9PT0gJyAnIHx8IHN0YWdlZCA9PT0gJz8nIHx8IChjaGFuZ2VkICE9PSAnICcgJiYgc3RhZ2VkID09PSBjaGFuZ2VkKSkge1xuICAgICAgICAgICAgLy8gc2V0TWVzc2FnZShgZ2l0IHN0YWdlIFwiJHtmaWxlfVwiYClcbiAgICAgICAgICAgIGdpdFN0YWdlKHJvb3REaXIsIGZpbGUpLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgICAgICAvLyBzZXRNZXNzYWdlKGBnaXQgc3RhZ2VkIFwiJHtmaWxlfSAoJHtyZXN1bHR9KVwiYClcbiAgICAgICAgICAgICAgICByZXR1cm4gZ2V0U3RhdHVzKHJvb3REaXIpXG4gICAgICAgICAgICB9KS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICAgICAgc2V0R2l0U3RhdHVzKHJlc3VsdC50b1NvcnRlZChzb3J0RmlsZXNGbikpXG4gICAgICAgICAgICB9KS5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgZ2l0IHN0YWdlIFwiJHtmaWxlfSBlcnJvciAoJHtlcnJvcn0pXCJgKVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1lbHNlIGlmIChjaGFuZ2VkID09PSAnICcgfHwgY2hhbmdlZCA9PT0gJz8nKSB7XG4gICAgICAgICAgICAvLyBzZXRNZXNzYWdlKGBnaXQgdW5zdGFnZSBcIiR7ZmlsZX1cImApXG4gICAgICAgICAgICBnaXRVbnN0YWdlKHJvb3REaXIsIGZpbGUpLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgICAgICAvLyBzZXRNZXNzYWdlKGBnaXQgdW5zdGFnZWQgXCIke2ZpbGV9ICgke3Jlc3VsdH0pXCJgKVxuICAgICAgICAgICAgICAgIHJldHVybiBnZXRTdGF0dXMocm9vdERpcilcbiAgICAgICAgICAgIH0pLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgICAgICBzZXRHaXRTdGF0dXMocmVzdWx0LnRvU29ydGVkKHNvcnRGaWxlc0ZuKSlcbiAgICAgICAgICAgIH0pLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICAgICAgICBzZXRNZXNzYWdlKGBnaXQgdW5zdGFnZWQgXCIke2ZpbGV9IGVycm9yICgke2Vycm9yfSlcImApXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICAvLyBzZXRNZXNzYWdlKGBtb3VzZSBAICR7eH0sJHt5fWApXG4gICAgfTtcbiAgICBjb25zdCBvbkNvbW1pdFNlbGVjdCA9IChldmVudCkgPT4ge1xuICAgICAgICAvLyBzZXRNZXNzYWdlKGBjb21taXQgc2VsZWN0ZWQgJHtldmVudC5jb250ZW50fSAke3Byb2Nlc3MuY3dkKCl9YClcbiAgICAgICAgY29uc3QgdGFnPWV2ZW50LmNvbnRlbnQuc3Vic3RyaW5nKDksMTgpLnRyaW0oKVxuICAgICAgICBjb25zdCBtc2c9ZXZlbnQuY29udGVudC5zdWJzdHJpbmcoMTkpXG4gICAgICAgIHNldENvbW1pdE1lc3NhZ2UobXNnKVxuXG4gICAgICAgIGlmKHRhZy5sZW5ndGg+PTUpIHtcbiAgICAgICAgICAgIHNldEdpdEN1cnJlbnRUYWcodGFnKVxuICAgICAgICB9XG4gICAgfTtcbiAgICBjb25zdCBjb21taXRTdGFnZWRGaWxlcyA9IChldmVudCkgPT4ge1xuICAgICAgICBpZihjb21taXRNZXNzYWdlLnRyaW0oKSA9PT0gXCJcIil7XG4gICAgICAgICAgICBzZXRNZXNzYWdlKGBjb21taXQgbWVzc2FnZSBjYW5ub3QgYmUgZW1wdHlgKVxuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIGdpdENvbW1pdChyb290RGlyLCBjb21taXRNZXNzYWdlKS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlZnJlc2hBbGwoKVxuICAgICAgICAgICAgfSkudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYGdpdCBjb21taXQgLW0gXCIke2NvbW1pdE1lc3NhZ2V9XCJgKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICAvLyBzZXRNZXNzYWdlKGBjb21taXQgc2VsZWN0ZWQgJHtldmVudC5jb250ZW50fSAke3Byb2Nlc3MuY3dkKCl9YClcbiAgICB9O1xuICAgIGNvbnN0IHRhZ0xhc3RDb21taXQgPSAoZXZlbnQpID0+IHtcbiAgICAgICAgZ2l0VGFnKHJvb3REaXIsIGdpdEN1cnJlbnRUYWcpLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgIHJldHVybiByZWZyZXNoQWxsKClcbiAgICAgICAgfSkudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgc2V0TWVzc2FnZShgZ2l0IHRhZyAtbSBcIiR7Z2l0Q3VycmVudFRhZ31cImApXG4gICAgICAgIH0pXG4gICAgICAgIC8vIHNldE1lc3NhZ2UoYGNvbW1pdCBzZWxlY3RlZCAke2V2ZW50LmNvbnRlbnR9ICR7cHJvY2Vzcy5jd2QoKX1gKVxuICAgIH07XG4gICAgY29uc3QgcHVzaENvbW1pdHMgPSAoZXZlbnQpID0+IHtcbiAgICAgICAgc2V0TWVzc2FnZShgZ2l0IHB1c2ggXCIke2dpdFJlbW90ZXNbMF0ubmFtZX1cIiBcIiR7Z2l0QnJhbmNofVwiYClcbiAgICAgICAgZ2l0UHVzaChyb290RGlyLCBnaXRSZW1vdGVzWzBdLm5hbWUsZ2l0QnJhbmNoKS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICBzZXRNZXNzYWdlKGBnaXQgcHVzaCBcIiR7Z2l0UmVtb3Rlc1swXS5uYW1lfVwiIFwiJHtnaXRCcmFuY2h9XCJgKVxuICAgICAgICB9KVxuICAgICAgICBzZXRNZXNzYWdlKGBjb21taXQgc2VsZWN0ZWQgJHtldmVudC5jb250ZW50fSAke3Byb2Nlc3MuY3dkKCl9YClcbiAgICB9O1xuICAgIGNvbnN0IGNvbW1pdE1lc3NhZ2VDaGFuZ2VkPShidWZmZXJFZGl0b3IpID0+IHtcbiAgICAgICAgc2V0Q29tbWl0TWVzc2FnZShidWZmZXJFZGl0b3IuYnVmZmVyKVxuICAgIH1cbiAgICBjb25zdCBtb3VzZUFjdGlvbj0oZXZlbnQpID0+e1xuICAgICAgICBjb25zdCB7eCx5fSA9IGV2ZW50XG5cbiAgICAgICAgc3dpdGNoKGV2ZW50LmFjdGlvbil7XG4gICAgICAgICAgICBjYXNlICdtb3VzZW1vdmUnOmJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnbW91c2Vkb3duJzpicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ21vdXNldXAnOmJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnd2hlZWx1cCc6ZWRpdG9yLm1vdmVDdXJzb3JVcCgpLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpO3NldEVkaXRvcihlZGl0b3IuY29weSgpKTticmVhaztcbiAgICAgICAgICAgIGNhc2UgJ3doZWVsZG93bic6ZWRpdG9yLm1vdmVDdXJzb3JEb3duKCkuc2xpZGVWaWV3cG9ydFRvQ3Vyc29yKCk7c2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpO2JyZWFrO1xuICAgICAgICAgICAgZGVmYXVsdDogdGhyb3cgbmV3IEVycm9yKHNhZmVTdHJpbmdpZnkoZXZlbnQpKTsgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgc2V0TW91c2VDb29yZHMoe3gseX0pO1xuICAgIH1cbiAgICBjb25zdCBzdGF0dXMgPSBge2N5YW4tZmd9JHsoZ2l0UmVtb3Rlc1swXXx8e30pLm5hbWV9ey9jeWFuLWZnfS97cmVkLWZnfSR7Z2l0QnJhbmNofXsvcmVkLWZnfSh7eWVsbG93LWZnfSR7Z2l0Q3VycmVudFRhZ317L3llbGxvdy1mZ30pYFxuICAgIGNvbnN0IHN0YXR1c0xlbj1gJHsoZ2l0UmVtb3Rlc1swXXx8e30pLm5hbWV9LyR7Z2l0QnJhbmNofSgke2dpdEN1cnJlbnRUYWd9KWAubGVuZ3RoXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCB7Li4uYm94UHJvcHN9PlxuICAgICAgICAgICAgPGJveCBsYWJlbD17YGB9IGhlaWdodD17OX0gYm9yZGVyPXt7IHR5cGU6ICdsaW5lJyB9fT5cbiAgICAgICAgICAgICAgICA8bGlzdFxuICAgICAgICAgICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgICAgICAgICBmb2N1c2VkXG4gICAgICAgICAgICAgICAgICAgIHNjcm9sbGJhcj17eyBjaDogJz0nLCB0cmFjazogeyBmZzonYmx1ZScsIGJnOiAnZ3JleScgfSB9fVxuICAgICAgICAgICAgICAgICAgICBpdGVtcz17Z2l0U3RhdHVzfVxuICAgICAgICAgICAgICAgICAgICBzdHlsZT17e3NlbGVjdGVkOiB7Ymc6ICdibHVlJ319fVxuICAgICAgICAgICAgICAgICAgICBvblNlbGVjdD17b25GaWxlUGF0aFNlbGVjdH1cbiAgICAgICAgICAgICAgICAgICAgb25TZWxlY3RJdGVtPXtvbkZpbGVQYXRoU2VsZWN0fVxuICAgICAgICAgICAgICAgICAgICBvbk1vdXNlPXttb3VzZUFjdGlvbn1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDxib3ggdG9wPXstMX0gbGVmdD17MjV9IHdpZHRoPXs3fSBoZWlnaHQ9ezF9IGNvbnRlbnQ9e2B7JHttb3VzZUNvb3Jkcy54fSwke21vdXNlQ29vcmRzLnl9fWB9Lz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGJveCBjb250ZW50PXtzdGF0dXN9IHRvcD17MH0gbGVmdD17M30gd2lkdGg9e3N0YXR1c0xlbn0gaGVpZ2h0PXsxfSB0YWdzPXt0cnVlfS8+XG4gICAgICAgICAgICA8Ym94IGNvbnRlbnQ9e3Jvb3REaXJ9IHRvcD17OH0gbGVmdD17M30gd2lkdGg9e3Jvb3REaXIubGVuZ3RofSBoZWlnaHQ9ezF9Lz5cbiAgICAgICAgICAgIDxTaW1wbGVUZXh0RWRpdG9yQ29tcG9uZW50XG4gICAgICAgICAgICAgICAgdG9wPXs5fSAgaGVpZ2h0PXs5fVxuICAgICAgICAgICAgICAgIGxhYmVsPXsnTWVzc2FnZSd9XG4gICAgICAgICAgICAgICAgaW5pdGlhbFRleHQ9e2NvbW1pdE1lc3NhZ2V9XG4gICAgICAgICAgICAgICAgYm9yZGVyPXt7IHR5cGU6ICdsaW5lJyB9fVxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXtjb21taXRNZXNzYWdlQ2hhbmdlZH1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8U2VtdmVyQ29udHJvbFxuICAgICAgICAgICAgICAgIHRvcD17OX0gbGVmdD17MzF9IHdpZHRoPXs5fSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgICAgaW5pdGlhbD17Z2l0Q3VycmVudFRhZ31cbiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KHMpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgc2V0R2l0Q3VycmVudFRhZyhzLnRvU3RyaW5nKCkpXG4gICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgdG9wPXsxOH0gbGVmdD17JzAlJ30gaGVpZ2h0PXszfSB3aWR0aD17JzMwJSd9XG4gICAgICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICBmb2N1c2VkXG4gICAgICAgICAgICAgICAgdmFsaWduPXsnbWlkZGxlJ31cbiAgICAgICAgICAgICAgICBhbGlnbj17J2NlbnRlcid9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3tiZzonI2ZmYWEwMCcsZmc6JyMzMzMzMzMnLGhvdmVyOntiZzonI2ZmZGQ4OCcsZmc6JyMzMzMzMzMnfX19XG4gICAgICAgICAgICAgICAgb25DbGljaz17Y29tbWl0U3RhZ2VkRmlsZXN9XG4gICAgICAgICAgICAgICAgY29udGVudD17J1xcbmNvbW1pdFxcbid9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgIHRvcD17MTh9IGxlZnQ9eyczNSUnfSBoZWlnaHQ9ezN9IHdpZHRoPXsnMzAlJ31cbiAgICAgICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgICAgICBpbnB1dFxuICAgICAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgICAgICB2YWxpZ249eydtaWRkbGUnfVxuICAgICAgICAgICAgICAgIGFsaWduPXsnY2VudGVyJ31cbiAgICAgICAgICAgICAgICBzdHlsZT17e2JnOicjZmZhYTAwJyxmZzonIzMzMzMzMycsaG92ZXI6e2JnOicjZmZkZDg4JyxmZzonIzMzMzMzMyd9fX1cbiAgICAgICAgICAgICAgICBvbkNsaWNrPXt0YWdMYXN0Q29tbWl0fVxuICAgICAgICAgICAgICAgIGNvbnRlbnQ9e2BcXG50YWcgJHtnaXRDdXJyZW50VGFnfVxcbmB9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgIHRvcD17MTh9IGxlZnQ9eyc3MCUnfSBoZWlnaHQ9ezN9IHdpZHRoPXsnMzAlJ31cbiAgICAgICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgICAgICBpbnB1dFxuICAgICAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgICAgICB2YWxpZ249eydtaWRkbGUnfVxuICAgICAgICAgICAgICAgIGFsaWduPXsnY2VudGVyJ31cbiAgICAgICAgICAgICAgICBzdHlsZT17e2JnOicjZmZhYTAwJyxmZzonIzMzMzMzMycsaG92ZXI6e2JnOicjZmZkZDg4JyxmZzonIzMzMzMzMyd9fX1cbiAgICAgICAgICAgICAgICBvbkNsaWNrPXtwdXNoQ29tbWl0c31cbiAgICAgICAgICAgICAgICBjb250ZW50PXsnXFxucHVzaFxcbid9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgICAgPGJveCBsYWJlbD17J0NvbW1pdHMnfSB0b3A9ezIxfSBib3JkZXI9e3sgdHlwZTogJ2xpbmUnIH19IG9uTW91c2U9eyhldmVudCk9PntcbiAgICAgICAgICAgICAgICBjb25zdCB7eCx5fT1ldmVudDtcbiAgICAgICAgICAgICAgICBzZXRDb21taXRNZXNzYWdlKHNhZmVTdHJpbmdpZnkoe3gseX0pKVxuICAgICAgICAgICAgfX0+XG4gICAgICAgICAgICAgICAgPGxpc3RcbiAgICAgICAgICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgICAgICAgICBpbnB1dFxuICAgICAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgICAgICAgICBzY3JvbGxiYXI9e3sgY2g6ICc9JywgdHJhY2s6IHsgZmc6J2JsdWUnLCBiZzogJ2dyZXknIH0gfX1cbiAgICAgICAgICAgICAgICAgICAgaXRlbXM9e2dpdENvbW1pdHN9XG4gICAgICAgICAgICAgICAgICAgIHN0eWxlPXt7c2VsZWN0ZWQ6IHtiZzogJ2JsdWUnfX19XG4gICAgICAgICAgICAgICAgICAgIG9uU2VsZWN0PXtvbkNvbW1pdFNlbGVjdH1cbiAgICAgICAgICAgICAgICAgICAgb25TZWxlY3RJdGVtPXtvbkNvbW1pdFNlbGVjdH1cbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9eydTdGF0dXMnfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIHttZXNzYWdlICYmIChcbiAgICAgICAgICAgICAgICA8TW9kYWxEaWFsb2dcbiAgICAgICAgICAgICAgICAgICAgdGl0bGU9XCJNZXNzYWdlXCJcbiAgICAgICAgICAgICAgICAgICAgb25DbG9zZT17KCkgPT4gc2V0TWVzc2FnZShmYWxzZSl9XG4gICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICA8dGV4dD57bWVzc2FnZX08L3RleHQ+XG4gICAgICAgICAgICAgICAgPC9Nb2RhbERpYWxvZz5cbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvYm94PlxuICAgICk7XG59XG4iLCJpbXBvcnQgUmVhY3QgZnJvbSAncmVhY3QnXG5cbmV4cG9ydCBmdW5jdGlvbiBFcnJvckZhbGxiYWNrKHsgZXJyb3IsIHJlc2V0RXJyb3JCb3VuZGFyeSB9KSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveFxuICAgICAgICAgICAgdG9wPVwiY2VudGVyXCJcbiAgICAgICAgICAgIGxlZnQ9XCJjZW50ZXJcIlxuICAgICAgICAgICAgd2lkdGg9XCI3NSVcIlxuICAgICAgICAgICAgaGVpZ2h0PVwiNzUlXCJcbiAgICAgICAgICAgIGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX1cbiAgICAgICAgICAgIHN0eWxlPXt7IGZnOiAncmVkJyB9fVxuICAgICAgICA+XG4gICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgcmlnaHQ9ezB9IHRvcD17MH0gd2lkdGg9ezl9IGhlaWdodD17MX1cbiAgICAgICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgICAgIG9uUHJlc3M9e3Jlc2V0RXJyb3JCb3VuZGFyeX1cbiAgICAgICAgICAgICAgICB2YWxpZ249eydtaWRkbGUnfVxuICAgICAgICAgICAgICAgIGFsaWduPXsnY2VudGVyJ31cbiAgICAgICAgICAgICAgICBzdHlsZT17e2JnOicjZmZhYTAwJyxmZzonIzMzMzMzMycsaG92ZXI6e2JnOicjZmZkZDg4JyxmZzonIzMzMzMzMyd9fX1cbiAgICAgICAgICAgICAgICBjb250ZW50PXsnY2xvc2UnfS8+XG4gICAgICAgICAgICA8Ym94IHRvcD17Mn0gbGVmdD17MH0+e2BTb21ldGhpbmcgd2VudCB3cm9uZzpcXG4ke2Vycm9yLm1lc3NhZ2V9XFxuJHtlcnJvci5zdGFja31gfTwvYm94PlxuICAgICAgICA8L2JveD5cbiAgICApXG59IiwiLy8gQXBwLmpzXG5pbXBvcnQgUmVhY3QsIHtDb21wb25lbnQsIHVzZVN0YXRlLCB1c2VFZmZlY3QsIHVzZVJlZn0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHtXb3Jrc3BhY2UsSU5vZGV9IGZyb20gJy4vV29ya3NwYWNlJztcbmltcG9ydCBNb2RhbERpYWxvZyBmcm9tICcuL01vZGFsRGlhbG9nLmpzeCc7XG5pbXBvcnQgeyBCb3hFbGVtZW50IGFzIGJveCwgVGV4dEVsZW1lbnQgYXMgdGV4dCxMaXN0RWxlbWVudCBhcyBsaXN0LEJ1dHRvbkVsZW1lbnQgYXMgYnV0dG9uIH0gZnJvbSAncmVhY3QtYmxlc3NlZCc7XG5pbXBvcnQgeyBHcmlkLEdyaWRJdGVtIH0gZnJvbSAncmVhY3QtYmxlc3NlZC1jb250cmliLTE3J1xuaW1wb3J0IEZvbGRlclBpY2tlckRpYWxvZyBmcm9tIFwiLi9Gb2xkZXJQaWNrZXJEaWFsb2dcIjtcbmltcG9ydCB7VGFiLCBWVGFic30gZnJvbSBcIi4vVlRhYnNcIjtcbmltcG9ydCB7Q29kZUJ1ZmZlckVkaXRvckNvbXBvbmVudH0gZnJvbSAnLi9Db2RlQnVmZmVyRWRpdG9yLmpzeCdcbmltcG9ydCB7R2l0Q29tcG9uZW50fSBmcm9tIFwiLi9HaXRDb21wb25lbnRcIjtcbmltcG9ydCB7IEVycm9yQm91bmRhcnkgfSBmcm9tICdyZWFjdC1lcnJvci1ib3VuZGFyeSdcbmltcG9ydCB7RXJyb3JGYWxsYmFja30gZnJvbSAnLi9FcnJvckZhbGxiYWNrJztcbmltcG9ydCBGaWxlVHJlZSBmcm9tIFwiLi9GaWxlVHJlZVwiO1xuaW1wb3J0IHtMaXN0Q29tcG9uZW50fSBmcm9tIFwiLi9MaXN0Q29tcG9uZW50XCI7XG5pbXBvcnQgeyBzYWZlU3RyaW5naWZ5IH0gZnJvbSAnLi91dGlsLmpzJztcbi8vIGltcG9ydCB7cGFyc2Vyc30gZnJvbSBcIi4vZ3JhbW1hcnNcIjtcbmNvbnN0IGxpc3RpbmdUb2tlbml6ZXJEZWZpbml0aW9uPXtcbiAgICBuYW1lOidsaXN0aW5nJyxcbiAgICBmbGFnczonbWcnLFxuICAgIGRlZmluaXRpb25zOntcbiAgICAgICAgXCJXaGl0ZXNwYWNlXCI6ICAgICB7c3R5bGU6IHtmZzond2hpdGUnfSxwYXR0ZXJuOi9cXHMrL21naX0sXG4gICAgICAgIFwiQ2xvc2VCdXR0b25cIjogICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovXFxbeF0vbWdpfSxcbiAgICAgICAgXCJOb2RlTmFtZVwiOiAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9bL2EtekEtWjAtOV89e31cXFtcXF0lKigpbSwuOjshP0B+LV0rL21naX0sXG4gICAgICAgIFwiV29yZFwiOiAgICAgICAgICAge3N0eWxlOiB7Zmc6J3llbGxvdyd9LHBhdHRlcm46L1xccy4rP1xccy9tZ2l9LFxuICAgIH1cbn1cbmV4cG9ydCBmdW5jdGlvbiBBcHAocHJvcHMpe1xuICAvLyBTb21lIENvbWVudFxuICBjb25zdCBvcGVuZWRGaWxlc1JlZj11c2VSZWYobnVsbCk7XG4gIGNvbnN0IFttZXNzYWdlLCBzZXRNZXNzYWdlXSA9IHVzZVN0YXRlKGZhbHNlKTtcbiAgY29uc3QgW3BpY2tGb2xkZXIsIHNldFBpY2tGb2xkZXJdID0gdXNlU3RhdGUoZmFsc2UpO1xuICBjb25zdCBbY3VycmVudEVkaXRvclRleHQsIHNldEN1cnJlbnRFZGl0b3JUZXh0XSA9IHVzZVN0YXRlKCcnKTtcbiAgY29uc3QgW3NlbGVjdGVkRmlsZSwgc2V0U2VsZWN0ZWRGaWxlXSA9IHVzZVN0YXRlKG51bGwpO1xuICBjb25zdCBbb3BlbmVkRmlsZXMsIHNldE9wZW5lZEZpbGVzXSA9IHVzZVN0YXRlKHt9KTtcbiAgY29uc3QgW2ZpbGVDb250ZW50LCBzZXRGaWxlQ29udGVudF0gICA9IHVzZVN0YXRlKCcnKTtcbiAgY29uc3QgW3Jvb3REaXIsIHNldFJvb3REaXJdICAgPSB1c2VTdGF0ZShwcm9jZXNzLmN3ZCgpKTtcbiAgY29uc3QgW2dpdFN0YXR1cywgc2V0R2l0U3RhdHVzXSA9IHVzZVN0YXRlKFtdKTtcblxuXG4gIGNvbnN0IG9uRmlsZVBhdGhTZWxlY3QgPSAoZXZlbnQpID0+IHtcbiAgICBzZXRNZXNzYWdlKGBmaWxlIHBhdGggc2VsZWN0ZWQgJHtldmVudC5jb250ZW50fSAke3Byb2Nlc3MuY3dkKCl9YClcbiAgfTtcbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7SU5vZGV9IG5vZGVcbiAgICAgKi9cbiAgY29uc3Qgc2VsZWN0RmlsZSA9IChub2RlKSA9PiB7XG4gICAgc2V0U2VsZWN0ZWRGaWxlKG5vZGUuZnVsbFBhdGgpXG4gICAgY29uc3QgbmV3T3BlbmVkRmlsZXM9ey4uLm9wZW5lZEZpbGVzfVxuICAgIG5ld09wZW5lZEZpbGVzW25vZGUuZnVsbFBhdGgucmVwbGFjZShyb290RGlyLCcnKV0gPSBub2RlXG4gICAgc2V0T3BlbmVkRmlsZXMobmV3T3BlbmVkRmlsZXMpXG4gICAgc2V0RmlsZUNvbnRlbnQoYExvYWRpbmcgJHtub2RlLnJlbFBhdGh9YClcbiAgICBub2RlLnJlYWRGaWxlKG5vZGUuZnVsbFBhdGgpLnRoZW4oc2V0RmlsZUNvbnRlbnQpO1xuICB9O1xuICAvKipcbiAgICpcbiAgICogQHBhcmFtIHtJTm9kZX0gZGlyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgY29uc3Qgc2VsZWN0RGlyID0gYXN5bmMgKGRpcikgPT4ge1xuICAgIHNldE1lc3NhZ2UoYGRpciBzZWxlY3RlZCAke09iamVjdC5rZXlzKGRpcil9YClcbiAgfTtcbiAgY29uc3Qgb25UZXh0RWRpdG9yU2F2ZSA9IChhLGIsYyk9PiB7XG4gICAgICBzZXRNZXNzYWdlKEpTT04uc3RyaW5naWZ5KHthLGIsY30pKVxuICB9XG4gIGNvbnN0IG9uVGV4dEVkaXRvckNhbmNlbCA9IChhLGIsYyk9PiB7XG4gICAgICBzZXRNZXNzYWdlKEpTT04uc3RyaW5naWZ5KHthLGIsY30pKVxuICB9XG4gIGNvbnN0IG9uQ3VycmVudEVkaXRvckNoYW5nZSA9ICh7ZWRpdG9yLGNoLGtleSxzY3JlZW5FdmVudCx2aWV3cG9ydH0pPT4ge1xuICAgIHNldEN1cnJlbnRFZGl0b3JUZXh0KHNhZmVTdHJpbmdpZnkoe2VkaXRvcjoge2N1cnNvcnM6ZWRpdG9yLmN1cnNvcnN9LHZpZXdwb3J0LGNoLGtleSxzY3JlZW5FdmVudH0pKVxuICB9XG4gIGNvbnN0IG9uQ29kZUVkaXRLZXlQcmVzcyA9IChjaCxrZXkpPT4ge1xuICAgIC8vIHNldEN1cnJlbnRFZGl0b3JUZXh0KEpTT04uc3RyaW5naWZ5KHtjaCxrZXl9KSlcbiAgfVxuICBjb25zdCBkZWJ1Z1ZpZXc9KCk9PntcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBgRGVidWc6XFxuJHsoJ3BhcnNlZCBzb21lIHRleHQnKX1gXG4gICAgICByZXR1cm4gPGJveCBjb250ZW50PXtjb250ZW50fS8+XG4gIH1cbiAgY29uc3QgbGlzdE9wZW5lZEZpbGVzPSgpPT57XG4gICAgICBpZihvcGVuZWRGaWxlc1JlZiA9PT0gbnVsbCkge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICAgIGlmKG9wZW5lZEZpbGVzUmVmLmN1cnJlbnQgPT09IG51bGwpIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG4gICAgICBjb25zdCBscG9zID0gb3BlbmVkRmlsZXNSZWYuY3VycmVudC5scG9zXG4gICAgICByZXR1cm4gT2JqZWN0LmtleXMob3BlbmVkRmlsZXMpLm1hcChcbiAgICAgICAgICBrID0+IHtcbiAgICAgICAgICAgICAgcmV0dXJuIGsucGFkRW5kKGxwb3Mud2lkdGgtNiwnICcpKydbeF0nXG4gICAgICAgICAgfVxuICAgICAgKVxuICB9XG5cbiAgICBjb25zdCBvblRva2VuQ2xpY2s9KGV2ZW50RGF0YSk9PntcbiAgICAgICAgY29uc3QgdHJlZURhdGEgPSBsaXN0T3BlbmVkRmlsZXMoKVxuICAgICAgICBjb25zdCB7bGluZXMsIHZpc2libGVMaW5lcywgbGluZSwgY3Vyc29yOnt4LHl9LGN1cnNvclNjcmVlbiwgYnVmZmVyLCB2aXNpYmxlQnVmZmVyLCBpbmRleCx0b2tlbnMsdG9rZW5VbmRlckN1cnNvcixwaHJhc2V9ID0gZXZlbnREYXRhXG5cbiAgICAgICAgbGV0IGsgPSBPYmplY3Qua2V5cyhvcGVuZWRGaWxlcylbeV1cbiAgICAgICAgbGV0IG5vZGUgPSBvcGVuZWRGaWxlc1trXTtcbiAgICAgICAgLy8gdGhyb3cgSlNPTi5zdHJpbmdpZnkoe25vZGUseX0sbnVsbCwgJyAnKVxuICAgICAgICAvLyBpZiAobm9kZS50eXBlLmluZGV4T2YoJ2QnKT4tMSkge1xuICAgICAgICBzd2l0Y2gocGhyYXNlLmZpbHRlcih2ID0+IHYhPT0nV2hpdGVzcGFjZScpLmpvaW4oXCIsXCIpKXtcbiAgICAgICAgICAgIGNhc2UgXCJXaGl0ZXNwYWNlLE5vZGVOYW1lXCI6XG4gICAgICAgICAgICBjYXNlIFwiTm9kZU5hbWUsQ2xvc2VCdXR0b25cIjpcbiAgICAgICAgICAgICAgICBzd2l0Y2goKHRva2VuVW5kZXJDdXJzb3J8fHt0eXBlOid1bmRlZmluZWQnfSkudHlwZSl7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgXCJOb2RlTmFtZVwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZWN0RmlsZShub2RlKVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OjAseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIkNsb3NlQnV0dG9uXCI6XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXdPcGVuZWRGaWxlcz17Li4ub3BlbmVkRmlsZXN9XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgbmV3T3BlbmVkRmlsZXNba107XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRPcGVuZWRGaWxlcyhuZXdPcGVuZWRGaWxlcylcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYENsb3NlXFxuJHtub2RlLmZ1bGxQYXRofSBzZWxlY3RlZEZpbGU6JHtzZWxlY3RlZEZpbGV9IG5vZGUuZnVsbFBhdGg6JHtub2RlLmZ1bGxQYXRofSBgKVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYoc2VsZWN0ZWRGaWxlID09PSBub2RlLmZ1bGxQYXRoKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBrID0gT2JqZWN0LmtleXMob3BlbmVkRmlsZXMpW3ktMV1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBub2RlID0gb3BlbmVkRmlsZXNba107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0U2VsZWN0ZWRGaWxlKG5vZGUuZnVsbFBhdGgpXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgcGhyYXNlIFN0cnVjdHVyZSAnJHtwaHJhc2V9J2ApXG4gICAgICAgIH1cbiAgICB9XG4gIHJldHVybiAoXG4gICAgICA8PlxuICAgICAgPEdyaWQgcm93cz17OH0gY29scz17MTV9IGhpZGVCb3JkZXI+XG4gICAgICAgICAgPFZUYWJzIHJvdz17MH0gY29sPXswfSByb3dTcGFuPXs4fSBjb2xTcGFuPXs1fT5cbiAgICAgICAgICAgICAgPFRhYiBuYW1lPSdQcm9qZWN0Jz5cbiAgICAgICAgICAgICAgICAgIDxHcmlkIHJvd3M9ezh9IGNvbHM9ezF9PlxuICAgICAgICAgICAgICAgICAgPGJveCBrZXk9ezF9IHJvdz17MH0gY29sPXswfSByb3dTcGFuPXszfSBjb2xTcGFuPXsxfVxuICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17J29wZW5lZCBGaWxlcyd9ICByZWY9e29wZW5lZEZpbGVzUmVmfT5cbiAgICAgICAgICAgICAgICAgICAgICA8TGlzdENvbXBvbmVudFxuICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5lcz17bGlzdE9wZW5lZEZpbGVzKCl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHRUZXh0PXsnJ31cbiAgICAgICAgICAgICAgICAgICAgICAgICAga2V5cyBtb3VzZSBzY3JvbGwgc3R5bGU9e3sgc2VsZWN0ZWQ6IHsgYmc6ICdibHVlJyB9IH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHNjcm9sbGJhcj17eyBjaDogJz0nLCB0cmFjazogeyBmZzonYmx1ZScsIGJnOiAnZ3JleScgfSB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICBvblRva2VuQ2xpY2s9e29uVG9rZW5DbGlja31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgdG9rZW5pemVyRGVmPXtsaXN0aW5nVG9rZW5pemVyRGVmaW5pdGlvbn1cbiAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICA8Ym94IGtleT17Mn1cbiAgICAgICAgICAgICAgICAgICAgICAgcm93PXszfSBjb2w9ezB9IHJvd1NwYW49ezV9IGNvbFNwYW49ezF9XG4gICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXsnUHJvamVjdCd9PlxuXG4gICAgICAgICAgICAgICAgICAgICAgPEZpbGVUcmVlXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRvcD17MH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgYm90dG9tPXswfVxuICAgICAgICAgICAgICAgICAgICAgICAgICByb290RGlyPXtyb290RGlyfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBvbkRpclNlbGVjdD17c2VsZWN0RGlyfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBvbkZpbGVTZWxlY3Q9e3NlbGVjdEZpbGV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXsnUHJvamVjdCd9XG4gICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYm90dG9tPXswfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGVpZ2h0PXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXsnbWlkZGxlJ31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsaWduPXsnY2VudGVyJ31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0eWxlPXt7Ymc6JyNmZmFhMDAnLGZnOicjMzMzMzMzJyxob3Zlcjp7Ymc6JyNmZmRkODgnLGZnOicjMzMzMzMzJ319fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldFBpY2tGb2xkZXIodHJ1ZSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50PXsnd29ya3NwYWNlJ30vPlxuICAgICAgICAgICAgICAgICAgICAgIDwvRmlsZVRyZWU+XG4gICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgIDwvR3JpZD5cbiAgICAgICAgICAgICAgPC9UYWI+XG4gICAgICAgICAgICAgIDxUYWIgbmFtZT0nR2l0Jz5cbiAgICAgICAgICAgICAgICAgIDxHaXRDb21wb25lbnQgcm9vdERpcj17cm9vdERpcn0gcm93PXswfSBjb2w9ezF9IHJvd1NwYW49ezF9IGNvbFNwYW49ezV9Lz5cbiAgICAgICAgICAgICAgPC9UYWI+XG4gICAgICAgICAgICAgIDxUYWIgbmFtZT17J0RlYnVnJ30+XG4gICAgICAgICAgICAgICAgICA8Ym94PlxuICAgICAgICAgICAgICAgICAgICAgIHtkZWJ1Z1ZpZXcoKX1cbiAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICA8L1RhYj5cbiAgICAgICAgICAgICAgPFRhYiBuYW1lPXsnUXVpdCd9IG9uVGFiQ2xpY2s9eygpPT57cHJvY2Vzcy5leGl0KDApfX0+XG4gICAgICAgICAgICAgICAgICA8Ym94IG9uVGFiQ2xpY2s9eygpPT57cHJvY2Vzcy5leGl0KDApfX0+XG4gICAgICAgICAgICAgICAgICAgICAge2RlYnVnVmlldygpfVxuICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgIDwvVGFiPlxuICAgICAgICAgIDwvVlRhYnM+XG4gICAgICAgICAgey8qIENlbnRlciBwYW5lbCAqL31cbiAgICAgICAgICA8Q29kZUJ1ZmZlckVkaXRvckNvbXBvbmVudCByb3c9ezB9IGNvbD17NX0gcm93U3Bhbj17Nn0gY29sU3Bhbj17MTB9XG4gICAgICAgICAgICAgICAgICAgICAgYm9yZGVyPXt7IHR5cGU6ICdsaW5lJyB9fVxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXsoc2VsZWN0ZWRGaWxlIHx8ICdObyBmaWxlIHNlbGVjdGVkJykucmVwbGFjZShyb290RGlyLCcnKX1cbiAgICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aD17c2VsZWN0ZWRGaWxlfHxudWxsfVxuICAgICAgICAgICAgICAgICAgICAgIG9uS2V5cHJlc3M9e29uQ29kZUVkaXRLZXlQcmVzc31cbiAgICAgICAgICAgICAgICAgICAgICBvbkNoYW5nZT17b25DdXJyZW50RWRpdG9yQ2hhbmdlfVxuICAgICAgICAgICAgICAgICAgICAgIG9uRXZlbnQ9e29uQ3VycmVudEVkaXRvckNoYW5nZX1cbiAgICAgICAgICAvPlxuICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgcm93PXs2fSBjb2w9ezV9IHJvd1NwYW49ezJ9IGNvbFNwYW49ezEwfVxuICAgICAgICAgICAgICBib3JkZXI9e3sgdHlwZTogJ2xpbmUnIH19XG4gICAgICAgICAgICAgIHNjcm9sbGFibGVcbiAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgICAgbGFiZWw9eydUZXJtaW5hbCd9XG4gICAgICAgICAgICAgIG92ZXJmbG93PXsnc2Nyb2xsJ31cbiAgICAgICAgICA+XG4gICAgICAgICAgICAgIHtjdXJyZW50RWRpdG9yVGV4dH1cbiAgICAgICAgICA8L2JveD5cbiAgICAgICAgICB7Lyo8TGF5b3V0Q2F0Y2hlciAgcm93PXswfSBjb2w9ezV9IHJvd1NwYW49ezZ9IGNvbFNwYW49ezEwfS8+Ki99XG4gICAgICAgIDwvR3JpZD5cbiAgICAgICAge21lc3NhZ2UgJiYgKFxuICAgICAgICAgICAgPE1vZGFsRGlhbG9nXG4gICAgICAgICAgICAgICAgbGFiZWw9eydNZXNzYWdlJ31cbiAgICAgICAgICAgICAgICB0aXRsZT1cIk1lc3NhZ2VcIlxuICAgICAgICAgICAgICAgIG9uQ2xvc2U9eygpID0+IHNldE1lc3NhZ2UoZmFsc2UpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICA8dGV4dD57bWVzc2FnZX08L3RleHQ+XG4gICAgICAgICAgICA8L01vZGFsRGlhbG9nPlxuICAgICAgICApfVxuICAgICAgICB7cGlja0ZvbGRlciAmJlxuICAgICAgICAgICAgKDxFcnJvckJvdW5kYXJ5XG4gICAgICAgICAgICAgICAgRmFsbGJhY2tDb21wb25lbnQ9e0Vycm9yRmFsbGJhY2t9XG4gICAgICAgICAgICAgICAgb25SZXNldD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBzZXRQaWNrRm9sZGVyKGZhbHNlKVxuICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgb25DbG9zZT17KCkgPT4gc2V0UGlja0ZvbGRlcihmYWxzZSl9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICA8Rm9sZGVyUGlja2VyRGlhbG9nXG4gICAgICAgICAgICAgICAgdGl0bGU9XCJQaWNrIEZvbGRlclwiXG4gICAgICAgICAgICAgICAgb25Gb2xkZXJTZWxlY3Q9eyhpbm9kZSk9PntcbiAgICAgICAgICAgICAgICAgICAgc2V0UGlja0ZvbGRlcihmYWxzZSlcbiAgICAgICAgICAgICAgICAgICAgaWYoaW5vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYHNlbGVjdGVkIGZvbGRlciAke2lub2RlLmZ1bGxQYXRofWApXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRSb290RGlyKGlub2RlLmZ1bGxQYXRoKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L0Vycm9yQm91bmRhcnk+KVxuICAgICAgICB9XG4gICAgPC8+XG4gICk7XG59XG4iLCIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgJ3JhZi9wb2x5ZmlsbCc7XG5pbXBvcnQgYmxlc3NlZCBmcm9tICduZW8tYmxlc3NlZCdcbmltcG9ydCB7IHJlbmRlciB9IGZyb20gJ3JlYWN0LWJsZXNzZWQnO1xuaW1wb3J0IHtBcHB9IGZyb20gJy4vc3JjL0FwcCc7XG5pbXBvcnQgZnMgZnJvbSAnZnMnXG5pbXBvcnQgXCJuZW8tYmxlc3NlZC9saWIvd2lkZ2V0cy9ub2RlXCI7ICAgICAgIC8vIGxpdGVyYWwgcGF0aCBzbyB0cmVlLXNoYWtlciBrZWVwcyBpdFxuaW1wb3J0IFwibmVvLWJsZXNzZWQvbGliL3dpZGdldHMvZWxlbWVudFwiOyAgICAvLyBhZGQgb3RoZXJzIGlmIHlvdXIgY29kZSByZWFjaGVzIHRoZW1cbmltcG9ydCBcIm5lby1ibGVzc2VkL2xpYi93aWRnZXRzL3NjcmVlblwiOyAgICAgICAvLyBsaXRlcmFsIHBhdGggc28gdHJlZS1zaGFrZXIga2VlcHMgaXRcbmltcG9ydCBcIm5lby1ibGVzc2VkL2xpYi9ibGVzc2VkXCI7ICAgIC8vIGFkZCBvdGhlcnMgaWYgeW91ciBjb2RlIHJlYWNoZXMgdGhlbVxuXG5jb25zdCBzY3JlZW4gPSBibGVzc2VkLnNjcmVlbih7XG4gIHNtYXJ0Q1NSOiB0cnVlLFxuICBhdXRvUGFkZGluZzogdHJ1ZSxcbiAgdGl0bGU6ICdSZWFjdC1CbGVzc2VkIElERScsXG4gIGR1bXA6ICd0ZXJtaW5hbC1kdW1wLmxvZydcbn0pO1xuXG4vLyBxdWl0IG9uIEN0cmwrQ1xuc2NyZWVuLmtleShbXCJDLXFcIiwgJ2YxMiddLCAoKSA9PiBwcm9jZXNzLmV4aXQoMCkpO1xuc2NyZWVuLmtleShbXCJDLXNcIiwgXCJDLVMtc1wiLCAnZjgnXSwgKCkgPT4ge1xuICAvLyBhZnRlciB5b3XigJl2ZSBjcmVhdGVkIHlvdXIgc2NyZWVu4oCmXG4gIGNvbnN0IGR1bXAgPSBzY3JlZW4uc2NyZWVuc2hvdCgpOyAgICAgIC8vIHdob2xlIHNjcmVlblxuLy8gb3IgbGltaXQgdG8gYSByZWdpb246IHNjcmVlbnNob3QoeDEsIHgyLCB5MSwgeTIpXG4gIGZzLndyaXRlRmlsZVN5bmMoJ2J1ZmZlci5zZ3InLCBkdW1wLCAndXRmOCcpO1xuICBjb25zb2xlLmxvZygnV3JvdGUgU0dSIGR1bXAgdG8gYnVmZmVyLnNncicpO1xuICAvLyBuZXcgTWVzc2FnZSgpLmRpc3BsYXkoJ0J1ZmZlciBzYXZlZCEnLCAxLCAoKSA9PiBzY3JlZW4ucmVuZGVyKCkpO1xufSk7XG5zY3JlZW4uZW5hYmxlTW91c2UoKVxuXG5yZW5kZXIoPEFwcCAvPiwgc2NyZWVuKTsiXSwibmFtZXMiOlsiZnMiLCJ1c2VSZWYiLCJ1c2VFZmZlY3QiLCJqc3hzIiwianN4IiwiZGVmYXVsdFRleHQiLCJlZGl0b3IiLCJzZXRFZGl0b3IiLCJ1c2VTdGF0ZSIsImJveCIsImxpc3RpbmdUb2tlbml6ZXJEZWZpbml0aW9uIiwibGluZXMiLCJ3ayIsImN1cnNvciIsIkZyYWdtZW50IiwiR3JpZCIsIkVycm9yQm91bmRhcnkiLCJyZW5kZXIiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBTUEsTUFBTSxjQUFZLENBQUMsU0FBUTtBQUN6QixRQUFNLFVBQVE7QUFBQSxJQUNaLEtBQUk7QUFBQTtBQUFBLElBQ0osS0FBSTtBQUFBO0FBQUEsSUFDSixLQUFJO0FBQUE7QUFBQSxJQUNKLEtBQUk7QUFBQTtBQUFBLElBQ0osS0FBSTtBQUFBO0FBQUEsSUFDSixLQUFJO0FBQUE7QUFBQSxJQUNKLEtBQUk7QUFBQTtBQUFBLEVBQ1I7QUFDRSxRQUFNLEtBQUcsS0FBSyxLQUFLLFFBQVEsT0FBTSxFQUFFO0FBQ25DLFNBQU8sR0FBRyxLQUFLLGlCQUFpQixNQUFNLEdBQUcsRUFBRSxJQUFJLFFBQU0sS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLEdBQUcsQ0FBQyxJQUFJLFFBQVEsRUFBRSxDQUFDLElBQUksS0FBSyxJQUFJO0FBQ3ZHO0FBQ0EsTUFBTSxnQkFBYyxDQUFDLElBQUcsT0FBTztBQUM3QixRQUFNLEtBQUssWUFBWSxFQUFFO0FBQ3pCLFFBQU0sS0FBRyxZQUFZLEVBQUU7QUFDdkIsU0FBTyxLQUFHLEtBQUcsS0FBSSxPQUFLLEtB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
