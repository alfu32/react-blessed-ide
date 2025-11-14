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
  htmx: { name: "htmx", flags: "mg", definitions: {
    TagDelim: { style: { fg: "#FFDD00" }, pattern: /<|<\/|\/>|>/ig },
    AttributeName: { style: { fg: "cyan" }, pattern: /[0-9a-zA-Z:@-]*/ig },
    Equal: { style: { fg: "magenta" }, pattern: /=/ig },
    JsxValue: { style: { fg: "green" }, pattern: /\{.*?}/mig, subtokenizer: "js" },
    AttributeValue: { style: { fg: "yellow" }, pattern: /".*?"/mig },
    Whitespace: { style: { fg: "white" }, pattern: /\s+/mig },
    Others: { style: { fg: "white" }, pattern: /.*?/mig }
  } },
  jsx: { name: "jsx", flags: "mg", definitions: {
    ReactToken: { style: { fg: "#FFDD00" }, pattern: /\buse[A-Z][a-z]*\b/mig },
    Keyword: { style: { fg: "magenta" }, pattern: /\b(as|from|default|const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw|switch|case|break|continue)\b/mig },
    JsxEndTag: { style: { fg: "yellow" }, pattern: /<\/[a-zA-Z-]*>/mig },
    JsxStartTag: { style: { fg: "yellow" }, pattern: /<[a-zA-Z-]*.*?>/mig, subtokenizer: "htmx" },
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
      const gt = TokenizerToken.fromRegexpMatch(m, tokenizerDef, tokenizerDef.name, lineNumber);
      tokens.push(gt);
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
  /** @param {number} x @param {number} y @param {number} w @param {number} h */
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }
  /** @param {CodeBufferEditor} editor */
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
    this.x = typeof x === "number" ? x : -1;
    this.y = typeof y === "number" ? y : -1;
    this.char = typeof char === "string" ? char : "-";
    this.style = style || {};
  }
  /** @param {Rectangle} visibleArea */
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
  /** @type {CursorPoint} */
  start = new CursorPoint();
  /** @type {CursorPoint} */
  end = new CursorPoint();
  /** @param {CursorPoint} start */
  constructor(start) {
    this.start = start.copy();
  }
  /** @param {Rectangle} visibleArea */
  isVisible(visibleArea) {
    return this.start.isVisible(visibleArea) || this.end.isVisible(visibleArea);
  }
  /** @param {CursorPoint} val */
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
    this._saveTimeout = 0;
    this._saved = "";
    this.cursors = [];
    this.selectStart = null;
    this.selections = [];
    this.setFilePath(filePath);
  }
  // ── file / tokens ────────────────────────────────────────────────────────────
  setFilePath(filePath) {
    this.filePath = filePath;
    const ext = (filePath.split(".").pop() || "").toLowerCase();
    this.tokenizer = getNamedTokenizer(ext);
    this.lines = fs.readFileSync(filePath, { encoding: "utf-8" }).split("\n");
    this.updateTokens();
  }
  save() {
    clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      fs.writeFileSync(this.filePath, this.lines.join("\n"));
      this._saved = `saved ${(/* @__PURE__ */ new Date()).toISOString()}`;
    }, 1e3);
  }
  /** @param {number} lineNumber */
  updateTokensLine(lineNumber) {
    if (lineNumber < 0 || lineNumber >= this.lines.length) return;
    this.tokens[lineNumber] = this.tokenizer(this.lines[lineNumber], lineNumber) || [];
  }
  updateTokens() {
    this.tokens = this.lines.map((line, i) => this.tokenizer(line, i) || []);
  }
  // ── viewport ────────────────────────────────────────────────────────────────
  scrollViewport(n) {
    const maxY = Math.max(0, this.lines.length - this.viewportHeight);
    this.viewportY = clamp(this.viewportY + n, 0, maxY);
  }
  _ensureCursorInView(cursor) {
    if (cursor.y < this.viewportY) this.viewportY = cursor.y;
    else if (cursor.y >= this.viewportY + this.viewportHeight) this.viewportY = cursor.y - this.viewportHeight + 1;
    if (cursor.x < this.viewportX) this.viewportX = cursor.x;
    else if (cursor.x >= this.viewportX + this.viewportWidth) this.viewportX = cursor.x - this.viewportWidth + 1;
  }
  _computePadLength() {
    return Math.ceil(Math.log10(Math.max(1, this.viewportHeight + this.viewportY))) + 1;
  }
  _screenToCursor(screenEvent, viewportPosition) {
    const { xi, yi } = viewportPosition;
    const pad = this._computePadLength();
    const cx = screenEvent.x - xi - pad - 3 + this.viewportX;
    const cy = screenEvent.y - yi - 1 + this.viewportY;
    return this.getCursor({ x: cx, y: cy });
  }
  // ── token-aware cursor ──────────────────────────────────────────────────────
  /** @returns {CursorPoint} */
  getCursor({ x, y }) {
    const maxY = Math.max(0, this.lines.length - 1);
    y = clamp(parseInt(y ?? 0, 10), 0, maxY);
    const line = this.lines[y] ?? "";
    x = clamp(parseInt(x ?? 0, 10), 0, line.length);
    const crs = new CursorPoint(x, y, line[x] ?? " ");
    const lineTokens = this.tokens[y] || [];
    const tk = lineTokens.find(
      (t) => t && typeof t.start !== "undefined" && typeof t.end !== "undefined" && x >= +t.start && x <= +t.end
    );
    crs.style = tk && tk.style ? tk.style : { fg: "#ff0000", bg: "#ffff44" };
    return crs;
  }
  /** @returns {{[lineId:string]:TokenizerToken[]}} */
  renderViewport() {
    const out = {};
    const y0 = this.viewportY, y1 = this.viewportY + this.viewportHeight;
    for (let i = y0; i <= Math.min(y1, this.lines.length - 1); i++) out[i] = this.tokens[i];
    return out;
  }
  // ── mouse ──────────────────────────────────────────────────────────────────
  onMouse(screenEvent, viewportPosition) {
    let hasChanged = false;
    let mustRender = false;
    const clicks = Array.from(screenEvent.buf || []).filter((v) => v === 77).length;
    switch (screenEvent.action) {
      case "mousedown": {
        const crs = this._screenToCursor(screenEvent, viewportPosition);
        this.selectStart = new CodeBufferEditorSelection(crs);
        this.selectStart.setEnd(crs);
        if (screenEvent.meta) this.cursors.push(crs);
        else this.cursors = [crs];
        hasChanged = true;
        break;
      }
      case "mousemove": {
        if (this.selectStart) this.selectStart.setEnd(this._screenToCursor(screenEvent, viewportPosition));
        mustRender = true;
        break;
      }
      case "mouseup": {
        if (this.selectStart) {
          if (screenEvent.meta) this.selections.push(this.selectStart.copy());
          else this.selections = [this.selectStart.copy()];
        }
        hasChanged = true;
        this.selectStart = null;
        break;
      }
      case "wheelup":
        this.scrollViewport(-clicks);
        mustRender = true;
        break;
      case "wheeldown":
        this.scrollViewport(+clicks);
        mustRender = true;
        break;
      default:
        throw new Error(safeStringify(screenEvent));
    }
    return [hasChanged, mustRender];
  }
  // ── keyboard ───────────────────────────────────────────────────────────────
  onKey(ch, key, onChange = () => {
  }) {
    let hasChanged = false;
    let mustRender = false;
    const moveAll = (fn) => {
      this.cursors = this.cursors.map((crs) => fn(crs));
    };
    switch (key.full) {
      case "up":
        moveAll((crs) => this.moveCursorUp(crs));
        if (!key.meta) this.selectStart = null;
        mustRender = true;
        break;
      case "down":
        moveAll((crs) => this.moveCursorDown(crs));
        if (!key.meta) this.selectStart = null;
        mustRender = true;
        break;
      case "left":
        if (key.ctrl) moveAll((crs) => this._wordLeft(crs));
        else moveAll((crs) => this.moveCursorLeft(crs));
        if (!key.meta) this.selectStart = null;
        mustRender = true;
        break;
      case "right":
        if (key.ctrl) moveAll((crs) => this._wordRight(crs));
        else moveAll((crs) => this.moveCursorRight(crs));
        if (!key.meta) this.selectStart = null;
        mustRender = true;
        break;
      case "home":
        moveAll((crs) => this.getCursor({ x: 0, y: crs.y }));
        mustRender = true;
        break;
      case "end":
        moveAll((crs) => this.getCursor({ x: this.lines[crs.y].length, y: crs.y }));
        mustRender = true;
        break;
      case "pageup":
        this.scrollViewport(-this.viewportHeight);
        mustRender = true;
        break;
      case "pagedown":
        this.scrollViewport(+this.viewportHeight);
        mustRender = true;
        break;
      case "backspace":
        this.cursors.forEach((crs) => this.backspace(crs));
        hasChanged = true;
        break;
      case "delete":
        this.cursors.forEach((crs) => this.delete(crs));
        hasChanged = true;
        break;
      case "return":
        this._forEachSortedCursor((crs, i) => {
          crs.y += i;
          this.insert("\n", crs);
          crs.y += 1;
          crs.x = 0;
        });
        hasChanged = true;
        break;
      case "tab":
        this._forEachSortedCursor((crs) => {
          this.insert("	", crs);
        });
        hasChanged = true;
        break;
      case "C-c": {
        const text = this.selections.flatMap((s) => {
          const lines = [];
          const y0 = Math.min(s.start.y, s.end.y), y1 = Math.max(s.start.y, s.end.y);
          const x0 = Math.min(s.start.x, s.end.x), x1 = Math.max(s.start.x, s.end.x);
          for (let y = y0; y <= y1; y++) {
            const line = this.lines[y] ?? "";
            const from = y === y0 ? x0 : 0;
            const to = y === y1 ? x1 + 1 : line.length;
            lines.push(line.substring(from, to));
          }
          return lines;
        }).join("\n");
        copyPaste.copy(text, () => {
        });
        break;
      }
      case "C-p": {
        throw new Error("paste operation not implemented");
      }
      default: {
        const printable = key.sequence && key.sequence.length === 1 ? key.sequence : key.name && key.name.length === 1 ? key.name : ch && ch.length ? ch : "";
        if (printable) {
          this.cursors.forEach((crs) => this.insert(printable, crs));
          hasChanged = true;
        }
      }
    }
    if (hasChanged) this.save();
    return [hasChanged, mustRender];
  }
  _forEachSortedCursor(fn) {
    this.cursors.toSorted((a, b) => a.y - b.y).forEach(fn);
  }
  // ── movement ────────────────────────────────────────────────────────────────
  /** @param {CursorPoint} cursor */
  moveCursorUp(cursor) {
    if (cursor.y > 0) {
      cursor.y--;
      const line = this.lines[cursor.y] ?? "";
      cursor.x = Math.min(cursor.x, line.length);
      this._ensureCursorInView(cursor);
    }
    return cursor;
  }
  /** @param {CursorPoint} cursor */
  moveCursorDown(cursor) {
    if (cursor.y + 1 < this.lines.length) {
      const next = this.lines[cursor.y + 1] ?? "";
      cursor.x = Math.min(cursor.x, next.length);
      cursor.y++;
      this._ensureCursorInView(cursor);
    }
    return cursor;
  }
  /** @param {CursorPoint} cursor */
  moveCursorLeft(cursor) {
    if (cursor.x > 0) {
      cursor.x--;
      this._ensureCursorInView(cursor);
    }
    return cursor;
  }
  /** @param {CursorPoint} cursor */
  moveCursorRight(cursor) {
    const line = this.lines[cursor.y] ?? "";
    cursor.x = Math.min(cursor.x + 1, line.length);
    this._ensureCursorInView(cursor);
    return cursor;
  }
  _wordLeft(cursor) {
    const line = this.lines[cursor.y] ?? "";
    let x = cursor.x - 1;
    while (x > 0 && line[x] === " ") x--;
    while (x > 0 && line[x - 1] && /\w/.test(line[x - 1])) x--;
    cursor.x = clamp(x, 0, line.length);
    this._ensureCursorInView(cursor);
    return cursor;
  }
  _wordRight(cursor) {
    const line = this.lines[cursor.y] ?? "";
    let x = cursor.x;
    while (x < line.length && line[x] === " ") x++;
    while (x < line.length && /\w/.test(line[x])) x++;
    cursor.x = clamp(x, 0, line.length);
    this._ensureCursorInView(cursor);
    return cursor;
  }
  moveCursorVertically(n, cursor) {
    if (n === 0) return cursor;
    const dir = Math.sign(n);
    for (let i = 0; i < Math.abs(n); i++) {
      if (dir > 0) this.moveCursorDown(cursor);
      else this.moveCursorUp(cursor);
    }
    return cursor;
  }
  // ── edits ──────────────────────────────────────────────────────────────────
  /** @param {string} text @param {CursorPoint} cursor */
  insert(text, cursor) {
    const line = this.lines[cursor.y] ?? "";
    const before = line.substring(0, cursor.x);
    const after = line.substring(cursor.x);
    const parts = String(text).split("\n");
    if (parts.length === 1) {
      this.lines[cursor.y] = before + parts[0] + after;
      this.updateTokensLine(cursor.y);
      cursor.x += parts[0].length;
    } else {
      const first = before + parts[0];
      const middle = parts.slice(1, -1);
      const last = parts[parts.length - 1] + after;
      const newLines = [first, ...middle, last];
      this.lines.splice(cursor.y, 1, ...newLines);
      for (let i = 0; i < newLines.length; i++) this.updateTokensLine(cursor.y + i);
      cursor.y += parts.length - 1;
      cursor.x = parts[parts.length - 1].length;
    }
    this._ensureCursorInView(cursor);
    return this;
  }
  /** delete char at cursor, or join with next line if at EOL */
  delete(cursor) {
    const line = this.lines[cursor.y] ?? "";
    if (cursor.x === line.length) {
      if (cursor.y >= this.lines.length - 1) return this;
      const nextLine = this.lines[cursor.y + 1] ?? "";
      this.lines.splice(cursor.y, 2, line + nextLine);
      this.updateTokensLine(cursor.y);
    } else {
      this.lines[cursor.y] = line.substring(0, cursor.x) + line.substring(cursor.x + 1);
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
      const prevLen = (this.lines[cursor.y - 1] ?? "").length;
      cursor.y--;
      cursor.x = prevLen;
      this.delete(cursor);
      this.updateTokensLine(cursor.y);
    }
    this._ensureCursorInView(cursor);
    return this;
  }
  // ── clone ──────────────────────────────────────────────────────────────
  /** return a new instance with identical state */
  copy() {
    const clone = new CodeBufferEditor(this.filePath, { rows: this.viewportHeight, cols: this.viewportWidth });
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
    const visible = Object.keys(this.renderViewport());
    const first = visible[0] ?? 0;
    const last = visible[visible.length - 1] ?? 0;
    const json = {
      cursor: this.cursors,
      v: { x: this.viewportX, y: this.viewportY, w: this.viewportWidth, h: this.viewportHeight },
      s: this._saved,
      l: `${first} ... ${last}`
    };
    return JSON.stringify(json).replace(/"/gi, "");
  }
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
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
    /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        mouse: true,
        focused: true,
        clickable: true,
        onClick: decMajor,
        height: 1,
        left: 1,
        width: 1,
        content: "v"
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        mouse: true,
        focused: true,
        clickable: true,
        onClick: incMajor,
        height: 1,
        left: 2,
        width: semver.major.length,
        content: semver.major
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        mouse: true,
        focused: true,
        clickable: true,
        onClick: decMinor,
        height: 1,
        left: 2 + semver.major.length,
        width: 1,
        content: "."
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        mouse: true,
        focused: true,
        clickable: true,
        onClick: incMinor,
        height: 1,
        left: 3 + semver.major.length,
        width: semver.minor.length,
        content: semver.minor
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        mouse: true,
        focused: true,
        clickable: true,
        onClick: decPatch,
        height: 1,
        left: 3 + semver.major.length + semver.minor.length,
        width: 1,
        content: "."
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        mouse: true,
        focused: true,
        clickable: true,
        onClick: incPatch,
        height: 1,
        left: 4 + semver.major.length + semver.minor.length,
        width: semver.patch.length,
        content: semver.patch
      }
    )
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
const tag = "2.5.2";
const commit = "decc5fdd1cf4ebadc325aeb9f97d7eb3aec8b589";
const branch = "work";
const time = "2025-08-26 11:10:11";
const version = {
  tag,
  commit,
  branch,
  time
};
const screen = blessed.screen({
  smartCSR: true,
  autoPadding: true,
  title: `EDY v${version.tag} (${version.branch}${version.commit.substring(0, 8)}) t ${version.time}`,
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlcyI6WyIuLi9zcmMvV29ya3NwYWNlLmpzIiwiLi4vc3JjL01vZGFsRGlhbG9nLmpzeCIsIi4uL3NyYy91dGlsLmpzIiwiLi4vc3JjL3Rva2VuaXplci5qcyIsIi4uL3NyYy9TaW1wbGVUZXh0RWRpdG9yLmpzIiwiLi4vc3JjL0xpc3RDb21wb25lbnQuanN4IiwiLi4vc3JjL0ZpbGVUcmVlLmpzeCIsIi4uL3NyYy9Gb2xkZXJQaWNrZXJEaWFsb2cuanN4IiwiLi4vc3JjL1ZUYWJzLmpzeCIsIi4uL3NyYy9Db2RlQnVmZmVyRWRpdG9yLmpzIiwiLi4vc3JjL0NvZGVCdWZmZXJFZGl0b3IuanN4IiwiLi4vc3JjL0dpdENvbXBvbmVudC5zZXJ2aWNlLmpzIiwiLi4vc3JjL1NpbXBsZVRleHRFZGl0b3IuanN4IiwiLi4vc3JjL1NlbXZlci5qcyIsIi4uL3NyYy9TZW12ZXIuanN4IiwiLi4vc3JjL0dpdENvbXBvbmVudC5qc3giLCIuLi9zcmMvRXJyb3JGYWxsYmFjay5qc3giLCIuLi9zcmMvQXBwLmpzeCIsIi4uL2luZGV4LmpzeCJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBzZXJ2aWNlcy9Xb3Jrc3BhY2UuanNcblxuaW1wb3J0IHsgcHJvbWlzZXMgYXMgZnMgfSBmcm9tICdmcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBpZ25vcmUgZnJvbSAnaWdub3JlJztcblxuY29uc3QgaW5vZGVTb3J0Qnk9KG5vZGUpPT4ge1xuICBjb25zdCBtYXBwaW5nPXtcbiAgICAnZCc6MSwvLyBEaXJlY3RvcnlcbiAgICAnZic6MiwvLyBGaWxlXG4gICAgJ2wnOjIsLy8gU3ltYm9saWNMaW5rXG4gICAgJ2InOjIsLy8gQmxvY2tEZXZpY2VcbiAgICAnYyc6MiwvLyBDaGFyYWN0ZXJEZXZpY2VcbiAgICAncCc6MiwvLyBGSUZPXG4gICAgJ3MnOjIsLy8gU29ja2V0XG4gIH1cbiAgY29uc3QgbnQ9bm9kZS50eXBlLnJlcGxhY2UoLy0vZ2ksJycpXG4gIHJldHVybiBgJHtub2RlLnBhcmVudEZ1bGxOYW1lKCkuc3BsaXQoJy8nKS5tYXAobm4gPT4gYDF8JHtubn1gKS5qb2luKFwiL1wiKX0vJHttYXBwaW5nW250XX18JHtub2RlLm5hbWV9YFxufVxuY29uc3QgY29tcGFyZUlub2Rlcz0obmEsbmIpID0+IHtcbiAgY29uc3Qgc2EgPSBpbm9kZVNvcnRCeShuYSlcbiAgY29uc3Qgc2I9aW5vZGVTb3J0QnkobmIpXG4gIHJldHVybiBzYTxzYj8tMTooc2E9PT1zYik/MDoxXG59XG5cbmV4cG9ydCBjbGFzcyBJTm9kZXtcbiAgaWQ9MCAgICAgICAgLy8vIChmaWxlIHN0YXQgaW5vKVxuICB0eXBlPScnICAgICAgLy8vICAoIG9uZSBvZiAnZCcsJ2YnLCdsJywncCcsJ2MnLCdwJywncycpXG4gIG5hbWU9XCJcIiAgICAgIC8vLyAgZmlsZSBuYW1lXG4gIGZ1bGxQYXRoPVwiXCIgIC8vLyBcbiAgcmVsUGF0aD1cIlwiICAvLy8gXG4gIGlzT3Blbj1mYWxzZSAgICAvLy8gKGRlZmF1bHQgZmFsc2UpXG4gIGNoaWxkcmVuPVtdICAvLy8gW11JTm9kZVxuICBlbnRyaWVzPVtdICAvLy8gW11JTm9kZVxuXG4gIGFzeW5jIHJlYWRGaWxlKCkge1xuICAgIHJldHVybiBmcy5yZWFkRmlsZSh0aGlzLmZ1bGxQYXRoLCAndXRmOCcpO1xuICB9XG4gIGRlcHRoKCl7XG4gICAgcmV0dXJuIHRoaXMuZnVsbFBhdGguc3BsaXQoXCIvXCIpLmxlbmd0aFxuICB9XG4gIHBhcmVudEZ1bGxOYW1lKCl7XG4gICAgcmV0dXJuIHRoaXMuZnVsbFBhdGgucmVwbGFjZShgLyR7dGhpcy5uYW1lfWAsJycpXG4gIH1cbiAgdG9UZXh0KCl7XG5cbiAgICBjb25zdCBudD10aGlzLnR5cGUucmVwbGFjZSgvLS9naSwnJylcbiAgICBjb25zdCBtYXJrZXIgPSB0aGlzLnR5cGUuaW5kZXhPZignZCcpPi0xXG4gICAgICA/ICh0aGlzLmlzT3BlbiA/ICcgWy1dJyA6ICcgWytdJylcbiAgICAvLyAgOiBgIFske250fV1gO1xuICAgICAgOiBgYDtcbiAgICByZXR1cm4gYCR7JyAnLnJlcGVhdCh0aGlzLmRlcHRoKCkqMil9JHttYXJrZXJ9ICR7dGhpcy5uYW1lfWBcbiAgfVxuICB0b1RleHQyKCl7XG4gICAgcmV0dXJuIGlub2RlU29ydEJ5KHRoaXMpXG4gIH1cblxuICAvKipcbiAgICpcbiAgICogQHJldHVybnMge0lOb2RlW119XG4gICAqL1xuICBmbGF0dGVuICgpe1xuICAgIGxldCBvdXQgPVtdXG4gICAgb3V0LnB1c2godGhpcyk7XG4gICAgaWYgKHRoaXMuaXNPcGVuKSB7XG4gICAgICBjb25zdCBvID0gdGhpcy5jaGlsZHJlbi5mbGF0TWFwKGNoaWxkID0+IGNoaWxkLmZsYXR0ZW4oKSk7XG4gICAgICBvLmZvckVhY2gobiA9PiBvdXQucHVzaChuKSlcbiAgICB9XG4gICAgcmV0dXJuIG91dDtcbiAgfVxuICBcbiAgLyoqXG4gICAqIFxuICAgKiBAcGFyYW0ge3N0cmluZ30gcm9vdERpciBcbiAgICogQHBhcmFtIHtzdHJpbmd9IGN1cnJlbnRQYXRoIFxuICAgKiBAcGFyYW0ge2lnbm9yZWRQYXRoc30gaWcgXG4gICAqIEByZXR1cm5zIHtJTm9kZX0gc2VsZlxuICAgKi9cbiAgYXN5bmMgaW5pdChyb290RGlyLCBpZywgY3VycmVudFBhdGgpe1xuICAgIHRoaXMuZnVsbFBhdGg9Y3VycmVudFBhdGhcbiAgICBsZXQgc3RhdCA9IGF3YWl0IGZzLnN0YXQodGhpcy5mdWxsUGF0aCk7XG4gICAgdGhpcy5pZD1zdGF0Lmlub1xuICAgIHRoaXMudHlwZT1bXG4gICAgICBzdGF0LmlzRGlyZWN0b3J5KCk/J2QnOictJyxcbiAgICAgIHN0YXQuaXNGaWxlKCk/J2YnOictJyxcbiAgICAgIHN0YXQuaXNTeW1ib2xpY0xpbmsoKT8nbCc6Jy0nLFxuICAgICAgc3RhdC5pc0Jsb2NrRGV2aWNlKCk/J2InOictJyxcbiAgICAgIHN0YXQuaXNDaGFyYWN0ZXJEZXZpY2UoKT8nYyc6Jy0nLFxuICAgICAgc3RhdC5pc0ZJRk8oKT8ncCc6Jy0nLFxuICAgICAgc3RhdC5pc1NvY2tldCgpPydzJzonLScsXG4gICAgXS5qb2luKFwiXCIpXG4gICAgdGhpcy5uYW1lID0gcGF0aC5iYXNlbmFtZSh0aGlzLmZ1bGxQYXRoKTtcbiAgICB0aGlzLnJlbFBhdGggPSBwYXRoLnJlbGF0aXZlKHJvb3REaXIsIHRoaXMuZnVsbFBhdGgpO1xuICAgIHRoaXMuaXNPcGVuPWZhbHNlXG4gICAgdGhpcy5jaGlsZHJlbj1bXVxuICAgIGlmKHRoaXMudHlwZS5pbmRleE9mKCdkJyk+LTEpe1xuICAgICAgdHJ5e1xuICAgICAgICB0aGlzLmVudHJpZXMgPSBhd2FpdCBmcy5yZWFkZGlyKHRoaXMuZnVsbFBhdGgpXG4gICAgICB9Y2F0Y2goZXJyKXtcbiAgICAgICAgdGhpcy5lbnRyaWVzPVtdXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZW50cmllcz1bXVxuICAgIH1cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqXG4gICAqIEBwYXJhbSByb290RGlyXG4gICAqIEBwYXJhbSBpZ1xuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJTm9kZT59XG4gICAqL1xuICBhc3luYyBvcGVuKHJvb3REaXIsaWcpe1xuICAgIHRoaXMuaXNPcGVuPXRydWU7XG4gICAgdGhpcy5jaGlsZHJlbj0oYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIHRoaXMuZW50cmllcy5tYXAoZW50cnkgPT4ge1xuICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgIGNvbnN0IGlub2RlMSA9IG5ldyBJTm9kZSgpXG4gICAgICAgICAgICBpbm9kZTEuZnVsbFBhdGggPSBwYXRoLmpvaW4odGhpcy5mdWxsUGF0aCwgZW50cnkpXG4gICAgICAgICAgICByZXR1cm4gaW5vZGUxLmluaXQocm9vdERpciwgaWcsIGlub2RlMS5mdWxsUGF0aClcbiAgICAgICAgICB9Y2F0Y2goZXJyKXtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobnVsbClcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgKSkuZmlsdGVyKGsgPT4gayAhPT0gbnVsbClcbiAgICB0aGlzLmNoaWxkcmVuLnNvcnQoY29tcGFyZUlub2RlcylcbiAgICByZXR1cm4gdGhpc1xuICB9XG4gIGFzeW5jIGNsb3NlKHJvb3REaXIsaWcpe1xuICAgIHRoaXMuaXNPcGVuPWZhbHNlO1xuICAgIHRoaXMuY2hpbGRyZW49W11cbiAgfVxuICAvKipcbiAgICogXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjdXJyZW50UGF0aCBcbiAgICogQHBhcmFtIHtzdHJpbmd9IHJvb3REaXIgXG4gICAqIEBwYXJhbSB7aWdub3JlZFBhdGhzfSBpZyBcbiAgICogQHJldHVybnMge0lOb2RlfSBzZWxmXG4gICAqL1xuICBhc3luYyByZWZyZXNoKHJvb3REaXIsaWcpe1xuXG4gICAgdGhpcy5uYW1lID0gcGF0aC5iYXNlbmFtZSh0aGlzLmZ1bGxQYXRoKTtcbiAgICB0aGlzLnJlbFBhdGggPSBwYXRoLnJlbGF0aXZlKHJvb3REaXIsIHRoaXMuZnVsbFBhdGgpO1xuXG4gICAgLy8gc2tpcCBhbnl0aGluZyB0aGUgLmdpdGlnbm9yZSBzYXlzIHRvIGlnbm9yZVxuICAgIGlmICh0aGlzLnJlbFBhdGggJiYgKGlnLmlnbm9yZXModGhpcy5yZWxQYXRoKSB8fCB0aGlzLm5hbWUgPT09IFwiLmdpdFwiKSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIC8vIGxldCBpbm9kZSA9bmV3IElOb2RlKClcbiAgICAvLyBhd2FpdCB0aGlzLmluaXQocm9vdERpciwgaWcsIHRoaXMuZnVsbFBhdGgpXG5cbiAgICBpZiAodGhpcy50eXBlLmluZGV4T2YoJ2QnKT4tMSkge1xuICAgICAgY29uc3QgZW50cmllcyA9IGF3YWl0IGZzLnJlYWRkaXIodGhpcy5mdWxsUGF0aCk7XG4gICAgICB0aGlzLmVudHJpZXM9ZW50cmllc1xuICAgICAgbGV0IGNoaWxkcmVuID0gKGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICBlbnRyaWVzLm1hcChlbnRyeSA9PiB7XG4gICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgY29uc3QgaW5vZGUxID0gbmV3IElOb2RlKClcbiAgICAgICAgICAgIGlub2RlMS5mdWxsUGF0aCA9IHBhdGguam9pbih0aGlzLmZ1bGxQYXRoLCBlbnRyeSlcbiAgICAgICAgICAgIGlub2RlMS5pbml0KHJvb3REaXIsIGlnLCB0aGlzLmZ1bGxQYXRoKVxuICAgICAgICAgICAgcmV0dXJuIGlub2RlMS5yZWZyZXNoKHJvb3REaXIsIGlnKVxuICAgICAgICAgIH1jYXRjaCAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShudWxsKVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICkpLmZpbHRlciggayA9PiBrIT09bnVsbClcbiAgICAgIGNoaWxkcmVuPWNoaWxkcmVuLmZpbHRlcih4ID0+IHghPT0gbnVsbClcbiAgICAgICAgLnNvcnQoY29tcGFyZUlub2RlcylcbiAgICAgIHRoaXMuY2hpbGRyZW49Y2hpbGRyZW5cbiAgICB9XG4gICAgcmV0dXJuIHRoaXNcblxuICB9XG59XG5cblxuXG5leHBvcnQgY2xhc3MgV29ya3NwYWNle1xuICByb290RGlyPVwiXCJcbiAgcm9vdE5vZGU9bmV3IElOb2RlKClcbiAgbm9kZUZpbHRlcj0oaW5vZGUsaW5kZXgsbm9kZXMscGFyZW50KT0+e3JldHVybiB0cnVlfVxuICBjb25zdHJ1Y3Rvcihub2RlRmlsdGVyPShpbm9kZSxpbmRleCxub2RlcyxwYXJlbnQpPT57fSl7XG4gICAgdGhpcy5ub2RlRmlsdGVyPW5vZGVGaWx0ZXI7XG4gIH1cbiAgYXN5bmMgbG9hZElnbm9yZSgpIHtcbiAgICBjb25zdCBpZyA9IGlnbm9yZSgpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBnaXRpZ25vcmUgPSBhd2FpdCBmcy5yZWFkRmlsZShwYXRoLmpvaW4odGhpcy5yb290RGlyLCAnLmdpdGlnbm9yZScpLCAndXRmOCcpO1xuICAgICAgaWcuYWRkKGdpdGlnbm9yZS5zcGxpdCgvXFxyP1xcbi8pKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAvLyBubyAuZ2l0aWdub3JlIOKAlCBub3RoaW5nIHRvIGlnbm9yZVxuICAgIH1cbiAgICByZXR1cm4gaWc7XG4gIH1cbiAgLyoqXG4gICAqIFxuICAgKiBAcGFyYW0ge3N0cmluZ30gcm9vdERpciBcbiAgICogQHJldHVybnMge1dvcmtzcGFjZX1cbiAgICovXG4gIGFzeW5jIGluaXQocm9vdERpcikge1xuICAgIHRoaXMuaWcgPSBhd2FpdCB0aGlzLmxvYWRJZ25vcmUoKTtcbiAgICB0aGlzLnJvb3REaXI9cm9vdERpclxuICAgIHRoaXMucm9vdE5vZGUuZnVsbFBhdGggPSByb290RGlyXG4gICAgYXdhaXQgdGhpcy5yb290Tm9kZS5pbml0KHRoaXMucm9vdERpcix0aGlzLmlnLHRoaXMucm9vdERpcilcbiAgICBhd2FpdCB0aGlzLnJvb3ROb2RlLnJlZnJlc2godGhpcy5yb290RGlyLHRoaXMuaWcpXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuICBhc3luYyByZWZyZXNoKCl7XG4gICAgYXdhaXQgdGhpcy5yb290Tm9kZS5yZWZyZXNoKHRoaXMucm9vdERpcix0aGlzLmlnKVxuICB9XG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0ge0lOb2RlfSBub2RlXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFdvcmtzcGFjZT59XG4gICAqL1xuICBhc3luYyBvcGVuKG5vZGUpe1xuICAgIG5vZGUuaXNPcGVuPXRydWU7XG4gICAgbm9kZS5jaGlsZHJlbj1hd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgbm9kZS5lbnRyaWVzLm1hcChlbnRyeSA9PiB7XG4gICAgICAgICAgY29uc3QgaW5vZGUxID1uZXcgSU5vZGUoKVxuICAgICAgICAgIGlub2RlMS5mdWxsUGF0aD1wYXRoLmpvaW4obm9kZS5mdWxsUGF0aCwgZW50cnkpXG4gICAgICAgICAgcmV0dXJuIGlub2RlMS5pbml0KHRoaXMucm9vdERpciwgdGhpcy5pZywgaW5vZGUxLmZ1bGxQYXRoKVxuICAgICAgICB9KVxuICAgIClcbiAgICBub2RlLmNoaWxkcmVuPW5vZGUuY2hpbGRyZW4uZmlsdGVyKCh2LGksYSk9PiB7XG4gICAgICByZXR1cm4gdGhpcy5ub2RlRmlsdGVyKHYsaSxhLG5vZGUpXG4gICAgfSlcbiAgICByZXR1cm4gdGhpc1xuICB9XG4gIGZsYXR0ZW4oKXtcblxuICAgIC8vIHRocm93IEpTT04uc3RyaW5naWZ5KHdrLG51bGwsJyAnKVxuICAgIGxldCBmbWFwID0gdGhpcy5yb290Tm9kZS5mbGF0dGVuKClcbiAgICBmbWFwLnNvcnQoY29tcGFyZUlub2RlcylcbiAgICByZXR1cm4gZm1hcFxuICB9XG4gIC8vIGJ1aWxkIGEgZmxhdCBsaXN0IG9mIHZpc2libGUgbm9kZXNcbiAgLyoqXG4gICAqXG4gICAqIEByZXR1cm5zIHtXb3Jrc3BhY2V9XG4gICAqL1xuICBjb3B5KCl7XG4gICAgbGV0IHdrcyA9IG5ldyBXb3Jrc3BhY2UoKVxuICAgIHdrcy5yb290RGlyPXRoaXMucm9vdERpclxuICAgIHdrcy5yb290Tm9kZT10aGlzLnJvb3ROb2RlXG4gICAgd2tzLmlnPXRoaXMuaWdcbiAgICB3a3Mubm9kZUZpbHRlcj10aGlzLm5vZGVGaWx0ZXJcbiAgICByZXR1cm4gd2tzXG4gIH1cbn1cblxuIiwiLy8gY29tcG9uZW50cy9Nb2RhbERpYWxvZy5qc1xuaW1wb3J0IFJlYWN0LCB7IHVzZUVmZmVjdCwgdXNlUmVmIH0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHsgQm94RWxlbWVudCBhcyBib3gsIFRleHRFbGVtZW50IGFzIHRleHQgfSBmcm9tICdyZWFjdC1ibGVzc2VkJztcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gTW9kYWxEaWFsb2coe1xuICAgIHRpdGxlID0gJ0RpYWxvZycsXG4gICAgd2lkdGggPSAnNTAlJyxcbiAgICBoZWlnaHQgPSAnNTAlJyxcbiAgICBvbkNsb3NlLFxuICAgIGNoaWxkcmVuXG59KSB7XG4gICAgY29uc3QgYm94UmVmID0gdXNlUmVmKCk7XG5cbiAgICAvLyBmb2N1cyB0aGUgbW9kYWwgc28gaXQgY2FuIGNhdGNoIGtleXByZXNzZXNcbiAgICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgICAgICBjb25zdCBub2RlID0gYm94UmVmLmN1cnJlbnQ7XG4gICAgICAgIGlmIChub2RlKSBub2RlLmZvY3VzKCk7XG4gICAgfSwgW10pO1xuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveFxuICAgICAgICAgICAgcmVmPXtib3hSZWZ9XG4gICAgICAgICAgICB0b3A9XCJjZW50ZXJcIlxuICAgICAgICAgICAgbGVmdD1cImNlbnRlclwiXG4gICAgICAgICAgICB3aWR0aD17d2lkdGh9XG4gICAgICAgICAgICBoZWlnaHQ9e2hlaWdodH1cbiAgICAgICAgICAgIGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX1cbiAgICAgICAgICAgIHN0eWxlPXt7IGJnOiAnYmxhY2snLCBmZzogJ3doaXRlJyB9fVxuICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgLy8gY2xvc2Ugb24gRVNDXG4gICAgICAgICAgICBvbktleT17KGNoLCBrZXkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoa2V5Lm5hbWUgPT09ICdlc2NhcGUnKSBvbkNsb3NlKCk7XG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICB7LyogSGVhZGVyIHdpdGggdGl0bGUgYW5kIGNsb3NlIGJ1dHRvbiAqL31cbiAgICAgICAgICAgIDxib3ggaGVpZ2h0PXsxfSB3aWR0aD1cIjEwMCVcIiBzdHlsZT17eyBmZzogJ2dyZWVuJyB9fT5cbiAgICAgICAgICAgICAgICA8dGV4dCBib2xkPntgICR7dGl0bGV9YH0gPC90ZXh0PlxuICAgICAgICAgICAgICAgIDx0ZXh0XG4gICAgICAgICAgICAgICAgICAgIHJpZ2h0PXswfVxuICAgICAgICAgICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICAgICAgdW5kZXJsaW5lXG4gICAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9e29uQ2xvc2V9XG4gICAgICAgICAgICAgICAgPlvDl108L3RleHQ+XG4gICAgICAgICAgICA8L2JveD5cblxuICAgICAgICAgICAgey8qIENvbnRlbnQgYXJlYSAqL31cbiAgICAgICAgICAgIDxib3ggdG9wPXsyfSBsZWZ0PXsxfSByaWdodD17MX0gYm90dG9tPXsxfSBzY3JvbGxhYmxlIGtleXMgbW91c2UgYWx3YXlzU2Nyb2xsPlxuICAgICAgICAgICAgICAgIHtjaGlsZHJlbn1cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L2JveD5cbiAgICApO1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIHNhZmVTdHJpbmdpZnkob2JqLHNwYWNlPXVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgV2Vha1NldCgpO1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShvYmosIChrZXksIHZhbHVlKSA9PiB7XG4gICAgICAgIHN3aXRjaChrZXkpe1xuICAgICAgICAgICAgLy8gY2FzZSBcImNvbnRlbnRcIjogcmV0dXJuIFwiW2NvbnRlbnRdXCJcbiAgICAgICAgICAgIGNhc2UgXCJzY3JlZW5cIjogcmV0dXJuIFwiW3NjcmVlbl1cIlxuICAgICAgICAgICAgY2FzZSBcInBhcmVudFwiOiByZXR1cm4gXCJbcGFyZW50XVwiXG4gICAgICAgICAgICBjYXNlIFwibGluZXNcIjogcmV0dXJuIFwiW2xpbmVzXVwiXG4gICAgICAgICAgICBjYXNlIFwiY2hpbGRyZW5cIjogcmV0dXJuIFwiW2NoaWxkcmVuXVwiXG4gICAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChzZWVuLmhhcyh2YWx1ZSkpIHtcbiAgICAgICAgICByZXR1cm47ICAgICAgICAgICAgLy8gRHVwbGljYXRlL2NpcmN1bGFyIHJlZmVyZW5jZSDihpIgb21pdFxuICAgICAgICB9XG4gICAgICAgIHNlZW4uYWRkKHZhbHVlKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9LHNwYWNlKTtcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBpbnNlcnRBdChkZXN0aW5hdGlvbixpbmRleCxzb3VyY2Upe1xuICAgIGxldCBmaXJzdCA9IGRlc3RpbmF0aW9uLnN1YnN0cmluZygwLGluZGV4KTtcblxuICAgIGxldCBsYXN0ID0gZGVzdGluYXRpb24uc3Vic3RyaW5nKGluZGV4K3NvdXJjZS5sZW5ndGgpO1xuICAgIHJldHVybiAoZmlyc3Qrc291cmNlK2xhc3QpLnN1YnN0cmluZygwLGRlc3RpbmF0aW9uLmxlbmd0aClcbiAgfVxuXG4gIGV4cG9ydCBmdW5jdGlvbiBkZWJvdW5jZWQoZm4sZGVsYXk9NTApe1xuICAgIGxldCB0bz0wXG4gICAgcmV0dXJuIGZ1bmN0aW9uKC4uLmFyZ3Mpe1xuICAgICAgICBjbGVhclRpbWVvdXQodG8pXG4gICAgICAgIHRvPXNldFRpbWVvdXQoKCk9PntcbiAgICAgICAgICAgIGZuKC4uLmFyZ3MpXG4gICAgICAgIH0sZGVsYXkpXG4gICAgfVxuICB9IiwiXG5cblxuLyoqXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxpbmVcbiAqIEByZXR1cm4geyBUb2tlbml6ZXJUb2tlbltdIH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGhpZ2hsaWdodChsaW5lKSB7XG4gICAgY29uc3QgdG9rZW5pemVyPWdldE5hbWVkVG9rZW5pemVyKCdqc3gnKVxuICAgIHJldHVybiB0b2tlbml6ZXIobGluZSlcbiAgfVxuZXhwb3J0IGNsYXNzIFRva2VuaXplck1hdGNoZXJEZWZ7XG4gICAgc3R5bGUgPSB7fVxuICAgIHBhdHRlcm4gPSAnJ1xuICAgIHN1YnRva2VuaXplciA9IG51bGxcbn1cbmV4cG9ydCBjbGFzcyBUb2tlbml6ZXJEZWZ7XG4gICAgbmFtZSA9ICcnO1xuICAgIGZsYWdzPSdtZ2knXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7e1tuYW1lOnN0cmluZ106VG9rZW5pemVyTWF0Y2hlckRlZn19XG4gICAgICovXG4gICAgZGVmaW5pdGlvbnMgPSB7fVxufVxuZXhwb3J0IGNsYXNzIFRva2VuaXplclRva2Vue1xuICAgIHRva2VuaXplck5hbWU9JydcbiAgICB0eXBlPScnXG4gICAgc3R5bGU9e31cbiAgICBzdGFydD0wXG4gICAgZW5kPTBcbiAgICB5PTBcbiAgICB4PTBcbiAgICB0ZXh0PScnXG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7UmVnRXhwRXhlY0FycmF5fSBtXG4gICAgICogQHBhcmFtIHRva2VuaXplckRlZlxuICAgICAqIEByZXR1cm4ge3tuYW1lOiB2b2lkIHwgc3RyaW5nLCB0ZXh0OiAqLCB0eXBlOiBzdHJpbmcsIHN0eWxlLCBzdGFydCwgZW5kOiAqfX1cbiAgICAgKi9cbiAgICBzdGF0aWMgZnJvbVJlZ2V4cE1hdGNoKG0sdG9rZW5pemVyRGVmLHRva2VuaXplck5hbWUsbGluZU51bWJlcil7XG4gICAgICAgIGNvbnN0IGdyb3VwcyA9IG0uZ3JvdXBzO1xuICAgICAgICBjb25zdCB0eXBlID0gT2JqZWN0LmtleXMoZ3JvdXBzKS5maW5kKGtleSA9PiBncm91cHNba2V5XSAhPT0gdW5kZWZpbmVkKTtcbiAgICAgICAgY29uc3QgdG9rZW5EZWYgPSB0b2tlbml6ZXJEZWYuZGVmaW5pdGlvbnNbdHlwZV1cbiAgICAgICAgY29uc3QgdHQgPSBuZXcgVG9rZW5pemVyVG9rZW4oKVxuICAgICAgICB0dC50b2tlbml6ZXJOYW1lPXRva2VuaXplck5hbWVcbiAgICAgICAgdHQudGV4dD0gbVswXVxuICAgICAgICB0dC50eXBlPXR5cGVcbiAgICAgICAgdHQuc3R5bGU9dG9rZW5EZWYuc3R5bGVcbiAgICAgICAgdHQuc3RhcnQ9bS5pbmRleFxuICAgICAgICB0dC5lbmQ9bS5pbmRleCttWzBdLmxlbmd0aFxuICAgICAgICB0dC55PWxpbmVOdW1iZXJcbiAgICAgICAgdHQueD10dC5zdGFydFxuICAgICAgICByZXR1cm4gdHRcbiAgICB9XG59XG4vKipcbiAqIEBjb25zdFxuICogQHR5cGUge01hcDxzdHJpbmcsVG9rZW5pemVyTWF0Y2hlckRlZj59fSBuYW1lZFRva2VuaXplcnNcbiAqL1xuZXhwb3J0IGNvbnN0IG5hbWVkVG9rZW5pemVycz17XG4gICAgYW55OntuYW1lOidhbnknLGRlZmluaXRpb25zOntcbiAgICAgICAgTnVtYmVyOiAgICAgICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovXFxkKyg/OlxcLlxcZCspPy9taWd9LFxuICAgICAgICBJZGVudGlmaWVyOiAgIHtzdHlsZToge2ZnOidncmVlbid9LHBhdHRlcm46L1tBLVphLXpfXVxcdyovbWlnfSxcbiAgICAgICAgU3RyaW5nOiAgICAgICB7c3R5bGU6IHtmZzoneWVsbG93J30scGF0dGVybjovXCIoPzpcXFxcLnxbXlwiXSkqXCJ8Jyg/OlxcXFwufFteJ10pKicvbWlnfSxcbiAgICAgICAgT3BlcmF0b3I6ICAgICB7c3R5bGU6IHtmZzonY3lhbid9LHBhdHRlcm46Lz09fCE9fDw9fD49fFsrXFwtKi89PD5dL21pZ30sXG4gICAgICAgIHB1bmN0dWF0aW9uOiAge3N0eWxlOiB7Zmc6J2N5YW4nfSxwYXR0ZXJuOi9bKClcXFtcXF17fS4sOzo/XFxeXS9taWd9LFxuICAgICAgICBXaGl0ZXNwYWNlOiAgIHtzdHlsZToge2ZnOid3aGl0ZSd9LHBhdHRlcm46L1xccysvbWlnfSxcbiAgICAgICAgT3RoZXJzOiAgICAgICB7c3R5bGU6IHtmZzond2hpdGUnfSxwYXR0ZXJuOi8uKj8vbWlnfSxcbiAgICB9fSxcbiAgICBqczp7bmFtZTonanMnLGZsYWdzOidtZycsZGVmaW5pdGlvbnM6e1xuICAgICAgICBLZXl3b3JkOiAgICAgIHtzdHlsZToge2ZnOidtYWdlbnRhJ30scGF0dGVybjovXFxiKGFzfGZyb218ZGVmYXVsdHx0aGlzfGNvbnN0fGNvbnN0cnVjdG9yfGxldHx2YXJ8ZnVuY3Rpb258aWZ8ZWxzZXxmb3J8d2hpbGV8cmV0dXJufGNsYXNzfGltcG9ydHxleHBvcnR8bmV3fGF3YWl0fGFzeW5jfHRyeXxjYXRjaHx0aHJvd3xzd2l0Y2h8Y2FzZXxicmVha3xjb250aW51ZSlcXGIvbWlnfSxcbiAgICAgICAgTnVtYmVyOiAgICAgICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovXFxkKyg/OlxcLlxcZCspPy9taWd9LFxuICAgICAgICBDb21tZW50OiAgICAgIHtzdHlsZToge2ZnOicjNzc5OTc3J30scGF0dGVybjovXFwvXFwvLiokL21pZ30sXG4gICAgICAgIC8vIE1Db21tZW50OiAgICAge3N0eWxlOiB7Zmc6JyM3Nzk5OTknfSxwYXR0ZXJuOicvXFxcXCouKlxcXFwqLyd9LFxuICAgICAgICBTdHJpbmc6ICAgICAgIHtzdHlsZToge2ZnOid5ZWxsb3cnfSxwYXR0ZXJuOi9cIig/OlxcXFwufFteXCJdKSpcInwnKD86XFxcXC58W14nXSkqJy9taWd9LFxuICAgICAgICBPcGVyYXRvcjogICAgIHtzdHlsZToge2ZnOidjeWFuJ30scGF0dGVybjovPT18IT18PD18Pj18WytcXC0qLz08PiV8Jlx1MDAxYl0vbWlnfSxcbiAgICAgICAgUHVuY3R1YXRpb246ICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovW1xcXFwoKVxcW1xcXXt9Liw7Oj9eJF0vbWlnfSxcbiAgICAgICAgV2hpdGVzcGFjZTogICB7c3R5bGU6IHtmZzond2hpdGUnfSxwYXR0ZXJuOi9cXHMrL3NtaWd9LFxuICAgICAgICBJZGVudGlmaWVyOiAgIHtzdHlsZToge2ZnOidncmVlbid9LHBhdHRlcm46L1tBLVphLXpfXVxcdyovbWlnfSxcbiAgICAgICAgT3RoZXJzOiAgICAgICB7c3R5bGU6IHtmZzond2hpdGUnfSxwYXR0ZXJuOi9bXl0vc21pZ30sXG4gICAgfX0sXG4gICAgaHRteDp7bmFtZTonaHRteCcsZmxhZ3M6J21nJyxkZWZpbml0aW9uczp7XG4gICAgICAgIFRhZ0RlbGltOiAgIHtzdHlsZToge2ZnOicjRkZERDAwJ30scGF0dGVybjovPHw8XFwvfFxcLz58Pi9pZ30sXG4gICAgICAgIEF0dHJpYnV0ZU5hbWU6IHtzdHlsZToge2ZnOidjeWFuJ30scGF0dGVybjovWzAtOWEtekEtWjpALV0qL2lnfSxcbiAgICAgICAgRXF1YWw6IHtzdHlsZToge2ZnOidtYWdlbnRhJ30scGF0dGVybjovPS9pZ30sXG4gICAgICAgIEpzeFZhbHVlOiAge3N0eWxlOiB7Zmc6J2dyZWVuJ30scGF0dGVybjovXFx7Lio/fS9taWcsc3VidG9rZW5pemVyOidqcyd9LFxuICAgICAgICBBdHRyaWJ1dGVWYWx1ZTogICAge3N0eWxlOiB7Zmc6J3llbGxvdyd9LHBhdHRlcm46L1wiLio/XCIvbWlnfSxcbiAgICAgICAgV2hpdGVzcGFjZTogICB7c3R5bGU6IHtmZzond2hpdGUnfSxwYXR0ZXJuOi9cXHMrL21pZ30sXG4gICAgICAgIE90aGVyczogICAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovLio/L21pZ30sXG4gICAgfX0sXG4gICAganN4OntuYW1lOidqc3gnLGZsYWdzOidtZycsZGVmaW5pdGlvbnM6e1xuICAgICAgICBSZWFjdFRva2VuOiAgIHtzdHlsZToge2ZnOicjRkZERDAwJ30scGF0dGVybjovXFxidXNlW0EtWl1bYS16XSpcXGIvbWlnfSxcbiAgICAgICAgS2V5d29yZDogICAgICB7c3R5bGU6IHtmZzonbWFnZW50YSd9LHBhdHRlcm46L1xcYihhc3xmcm9tfGRlZmF1bHR8Y29uc3R8bGV0fHZhcnxmdW5jdGlvbnxpZnxlbHNlfGZvcnx3aGlsZXxyZXR1cm58Y2xhc3N8aW1wb3J0fGV4cG9ydHxuZXd8YXdhaXR8YXN5bmN8dHJ5fGNhdGNofHRocm93fHN3aXRjaHxjYXNlfGJyZWFrfGNvbnRpbnVlKVxcYi9taWd9LFxuICAgICAgICBKc3hFbmRUYWc6ICAgIHtzdHlsZToge2ZnOid5ZWxsb3cnfSxwYXR0ZXJuOi88XFwvW2EtekEtWi1dKj4vbWlnfSxcbiAgICAgICAgSnN4U3RhcnRUYWc6ICB7c3R5bGU6IHtmZzoneWVsbG93J30scGF0dGVybjovPFthLXpBLVotXSouKj8+L21pZyxzdWJ0b2tlbml6ZXI6J2h0bXgnfSxcbiAgICAgICAgQ29tbWVudDogICAgICB7c3R5bGU6IHtmZzonIzc3OTk3Nyd9LHBhdHRlcm46L1xcL1xcLy4qJC9taWd9LFxuICAgICAgICAvLyBNQ29tbWVudDogICAgIHtzdHlsZToge2ZnOicjNzc5OTk5J30scGF0dGVybjonL1xcXFwqLipcXFxcKi8nfSxcbiAgICAgICAgTnVtYmVyOiAgICAgICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovXFxkKyg/OlxcLlxcZCspPy9taWd9LFxuICAgICAgICBQdW5jdHVhdGlvbjogIHtzdHlsZToge2ZnOidyZWQnfSxwYXR0ZXJuOi9bXFxcXCgpXFxbXFxde30uLDs6P14kXS9taWd9LFxuICAgICAgICBPcGVyYXRvcjogICAgIHtzdHlsZToge2ZnOidjeWFuJ30scGF0dGVybjovPT18IT18PD18Pj18WytcXC0qLz08Pl0vbWlnfSxcbiAgICAgICAgV2hpdGVzcGFjZTogICB7c3R5bGU6IHtmZzond2hpdGUnfSxwYXR0ZXJuOi9cXHMrL21pZ30sXG4gICAgICAgIElkZW50aWZpZXI6ICAge3N0eWxlOiB7Zmc6J2dyZWVuJ30scGF0dGVybjovW0EtWmEtel9dXFx3Ki9taWd9LFxuICAgICAgICBPdGhlcnM6ICAgICAgIHtzdHlsZToge2ZnOid3aGl0ZSd9LHBhdHRlcm46Ly4qPy9taWd9LFxuICAgIH19LFxuICAgIGM6e25hbWU6J2MnLGZsYWdzOidtZycsZGVmaW5pdGlvbnM6e1xuICAgICAgICBLZXl3b3JkOiAgICAgIHtzdHlsZToge2ZnOidtYWdlbnRhJ30scGF0dGVybjovXFxiKGludHxjb25zdHxjaGFyfGxvbmd8aWZ8ZWxzZXxmb3J8d2hpbGV8cmV0dXJufHN3aXRjaHxjYXNlfGJyZWFrfGNvbnRpbnVlKVxcYi9taWd9LFxuICAgICAgICBOdW1iZXI6ICAgICAgIHtzdHlsZToge2ZnOidyZWQnfSxwYXR0ZXJuOi9cXGQrKD86XFwuXFxkKyk/L21pZ30sXG4gICAgICAgIENvbW1lbnQ6ICAgICAge3N0eWxlOiB7Zmc6JyM3Nzk5NzcnfSxwYXR0ZXJuOi9cXC9cXC8uKiQvbWlnfSxcbiAgICAgICAgLy8gTUNvbW1lbnQ6ICAgICB7c3R5bGU6IHtmZzonIzc3OTk5OSd9LHBhdHRlcm46Jy9cXFxcKi4qXFxcXCovJ30sXG4gICAgICAgIFN0cmluZzogICAgICAge3N0eWxlOiB7Zmc6J3llbGxvdyd9LHBhdHRlcm46L1wiKD86XFxcXC58W15cIl0pKlwifCcoPzpcXFxcLnxbXiddKSonL21pZ30sXG4gICAgICAgIE9wZXJhdG9yOiAgICAge3N0eWxlOiB7Zmc6J2N5YW4nfSxwYXR0ZXJuOi89PXwhPXw8PXw+PXxbK1xcLSovPTw+XS9taWd9LFxuICAgICAgICBQdW5jdHVhdGlvbjogIHtzdHlsZToge2ZnOidjeWFuJ30scGF0dGVybjovPT18IT18PD18Pj18WytcXC0qLz08Pl0vbWlnfSxcbiAgICAgICAgV2hpdGVzcGFjZTogICB7c3R5bGU6IHtmZzond2hpdGUnfSxwYXR0ZXJuOi9cXHMrL21pZ30sXG4gICAgICAgIElkZW50aWZpZXI6ICAge3N0eWxlOiB7Zmc6J2dyZWVuJ30scGF0dGVybjovW0EtWmEtel9dXFx3Ki9taWd9LFxuICAgICAgICBPdGhlcnM6ICAgICAgIHtzdHlsZToge2ZnOid3aGl0ZSd9LHBhdHRlcm46Ly4qPy9taWd9LFxuICAgIH19LFxuICAgIHdvcmRzOntuYW1lOidjJyxmbGFnczonbWcnLGRlZmluaXRpb25zOntcbiAgICAgICAgV2hpdGVzcGFjZTogICAgICAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1xccysvbWlnfSxcbiAgICAgICAgV29yZDogICAgICAgICAgICAge3N0eWxlOiB7Zmc6J2dyZWVuJ30scGF0dGVybjovXFxiLis/XFxiL21pZ30sXG4gICAgfX0sXG4gIH1cblxuLyoqXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgbGFuZ3VhZ2UgbmFtZVxuICogQHJldHVybiB7ZnVuY3Rpb24gKGNvZGU6c3RyaW5nLGxpbmVOdW1iZXI6aW50KTogQXJyYXk8VG9rZW5pemVyVG9rZW4+fVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0TmFtZWRUb2tlbml6ZXIobmFtZSkge1xuICAgIGNvbnN0IHRva2VuaXplckRlZiA9IG5hbWVkVG9rZW5pemVyc1tuYW1lXXx8bmFtZWRUb2tlbml6ZXJzWydhbnknXVxuICAgIHJldHVybiBnZXRUb2tlbml6ZXIodG9rZW5pemVyRGVmKVxufVxuLyoqXG4gKlxuICogQHBhcmFtIHtUb2tlbml6ZXJEZWZ9IHRva2VuaXplckRlZiBsYW5ndWFnZSBuYW1lXG4gKiBAcmV0dXJuIHtmdW5jdGlvbiAoY29kZTpzdHJpbmcsbGluZU51bWJlcjppbnQpOiBBcnJheTxUb2tlbml6ZXJUb2tlbj59XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRUb2tlbml6ZXIodG9rZW5pemVyRGVmKSB7XG4gICAgdG9rZW5pemVyRGVmWydBbnknXT17c3R5bGU6IHtmZzonI2VlZWVlZSd9LHBhdHRlcm46LyhcXGJ8XikuKz8oXFxifCQpL3NtaWd9XG4gICAgY29uc3QgdG9rZW5SZWdleCA9IG5ldyBSZWdFeHAoXG4gICAgICAgIE9iamVjdC5lbnRyaWVzKHRva2VuaXplckRlZi5kZWZpbml0aW9ucylcbiAgICAgICAgICAgIC5tYXAoKFtuYW1lLCBkZWZpbml0aW9uXSkgPT4gYCg/PCR7bmFtZX0+JHtkZWZpbml0aW9uLnBhdHRlcm4uc291cmNlfSlgKVxuICAgICAgICAgICAgLmpvaW4oJ3wnKSxcbiAgICAgICAgdG9rZW5pemVyRGVmLmZsYWdzfHwnZydcbiAgICApO1xuICAgIC8qKlxuICAgICAqIEBwYXJhbSB7VG9rZW5pemVyTWF0Y2hlckRlZn0gY29kZVxuICAgICAqIEByZXR1cm4ge0FycmF5PFRva2VuaXplclRva2VuPn1cbiAgICAgKi9cbiAgICByZXR1cm4gZnVuY3Rpb24gdG9rZW5pemVyKGNvZGUsbGluZU51bWJlcil7XG4gICAgICAgIGNvbnN0IHRva2Vucz1bXVxuICAgICAgICBmb3IgKGNvbnN0IG0gb2YgKGNvZGUgKS5tYXRjaEFsbCh0b2tlblJlZ2V4KSkge1xuICAgICAgICAgICAgY29uc3QgZ3JvdXBzID0gbS5ncm91cHM7XG4gICAgICAgICAgICBjb25zdCB0eXBlID0gT2JqZWN0LmtleXMoZ3JvdXBzKS5maW5kKGtleSA9PiBncm91cHNba2V5XSAhPT0gdW5kZWZpbmVkKTtcbiAgICAgICAgICAgIGNvbnN0IHRva2VuRGVmID0gdG9rZW5pemVyRGVmLmRlZmluaXRpb25zW3R5cGVdXG4gICAgICAgICAgICBjb25zdCBndCA9IFRva2VuaXplclRva2VuLmZyb21SZWdleHBNYXRjaChtLHRva2VuaXplckRlZix0b2tlbml6ZXJEZWYubmFtZSxsaW5lTnVtYmVyKVxuICAgICAgICAgICAgLy9pZih0eXBlb2YodG9rZW5EZWYuc3VidG9rZW5pemVyKSA9PT0gXCJzdHJpbmdcIil7XG4gICAgICAgICAgICAvLyAgICBjb25zdCBzdGsgPSBnZXROYW1lZFRva2VuaXplcih0b2tlbkRlZi5zdWJ0b2tlbml6ZXIpXG4gICAgICAgICAgICAvLyAgICBzdGsoZ3QudGV4dCxsaW5lTnVtYmVyKS5mb3JFYWNoKCBzdWJ0b2tlbiA9PiB7XG4gICAgICAgICAgICAvLyAgICAgICAgc3VidG9rZW4uc3RhcnQrPWd0LnN0YXJ0XG4gICAgICAgICAgICAvLyAgICAgICAgc3VidG9rZW4uZW5kKz1ndC5zdGFydFxuICAgICAgICAgICAgLy8gICAgICAgIHN1YnRva2VuLngrPWd0LnN0YXJ0XG4gICAgICAgICAgICAvLyAgICAgICAgc3VidG9rZW4ueT1ndC55XG4gICAgICAgICAgICAvLyAgICAgICAgdG9rZW5zLnB1c2goc3VidG9rZW4pXG4gICAgICAgICAgICAvLyAgICB9KVxuICAgICAgICAgICAgLy99ZWxzZXtcbiAgICAgICAgICAgICAgICB0b2tlbnMucHVzaChndClcbiAgICAgICAgICAgIC8vfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0b2tlbnNcbiAgICB9XG59IiwiLy8gaW1wb3J0IHtTY3JlZW5FdmVudH0gZnJvbSAncmVhY3QtYmxlc3NlZCdcbmltcG9ydCB7Z2V0VG9rZW5pemVyLCBUb2tlbml6ZXJUb2tlbn0gZnJvbSAnLi90b2tlbml6ZXIuanMnXG4vKipcbiAqXG4gKiBAcGFyYW0ge1NpbXBsZVRleHRFZGl0b3J9IGV2ZW50RGF0YVxuICogQHJldHVybiB7KGZ1bmN0aW9uKCkpfHVuZGVmaW5lZH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIExpc3RlbmVyKGV2ZW50RGF0YSl7cmV0dXJuICgpPT57fX1cblxuXG5leHBvcnQgY2xhc3MgRWRpdG9yRXZlbnQge1xuICAgIC8qKlxuICAgICAqIEB0eXBlIHtTY3JlZW5FdmVudH1cbiAgICAgKi9cbiAgICBzY3JlZW49IHt9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7c3RyaW5nW119XG4gICAgICovXG4gICAgbGluZXM9W11cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEB0eXBlIHtzdHJpbmd9XG4gICAgICovXG4gICAgbGluZT1cIlwiXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7c3RyaW5nW119XG4gICAgICovXG4gICAgdmlzaWJsZUxpbmVzPVtdXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7e3g6IG51bWJlciwgeTogbnVtYmVyfX1cbiAgICAgKi9cbiAgICBjdXJzb3I9e3g6MCx5OjB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7e3g6IG51bWJlciwgeTogbnVtYmVyfX1cbiAgICAgKi9cbiAgICBjdXJzb3JTY3JlZW49e3g6MCx5OjB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7c3RyaW5nfVxuICAgICAqL1xuICAgIGJ1ZmZlcj1cIlwiXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7c3RyaW5nfVxuICAgICAqL1xuICAgIHZpc2libGVCdWZmZXI9XCJcIlxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHR5cGUge251bWJlcn1cbiAgICAgKi9cbiAgICBpbmRleD0wXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAdHlwZSB7VG9rZW5pemVyVG9rZW5bXX1cbiAgICAgKi9cbiAgICB0b2tlbnM9W11cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEB0eXBlIHtUb2tlbml6ZXJUb2tlbn1cbiAgICAgKi9cbiAgICB0b2tlblVuZGVyQ3Vyc29yPW51bGxcbiAgICBwaHJhc2U9XCJcIlxufVxuXG5leHBvcnQgY2xhc3MgU2ltcGxlVGV4dEVkaXRvciB7XG4gICAgYnVmZmVyPVwiXCJcbiAgICBjdXJzb3JJbmRleD0wXG4gICAgaGlnaGxpZ2h0SW5kZXg9MFxuICAgIGxpc3RlbmVycz17XCJjdXJzb3JDaGFuZ2VkXCI6W10sXCJidWZmZXJDaGFuZ2VkXCI6W119XG4gICAgdmlld3BvcnRIZWlnaHQ9N1xuICAgIHZpZXdwb3J0V2lkdGg9MzBcbiAgICB2aWV3cG9ydFg9MFxuICAgIHZpZXdwb3J0WT0wXG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBidWZmZXJcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihidWZmZXIpIHtcbiAgICAgICAgdGhpcy5idWZmZXIgPSBidWZmZXJ8fFwiXCI7XG4gICAgfVxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtcImN1cnNvckNoYW5nZWRcInxcImJ1ZmZlckNoYW5nZWRcIn0gZXZlbnRUeXBlXG4gICAgICogQHBhcmFtIHsoZXZlbnREYXRhOlNpbXBsZVRleHRFZGl0b3IpPT4oKCk9PnZvaWQpfSBsaXN0ZW5lclxuICAgICAqL1xuICAgIG9uKGV2ZW50VHlwZSxsaXN0ZW5lcil7XG4gICAgICAgIHRoaXMubGlzdGVuZXJzW2V2ZW50VHlwZV09bGlzdGVuZXJcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7XCJjdXJzb3JDaGFuZ2VkXCJ8XCJidWZmZXJDaGFuZ2VkXCJ9IGV2ZW50VHlwZVxuICAgICAqIEBwYXJhbSB7U2ltcGxlVGV4dEVkaXRvcn0gcGF5bG9hZFxuICAgICAqL1xuICAgIF9kaXNwYXRjaEV2ZW50cyhldmVudFR5cGUscGF5bG9hZCl7XG4gICAgICAgIGNvbnN0IHRvS2VlcD1bXVxuICAgICAgICBmb3IobGV0IGxpc3RlbmVyIG9mIHRoaXMubGlzdGVuZXJzW2V2ZW50VHlwZV0pe1xuICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgIGNvbnN0IHVuc3Vic2NyaWJlPWxpc3RlbmVyKHBheWxvYWQpXG4gICAgICAgICAgICAgICAgaWYodHlwZW9mKHVuc3Vic2NyaWJlKSA9PT0gXCJmdW5jdGlvblwiKXtcbiAgICAgICAgICAgICAgICAgICAgdW5zdWJzY3JpYmUoKVxuICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICB0b0tlZXAucHVzaChsaXN0ZW5lcilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9Y2F0Y2goZXJyKXtcblxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRoaXMubGlzdGVuZXJzW2V2ZW50VHlwZV09dG9LZWVwXG4gICAgfVxuICAgIHNsaWRlVmlld3BvcnRUb0N1cnNvcigpe1xuICAgICAgICBsZXQge3gseX0gPSB0aGlzLmN1cnNvckNvb3JkcygpXG4gICAgICAgIGxldCB7dmlld3BvcnRIZWlnaHQ6dmgsIHZpZXdwb3J0V2lkdGg6dncsIHZpZXdwb3J0WDp2eCwgdmlld3BvcnRZOnZ5fT10aGlzXG4gICAgICAgIGlmICh5PHZ5KXtcbiAgICAgICAgICAgIHZ5PXlcbiAgICAgICAgfVxuICAgICAgICBpZih5Pih2eSt2aCkpe1xuICAgICAgICAgICAgdnkrPTFcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnZpZXdwb3J0WT12eVxuICAgIH1cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge3N0cmluZ1tdfVxuICAgICAqL1xuICAgIHJlbmRlclRvTGluZXMoc3RhcnQ9MCxoZWlnaHQpe1xuICAgICAgICBjb25zdCBsaW5lcyA9IHRoaXMuYnVmZmVyLnNwbGl0KFwiXFxuXCIpO1xuICAgICAgICBjb25zdCBlPXN0YXJ0KyhoZWlnaHR8fGxpbmVzLmxlbmd0aCk7XG4gICAgICAgIHJldHVybiBsaW5lcy5zbGljZShzdGFydCxlKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7e3k6IG51bWJlciwgeDogbnVtYmVyfX1cbiAgICAgKi9cbiAgICBjdXJzb3JDb29yZHMoKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuY3Vyc29ySW5kZXhUb0Nvb3Jkcyh0aGlzLmN1cnNvckluZGV4KVxuICAgIH1cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge3t5OiBudW1iZXIsIHg6IG51bWJlcn19XG4gICAgICovXG4gICAgaGlnaGxpZ2h0Q29vcmRzKCl7XG4gICAgICAgIHJldHVybiB0aGlzLmN1cnNvckluZGV4VG9Db29yZHModGhpcy5oaWdobGlnaHRJbmRleClcbiAgICB9XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gaW5kZXhcbiAgICAgKiBAcmV0dXJuIHt7eTogbnVtYmVyLCB4OiBudW1iZXJ9fVxuICAgICAqL1xuICAgIGN1cnNvckluZGV4VG9Db29yZHMoaW5kZXgpe1xuICAgICAgICBjb25zdCBsaW5lc1RvPXRoaXMuYnVmZmVyLnN1YnN0cmluZygwLHBhcnNlSW50KGluZGV4KSkuc3BsaXQoXCJcXG5cIik7XG4gICAgICAgIC8vY29uc29sZS5sb2coe2xpbmVzVG99KVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgeTpsaW5lc1RvLmxlbmd0aC0xLFxuICAgICAgICAgICAgeDpsaW5lc1RvW2xpbmVzVG8ubGVuZ3RoLTFdLmxlbmd0aFxuICAgICAgICB9XG4gICAgfVxuICAgIHNldEN1cnNvcih4LHkpe1xuICAgICAgICB0aGlzLmN1cnNvckluZGV4PXRoaXMuY3Vyc29yQ29vcmRzVG9JbmRleCh7eCx5fSlcbiAgICB9XG4gICAgc2V0SGlnaGxpZ2h0KHgseSl7XG4gICAgICAgIHRoaXMuaGlnaGxpZ2h0SW5kZXg9dGhpcy5jdXJzb3JDb29yZHNUb0luZGV4KHt4LHl9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHt7eDpOdW1iZXIseTpOdW1iZXJ9fSBjb29yZHNcbiAgICAgKiBAcmV0dXJuIHtOdW1iZXJ9XG4gICAgICovXG4gICAgY3Vyc29yQ29vcmRzVG9JbmRleChjb29yZHMpe1xuICAgICAgICBjb25zdCB7eCx5fSA9IGNvb3Jkc1xuICAgICAgICBjb25zdCBsaW5lcz10aGlzLmJ1ZmZlci5zcGxpdChcIlxcblwiKS5zbGljZSgwLHkpO1xuICAgICAgICAvL2NvbnNvbGUubG9nKHtsaW5lc30pXG4gICAgICAgIHJldHVybiBsaW5lcy5yZWR1Y2UoKGMsbCk9PmMrMStsLmxlbmd0aCwwKSArIHg7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gY2hcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5XG4gICAgICogQHJldHVybiB7U2ltcGxlVGV4dEVkaXRvcn1cbiAgICAgKi9cbiAgICBvbktleShjaCxrZXkpe1xuICAgICAgICBzd2l0Y2ggKGtleS5uYW1lKSB7XG4gICAgICAgICAgICBjYXNlICd1cCc6ICAgICAgdGhpcy5tb3ZlQ3Vyc29yVXAoKTsgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnZG93bic6ICAgIHRoaXMubW92ZUN1cnNvckRvd24oKTsgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnbGVmdCc6ICAgIHRoaXMubW92ZUN1cnNvckxlZnQoKTsgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAncmlnaHQnOiAgIHRoaXMubW92ZUN1cnNvclJpZ2h0KCk7IGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnaG9tZSc6ICAgIHRoaXMudG9Ib21lKCk7IDticmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2VuZCc6ICAgICAgdGhpcy50b0VuZCgpOyA7YnJlYWs7XG4gICAgICAgICAgICBjYXNlICdiYWNrc3BhY2UnOiB0aGlzLmJhY2tzcGFjZSgpOyAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdkZWxldGUnOiAgICB0aGlzLmRlbGV0ZSgpOyAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdyZXR1cm4nOiAgICB0aGlzLmluc2VydChcIlxcblwiKTt0aGlzLm1vdmVDdXJzb3JEb3duKCk7IGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAndGFiJzogICAgdGhpcy5pbnNlcnQoXCJcXHRcIik7ICBicmVhaztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgaWYgKGNoICYmIGNoLmxlbmd0aCA+IDApe1xuICAgICAgICAgICAgICAgICAgICBpZihrZXkubmFtZSAmJiBrZXkubmFtZS5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuaW5zZXJ0KGtleS5zZXF1ZW5jZSlcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuaW5zZXJ0KGNoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpXG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuICAgIHRva2VuVW5kZXJDdXJzb3IoeCx5LHRva2VuaXplcil7XG4gICAgICAgIGNvbnN0IGxpbmVzID0gdGhpcy5yZW5kZXJUb0xpbmVzKClcbiAgICAgICAgY29uc3QgbGluZSA9IGxpbmVzW3ldO1xuICAgICAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZXIobGluZSx5KVxuICAgICAgICBjb25zdCBwaHJhc2UgPSB0b2tlbnMubWFwKHY9PnYudHlwZSlcbiAgICAgICAgY29uc3QgdG9rZW5VbmRlckN1cnNvciA9IHRva2Vucy5maW5kKCh2LGksYSk9PntcbiAgICAgICAgICAgIHJldHVybiB2LnN0YXJ0PD14ICYmIHYuZW5kPj14O1xuICAgICAgICB9KVxuICAgICAgICByZXR1cm4gdG9rZW5VbmRlckN1cnNvclxuICAgIH1cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSBscG9zXG4gICAgICogQHBhcmFtIHtTY3JlZW59IHNjcmVlbkV2ZW50XG4gICAgICogQHBhcmFtIHRva2VuaXplclxuICAgICAqIEByZXR1cm4ge0VkaXRvckV2ZW50fVxuICAgICAqL1xuICAgIGdldEV2ZW50KGxwb3Msc2NyZWVuRXZlbnQsdG9rZW5pemVyKSB7XG4gICAgICAgIGNvbnN0IHt4aSx5aX0gPSBscG9zO1xuICAgICAgICBjb25zdCB7eCx5fSA9IHNjcmVlbkV2ZW50O1xuICAgICAgICBjb25zdCBjdXJzb3IgPSB0aGlzLmN1cnNvckNvb3JkcygpXG4gICAgICAgIGNvbnN0IGxpbmVzID0gdGhpcy5yZW5kZXJUb0xpbmVzKClcbiAgICAgICAgY29uc3QgbGluZSA9IGxpbmVzW2N1cnNvci55XTtcbiAgICAgICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemVyKGxpbmUseSlcbiAgICAgICAgY29uc3QgcGhyYXNlID0gdG9rZW5zLm1hcCh2PT52LnR5cGUpXG4gICAgICAgIGNvbnN0IHRva2VuVW5kZXJDdXJzb3IgPSB0b2tlbnMuZmluZCgodixpLGEpPT57XG4gICAgICAgICAgICByZXR1cm4gdi5zdGFydDw9Y3Vyc29yLnggJiYgdi5lbmQ+PWN1cnNvci54O1xuICAgICAgICB9KVxuICAgICAgICAvL3RoaXMuc2V0Q3Vyc29yKHgteGkrdGhpcy52aWV3cG9ydFgseS15aSt0aGlzLnZpZXdwb3J0WSlcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGV2ZW50OnNjcmVlbkV2ZW50LFxuICAgICAgICAgICAgcGFyZW50UG9zOnt4OnhpLHk6eWl9LFxuICAgICAgICAgICAgbGluZXM6bGluZXMsXG4gICAgICAgICAgICBsaW5lLFxuICAgICAgICAgICAgdmlzaWJsZUxpbmVzOmxpbmVzLFxuICAgICAgICAgICAgY3Vyc29yLFxuICAgICAgICAgICAgY3Vyc29yU2NyZWVuOnt4OmN1cnNvci54LXRoaXMudmlld3BvcnRYLHk6Y3Vyc29yLnktdGhpcy52aWV3cG9ydFl9LFxuICAgICAgICAgICAgYnVmZmVyOnRoaXMuYnVmZmVyLFxuICAgICAgICAgICAgdmlzaWJsZUJ1ZmZlcjp0aGlzLmJ1ZmZlcixcbiAgICAgICAgICAgIGluZGV4OnRoaXMuY3Vyc29ySW5kZXgsXG4gICAgICAgICAgICB0b2tlbnMsXG4gICAgICAgICAgICB0b2tlblVuZGVyQ3Vyc29yLFxuICAgICAgICAgICAgcGhyYXNlLFxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIG1vdmVDdXJzb3JVcCgpe1xuICAgICAgICBsZXQge3gseX0gPSB0aGlzLmN1cnNvckluZGV4VG9Db29yZHModGhpcy5jdXJzb3JJbmRleClcbiAgICAgICAgaWYgKHk+MCkge1xuICAgICAgICAgICAgdGhpcy5jdXJzb3JJbmRleD10aGlzLmN1cnNvckNvb3Jkc1RvSW5kZXgoe3g6eCx5OnktMX0pXG4gICAgICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIix0aGlzKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIG1vdmVDdXJzb3JEb3duKCl7XG4gICAgICAgIGxldCB7eCx5fSA9IHRoaXMuY3Vyc29ySW5kZXhUb0Nvb3Jkcyh0aGlzLmN1cnNvckluZGV4KVxuICAgICAgICBjb25zdCBsaW5lcz10aGlzLmJ1ZmZlci5zcGxpdChcIlxcblwiKVxuICAgICAgICBpZiAoeTwobGluZXMubGVuZ3RoLTEpKSB7XG4gICAgICAgICAgICB0aGlzLmN1cnNvckluZGV4PXRoaXMuY3Vyc29yQ29vcmRzVG9JbmRleCh7eDp4LHk6eSsxfSlcbiAgICAgICAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnRzKFwiY3Vyc29yQ2hhbmdlZFwiLHRoaXMpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NpbXBsZVRleHRFZGl0b3J9XG4gICAgICovXG4gICAgbW92ZUN1cnNvckxlZnQoKXtcbiAgICAgICAgaWYodGhpcy5jdXJzb3JJbmRleD4wKXtcbiAgICAgICAgICAgIHRoaXMuY3Vyc29ySW5kZXgtPTFcbiAgICAgICAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnRzKFwiY3Vyc29yQ2hhbmdlZFwiLHRoaXMpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NpbXBsZVRleHRFZGl0b3J9XG4gICAgICovXG4gICAgbW92ZUN1cnNvclJpZ2h0KCl7XG4gICAgICAgIGlmKHRoaXMuY3Vyc29ySW5kZXg8dGhpcy5idWZmZXIubGVuZ3RoKXtcbiAgICAgICAgICAgIHRoaXMuY3Vyc29ySW5kZXgrPTFcbiAgICAgICAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnRzKFwiY3Vyc29yQ2hhbmdlZFwiLHRoaXMpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NpbXBsZVRleHRFZGl0b3J9XG4gICAgICovXG4gICAgdG9Ib21lKCl7XG4gICAgICAgIGxldCB7eCx5fSA9IHRoaXMuY3Vyc29ySW5kZXhUb0Nvb3Jkcyh0aGlzLmN1cnNvckluZGV4KVxuICAgICAgICB0aGlzLmN1cnNvckluZGV4PXRoaXMuY3Vyc29yQ29vcmRzVG9JbmRleCh7eDowLHk6eX0pXG4gICAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnRzKFwiY3Vyc29yQ2hhbmdlZFwiLHRoaXMpXG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIHRvRW5kKCl7XG4gICAgICAgIGxldCB7eCx5fSA9IHRoaXMuY3Vyc29ySW5kZXhUb0Nvb3Jkcyh0aGlzLmN1cnNvckluZGV4KVxuICAgICAgICBjb25zdCBsaW5lPXRoaXMuYnVmZmVyLnNwbGl0KFwiXFxuXCIpW3ldXG4gICAgICAgIHRoaXMuY3Vyc29ySW5kZXg9dGhpcy5jdXJzb3JDb29yZHNUb0luZGV4KHt4OmxpbmUubGVuZ3RoLHk6eX0pXG4gICAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnRzKFwiY3Vyc29yQ2hhbmdlZFwiLHRoaXMpXG4gICAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTaW1wbGVUZXh0RWRpdG9yfVxuICAgICAqL1xuICAgIGJhY2tzcGFjZSgpe1xuICAgICAgICBpZih0aGlzLmN1cnNvckluZGV4PjApe1xuICAgICAgICAgICAgdGhpcy5jdXJzb3JJbmRleCAtPSAxXG4gICAgICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImN1cnNvckNoYW5nZWRcIiwgdGhpcylcbiAgICAgICAgICAgIGNvbnN0IGJlZm9yZT10aGlzLmJ1ZmZlci5zdWJzdHJpbmcoMCx0aGlzLmN1cnNvckluZGV4KVxuICAgICAgICAgICAgY29uc3QgYWZ0ZXI9dGhpcy5idWZmZXIuc3Vic3RyaW5nKHRoaXMuY3Vyc29ySW5kZXgrMSlcbiAgICAgICAgICAgIHRoaXMuYnVmZmVyPWJlZm9yZSthZnRlclxuICAgICAgICAgICAgdGhpcy5fZGlzcGF0Y2hFdmVudHMoXCJidWZmZXJDaGFuZ2VkXCIsdGhpcylcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NpbXBsZVRleHRFZGl0b3J9XG4gICAgICovXG4gICAgZGVsZXRlKCl7XG4gICAgICAgIGNvbnN0IGJlZm9yZT10aGlzLmJ1ZmZlci5zdWJzdHJpbmcoMCx0aGlzLmN1cnNvckluZGV4KzEpXG4gICAgICAgIGNvbnN0IGFmdGVyPXRoaXMuYnVmZmVyLnN1YnN0cmluZyh0aGlzLmN1cnNvckluZGV4KzIpXG4gICAgICAgIHRoaXMuYnVmZmVyPWJlZm9yZSthZnRlclxuICAgICAgICB0aGlzLl9kaXNwYXRjaEV2ZW50cyhcImJ1ZmZlckNoYW5nZWRcIix0aGlzKVxuICAgICAgICByZXR1cm4gdGhpc1xuICAgIH1cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NpbXBsZVRleHRFZGl0b3J9XG4gICAgICovXG4gICAgaW5zZXJ0KGNoKXtcbiAgICAgICAgdGhpcy5jdXJzb3JJbmRleCs9MVxuICAgICAgICBjb25zdCBiZWZvcmU9dGhpcy5idWZmZXIuc3Vic3RyaW5nKDAsdGhpcy5jdXJzb3JJbmRleC0xKVxuICAgICAgICBjb25zdCBhZnRlcj10aGlzLmJ1ZmZlci5zdWJzdHJpbmcodGhpcy5jdXJzb3JJbmRleC0xKVxuICAgICAgICB0aGlzLmJ1ZmZlcj1iZWZvcmUrY2grYWZ0ZXJcbiAgICAgICAgdGhpcy5fZGlzcGF0Y2hFdmVudHMoXCJidWZmZXJDaGFuZ2VkXCIsdGhpcylcbiAgICAgICAgdGhpcy5fZGlzcGF0Y2hFdmVudHMoXCJjdXJzb3JDaGFuZ2VkXCIsdGhpcylcbiAgICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge1NpbXBsZVRleHRFZGl0b3J9XG4gICAgICovXG4gICAgY29weSgpe1xuICAgICAgICBjb25zdCBuZXdTaW1wbGVUZXh0QnVmZmVyPSBuZXcgU2ltcGxlVGV4dEVkaXRvcigpXG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIuYnVmZmVyID0gdGhpcy5idWZmZXJcbiAgICAgICAgbmV3U2ltcGxlVGV4dEJ1ZmZlci5jdXJzb3JJbmRleCA9IHRoaXMuY3Vyc29ySW5kZXhcbiAgICAgICAgbmV3U2ltcGxlVGV4dEJ1ZmZlci5oaWdobGlnaHRJbmRleCA9IHRoaXMuaGlnaGxpZ2h0SW5kZXhcbiAgICAgICAgbmV3U2ltcGxlVGV4dEJ1ZmZlci52aWV3cG9ydEhlaWdodD10aGlzLnZpZXdwb3J0SGVpZ2h0XG4gICAgICAgIG5ld1NpbXBsZVRleHRCdWZmZXIudmlld3BvcnRXaWR0aD10aGlzLnZpZXdwb3J0V2lkdGhcbiAgICAgICAgbmV3U2ltcGxlVGV4dEJ1ZmZlci52aWV3cG9ydFg9dGhpcy52aWV3cG9ydFhcbiAgICAgICAgbmV3U2ltcGxlVGV4dEJ1ZmZlci52aWV3cG9ydFk9dGhpcy52aWV3cG9ydFlcbiAgICAgICAgcmV0dXJuIG5ld1NpbXBsZVRleHRCdWZmZXJcbiAgICB9XG59IiwiaW1wb3J0IFJlYWN0LCB7dXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlfSBmcm9tIFwicmVhY3RcIjtcbmltcG9ydCB7XG4gICAgTGlzdEVsZW1lbnQgYXMgbGlzdCxcbiAgICBCb3hFbGVtZW50IGFzIGJveCxcbiAgICBCdXR0b25FbGVtZW50IGFzIGJ1dHRvbixcbiAgICBUZXh0YXJlYUVsZW1lbnQgYXMgdGV4dGFyZWEsXG4gICAgVGV4dEVsZW1lbnQgYXMgdGV4dFxufSBmcm9tICdyZWFjdC1ibGVzc2VkJztcbmltcG9ydCB7U2ltcGxlVGV4dEVkaXRvcixFZGl0b3JFdmVudH0gZnJvbSBcIi4vU2ltcGxlVGV4dEVkaXRvci5qc1wiO1xuaW1wb3J0IHtkZWJvdW5jZWQsIHNhZmVTdHJpbmdpZnl9IGZyb20gXCIuL3V0aWxcIjtcbmltcG9ydCB7Z2V0TmFtZWRUb2tlbml6ZXIsIGdldFRva2VuaXplcn0gZnJvbSBcIi4vdG9rZW5pemVyXCI7XG5pbXBvcnQge1NjcmVlbkV2ZW50fSBmcm9tIFwicmVhY3QtYmxlc3NlZFwiO1xuXG5cbi8qKlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nW119IGxpbmVzXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGVkaXRhYmxlXG4gKiBAcGFyYW0geyhlZGl0b3JFdmVudDpFZGl0b3JFdmVudCk9PnZvaWR9IG9uQ2xpY2tcbiAqIEBwYXJhbSB7KGVkaXRvckV2ZW50OkVkaXRvckV2ZW50KT0+dm9pZH0gb25MaW5lQ2xpY2tcbiAqIEBwYXJhbSB7KGVkaXRvckV2ZW50OkVkaXRvckV2ZW50KT0+dm9pZH0gb25MaW5lSG92ZXJcbiAqIEBwYXJhbSB7KGVkaXRvckV2ZW50OkVkaXRvckV2ZW50KT0+dm9pZH0gb25Ub2tlbkNsaWNrXG4gKiBAcGFyYW0geyhlZGl0b3JFdmVudDpFZGl0b3JFdmVudCk9PnZvaWR9IG9uVG9rZW5Ib3ZlclxuICogQHBhcmFtIHtUb2tlbml6ZXJEZWZ9IHRva2VuaXplckRlZlxuICogQHBhcmFtIHtOb2RlV2l0aEV2ZW50c1tdfSBjaGlsZHJlblxuICogQHBhcmFtIHthbnlbXX0gYm94UHJvcHNcbiAqIEByZXR1cm4ge0VsZW1lbnR9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBMaXN0Q29tcG9uZW50KHtcbiAgbGluZXMsXG4gIGVkaXRhYmxlID0gZmFsc2UsXG4gIGRlZmF1bHRUZXh0PScuLi4nLFxuICBvbkxpbmVDbGljaz0oZWRpdG9yRXZlbnQpPT57fSxcbiAgb25Ub2tlbkNsaWNrPShlZGl0b3JFdmVudCk9Pnt9LFxuICBvbkxpbmVIb3Zlcj0oZWRpdG9yRXZlbnQpPT57fSxcbiAgb25Ub2tlbkhvdmVyPShlZGl0b3JFdmVudCk9Pnt9LFxuICB0b2tlbml6ZXJEZWYsXG4gIGNoaWxkcmVuLFxuICAuLi5ib3hQcm9wc1xufSkge1xuICAgIGNvbnN0IGJveFJlZiA9IHVzZVJlZihudWxsKTtcbiAgICBjb25zdCBbZWRpdG9yLCBzZXRFZGl0b3JdID0gdXNlU3RhdGUobnVsbCk7XG4gICAgY29uc3QgW3NpemUsIHNldFNpemVdICAgICA9IHVzZVN0YXRlKHsgcm93czogMTAsIGNvbHM6IDMwIH0pO1xuXG4gICAgbGV0IGNoYW5nZWRUaW1lb3V0PTBcbiAgICB1c2VFZmZlY3QoKCk9PntcbiAgICAgICAgbGV0IG5ld0VkaXRvcj1lZGl0b3JcbiAgICAgICAgaWYoIW5ld0VkaXRvcil7XG4gICAgICAgICAgICBuZXdFZGl0b3IgPSBuZXcgU2ltcGxlVGV4dEVkaXRvcihsaW5lcy5qb2luKFwiXFxuXCIpfHxkZWZhdWx0VGV4dClcbiAgICAgICAgfVxuICAgICAgICBpZigobGluZXMuam9pbihcIlxcblwiKXx8ZGVmYXVsdFRleHQpLnN1YnN0cmluZyhuZXdFZGl0b3IuY3Vyc29ySW5kZXgpIT09bmV3RWRpdG9yLmJ1ZmZlci5zdWJzdHJpbmcobmV3RWRpdG9yLmN1cnNvckluZGV4KSl7XG4gICAgICAgICAgICBuZXdFZGl0b3Iuc2xpZGVWaWV3cG9ydFRvQ3Vyc29yKClcbiAgICAgICAgfVxuICAgICAgICBuZXdFZGl0b3IuYnVmZmVyPWxpbmVzLmpvaW4oXCJcXG5cIil8fGRlZmF1bHRUZXh0XG4gICAgICAgIG5ld0VkaXRvci52aWV3cG9ydEhlaWdodCA9IHNpemUucm93cy0xO1xuICAgICAgICBuZXdFZGl0b3Iudmlld3BvcnRXaWR0aCA9IHNpemUuY29scztcbiAgICAgICAgc2V0RWRpdG9yKG5ld0VkaXRvci5jb3B5KCkpXG4gICAgfSxbbGluZXNdKVxuXG4gICAgLy8gMikgdXBkYXRlIHNpemUgb24gcmVzaXplXG4gICAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICAgICAgY29uc3QgYm94ID0gYm94UmVmLmN1cnJlbnQ7XG4gICAgICAgIGlmICghYm94KSByZXR1cm47XG4gICAgICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IHtcbiAgICAgICAgICAgIHNldFNpemUoeyBjb2xzOiBib3gud2lkdGgsIHJvd3M6IGJveC5oZWlnaHQtMiB9KTtcbiAgICAgICAgfTtcbiAgICAgICAgdXBkYXRlKCk7XG4gICAgICAgIGJveC5vbigncmVzaXplJywgdXBkYXRlKTtcbiAgICAgICAgcmV0dXJuICgpID0+IGJveC5yZW1vdmVMaXN0ZW5lcigncmVzaXplJywgdXBkYXRlKTtcbiAgICB9LCBbXSk7XG5cbiAgICAvLyBydW4gb25jZSBvbiBzaXplIGNoYW5nZVxuICAgIHVzZUVmZmVjdCgoKT0+e1xuICAgICAgICBpZihlZGl0b3Ipe1xuICAgICAgICAgICAgZWRpdG9yLnZpZXdwb3J0V2lkdGggPSBzaXplLmNvbHM7XG4gICAgICAgICAgICBlZGl0b3Iudmlld3BvcnRIZWlnaHQgPSBzaXplLnJvd3M7XG4gICAgICAgICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICAgICAgfVxuICAgIH0sIFtzaXplXSk7XG5cbiAgICBjb25zdCBpbnRlcm5hbE9uS2V5UHJlc3M9KGNoLGtleSk9PntcbiAgICAgICAgaWYoZWRpdGFibGUpIHtcbiAgICAgICAgICAgIGVkaXRvci5vbktleShjaCwga2V5KVxuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KGNoYW5nZWRUaW1lb3V0KVxuICAgICAgICAgICAgY2hhbmdlZFRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBvbkNoYW5nZShlZGl0b3IpXG4gICAgICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgICAgICB9LCA4MClcbiAgICAgICAgfWVsc2UgaWYgKCBrZXkgaW4gWyd1cCcsJ2Rvd24nXSApe1xuICAgICAgICAgICAgZWRpdG9yLm9uS2V5KGNoLCBrZXkpXG4gICAgICAgICAgICBjaGFuZ2VkVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIG9uQ2hhbmdlKGVkaXRvcilcbiAgICAgICAgICAgICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICAgICAgICAgIH0sIDgwKVxuICAgICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGdldEV2ZW50ID0gKHNjcmVlbkV2ZW50KSA9PiB7XG4gICAgICAgIGlmKCFlZGl0b3Ipe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHRva2VuaXplcj1nZXRUb2tlbml6ZXIodG9rZW5pemVyRGVmfHx7XG4gICAgICAgICAgICBuYW1lOid3b3JkcycsXG4gICAgICAgICAgICBmbGFnczonbWcnLFxuICAgICAgICAgICAgZGVmaW5pdGlvbnM6e1xuICAgICAgICAgICAgICAgIFdoaXRlc3BhY2U6ICAgICAgIHtzdHlsZToge2ZnOidyZWQnfSxwYXR0ZXJuOi9cXHMrL2dpfSxcbiAgICAgICAgICAgICAgICBXb3JkOiAgICAgICAgICAgICB7c3R5bGU6IHtmZzonZ3JlZW4nfSxwYXR0ZXJuOi9cXGIuKz9cXGIvZ2l9LFxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgICBjb25zdCBldnQgPSBlZGl0b3IuZ2V0RXZlbnQoYm94UmVmLmN1cnJlbnQubHBvcyxzY3JlZW5FdmVudCx0b2tlbml6ZXIpO1xuXG4gICAgICAgIC8vIGVkaXRvci5zZXRDdXJzb3Ioc2NyZWVuRXZlbnQueC1ib3hSZWYuY3VycmVudC5scG9zLnhpK2VkaXRvci52aWV3cG9ydFgsc2NyZWVuRXZlbnQueS1ib3hSZWYuY3VycmVudC5scG9zLnlpK2VkaXRvci52aWV3cG9ydFkpXG4gICAgICAgIHJldHVybiBldnRcbiAgICB9XG4gICAgY29uc3Qgb25tb3VzZW1vdmU9ZGVib3VuY2VkKChzY3JlZW5FdmVudCk9PntcbiAgICAgICAgY29uc3QgbmV3RXZlbnQgPSBnZXRFdmVudChzY3JlZW5FdmVudClcbiAgICAgICAgZWRpdG9yLnNldEhpZ2hsaWdodChuZXdFdmVudC5jdXJzb3JTY3JlZW4ueCArIGVkaXRvci52aWV3cG9ydFgsIG5ld0V2ZW50LmN1cnNvclNjcmVlbi55ICsgZWRpdG9yLnZpZXdwb3J0WSlcbiAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgIG9uTGluZUhvdmVyKG5ld0V2ZW50KTtcbiAgICAgICAgb25Ub2tlbkhvdmVyKG5ld0V2ZW50KTtcbiAgICB9LDEwKVxuICAgIGNvbnN0IG1vdXNlQWN0aW9uPShzY3JlZW5FdmVudCkgPT57XG5cbiAgICAgICAgc3dpdGNoKHNjcmVlbkV2ZW50LmFjdGlvbil7XG4gICAgICAgICAgICBjYXNlICdtb3VzZW1vdmUnOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0V2ZW50ID0gZ2V0RXZlbnQoc2NyZWVuRXZlbnQpXG4gICAgICAgICAgICAgICAgICAgIGVkaXRvci5zZXRIaWdobGlnaHQobmV3RXZlbnQuY3Vyc29yU2NyZWVuLnggKyBlZGl0b3Iudmlld3BvcnRYLCBuZXdFdmVudC5jdXJzb3JTY3JlZW4ueSArIGVkaXRvci52aWV3cG9ydFkpXG4gICAgICAgICAgICAgICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpPT57XG4gICAgICAgICAgICAgICAgICAgICAgICBvbkxpbmVIb3ZlcihuZXdFdmVudCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBvblRva2VuSG92ZXIobmV3RXZlbnQpO1xuICAgICAgICAgICAgICAgICAgICB9LDEpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnbW91c2Vkb3duJzoge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXdFdmVudCA9IGdldEV2ZW50KHNjcmVlbkV2ZW50KVxuICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkaXRvci5zZXRDdXJzb3Ioc2NyZWVuRXZlbnQueC1ib3hSZWYuY3VycmVudC5scG9zLnhpK2VkaXRvci52aWV3cG9ydFgsc2NyZWVuRXZlbnQueS1ib3hSZWYuY3VycmVudC5scG9zLnlpK2VkaXRvci52aWV3cG9ydFkpXG4gICAgICAgICAgICAgICAgICAgICAgICBlZGl0b3Iuc2V0SGlnaGxpZ2h0KG5ld0V2ZW50LmN1cnNvclNjcmVlbi54ICsgZWRpdG9yLnZpZXdwb3J0WCwgbmV3RXZlbnQuY3Vyc29yU2NyZWVuLnkgKyBlZGl0b3Iudmlld3BvcnRZKVxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgICAgICAgICAgICAgIH0sIDEpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnbW91c2V1cCc6IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3RXZlbnQgPSBnZXRFdmVudChzY3JlZW5FdmVudClcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qge3gseX0gPSBzY3JlZW5FdmVudDtcbiAgICAgICAgICAgICAgICAgICAgLy8gc2V0TGFzdEV2ZW50KG5ld0V2ZW50KTtcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKT0+e1xuICAgICAgICAgICAgICAgICAgICAgICAgZWRpdG9yLnNldEhpZ2hsaWdodChudWxsKVxuICAgICAgICAgICAgICAgICAgICAgICAgZWRpdG9yLnNldEN1cnNvcihzY3JlZW5FdmVudC54LWJveFJlZi5jdXJyZW50Lmxwb3MueGkrZWRpdG9yLnZpZXdwb3J0WCxzY3JlZW5FdmVudC55LWJveFJlZi5jdXJyZW50Lmxwb3MueWkrZWRpdG9yLnZpZXdwb3J0WSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkaXRvci5zZXRIaWdobGlnaHQobmV3RXZlbnQuY3Vyc29yU2NyZWVuLnggKyBlZGl0b3Iudmlld3BvcnRYLCBuZXdFdmVudC5jdXJzb3JTY3JlZW4ueSArIGVkaXRvci52aWV3cG9ydFkpXG4gICAgICAgICAgICAgICAgICAgICAgICBvbkxpbmVDbGljayhuZXdFdmVudCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBvblRva2VuQ2xpY2sobmV3RXZlbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgICAgICAgICAgICAgIH0sMSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICd3aGVlbHVwJzoge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXdFdmVudCA9IGdldEV2ZW50KHNjcmVlbkV2ZW50KVxuICAgICAgICAgICAgICAgICAgICBlZGl0b3IubW92ZUN1cnNvclVwKCkuc2xpZGVWaWV3cG9ydFRvQ3Vyc29yKCk7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCk9PntcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkaXRvci5zZXRIaWdobGlnaHQobnVsbClcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGVkaXRvci5zZXRDdXJzb3Ioc2NyZWVuRXZlbnQueC1ib3hSZWYuY3VycmVudC5scG9zLnhpK2VkaXRvci52aWV3cG9ydFgsc2NyZWVuRXZlbnQueS1ib3hSZWYuY3VycmVudC5scG9zLnlpK2VkaXRvci52aWV3cG9ydFkpXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICAgICAgICAgICAgICAgICAgfSwxKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ3doZWVsZG93bic6IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV3RXZlbnQgPSBnZXRFdmVudChzY3JlZW5FdmVudClcbiAgICAgICAgICAgICAgICAgICAgZWRpdG9yLm1vdmVDdXJzb3JEb3duKCkuc2xpZGVWaWV3cG9ydFRvQ3Vyc29yKCk7XG4gICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCk9PntcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkaXRvci5zZXRIaWdobGlnaHQobnVsbClcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGVkaXRvci5zZXRDdXJzb3Ioc2NyZWVuRXZlbnQueC1ib3hSZWYuY3VycmVudC5scG9zLnhpK2VkaXRvci52aWV3cG9ydFgsc2NyZWVuRXZlbnQueS1ib3hSZWYuY3VycmVudC5scG9zLnlpK2VkaXRvci52aWV3cG9ydFkpXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICAgICAgICAgICAgICAgICAgfSwxKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGRlZmF1bHQ6IHRocm93IG5ldyBFcnJvcihzYWZlU3RyaW5naWZ5KHNjcmVlbkV2ZW50KSk7IGJyZWFrO1xuICAgICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHJlbmRlckxpbmVzID0gKCkgPT4ge1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB7dmlld3BvcnRZOnZ5LHZpZXdwb3J0SGVpZ2h0OnZofSA9IGVkaXRvclxuICAgICAgICByZXR1cm4gZWRpdG9yLnJlbmRlclRvTGluZXMoKVxuICAgICAgICAgICAgLmZpbHRlcigobCx5KSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICh5ID49dnkgJiYgeSA8PSAodnkgKyB2aCkpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5mbGF0TWFwKChsaW5lLGluZGV4LGFycik9PntcbiAgICAgICAgICAgICAgICBjb25zdCByZW5kZXJhYmxlcyA9IFtcbiAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAga2V5PXtgbGlzdGMtbGluZS0ke2luZGV4fS0ke0RhdGUubm93fWB9XG4gICAgICAgICAgICAgICAgICAgICAgICB0b3A9e2luZGV4fSBsZWZ0PXswfSBoZWlnaHQ9ezF9IHdpZHRoPXtsaW5lLmxlbmd0aHx8MX1cbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ9e2xpbmV9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIGNvbnN0IHRva2VuaXplcj1nZXRUb2tlbml6ZXIodG9rZW5pemVyRGVmfHx7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6J3dvcmRzJyxcbiAgICAgICAgICAgICAgICAgICAgZmxhZ3M6J21nJyxcbiAgICAgICAgICAgICAgICAgICAgZGVmaW5pdGlvbnM6e1xuICAgICAgICAgICAgICAgICAgICAgICAgV2hpdGVzcGFjZTogICAgICAge3N0eWxlOiB7Zmc6J3JlZCd9LHBhdHRlcm46L1xccysvbWlnfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIFdvcmQ6ICAgICAgICAgICAgIHtzdHlsZToge2ZnOidncmVlbid9LHBhdHRlcm46L1xcYi4rP1xcYi9taWd9LFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZXIobGluZSxpbmRleClcbiAgICAgICAgICAgICAgICB0b2tlbnMuZm9yRWFjaCgodG9rZW4saik9PntcbiAgICAgICAgICAgICAgICAgICAgcmVuZGVyYWJsZXMucHVzaChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBrZXk9e2BsaXN0Yy1saW5lLSR7aW5kZXh9LXRva2VuLSR7an0tJHtEYXRlLm5vd31gfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvcD17aW5kZXh9IGxlZnQ9e3Rva2VuLnN0YXJ0fSBoZWlnaHQ9ezF9IHdpZHRoPXt0b2tlbi50ZXh0Lmxlbmd0aHx8MX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50PXt0b2tlbi50ZXh0fSBzdHlsZT17dG9rZW4uc3R5bGV9XG4gICAgICAgICAgICAgICAgICAgICAgICAvPilcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIHJldHVybiByZW5kZXJhYmxlc1xuICAgICAgICAgICAgfSlcbiAgICB9XG4gICAgY29uc3QgcmVuZGVyQ3Vyc29yID0gKCkgPT4ge1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBpID0gZWRpdG9yLmN1cnNvckluZGV4XG4gICAgICAgIGNvbnN0IHt4LHl9ID0gZWRpdG9yLmN1cnNvckNvb3JkcygpXG4gICAgICAgIGNvbnN0IHtjdXJzb3JJbmRleDpjaSx2aWV3cG9ydFg6dngsdmlld3BvcnRZOnZ5LHZpZXdwb3J0SGVpZ2h0OnZoLHZpZXdwb3J0V2lkdGg6dnd9ID0gZWRpdG9yO1xuICAgICAgICByZXR1cm4gKDxib3hcbiAgICAgICAgICAgIGtleT17YGVkaXRvci1jdXJzb3ItJHtEYXRlLm5vdygpfWB9XG4gICAgICAgICAgICB0b3A9e3ktdnl9XG4gICAgICAgICAgICBsZWZ0PXt4LXZ4fVxuICAgICAgICAgICAgd2lkdGg9ezF9IGhlaWdodD17MX1cbiAgICAgICAgICAgIHN0eWxlPXt7aW52ZXJzZTp0cnVlfX1cbiAgICAgICAgICAgIGNvbnRlbnQ9e2VkaXRvci5idWZmZXIuc3Vic3RyaW5nKGksaSsxKX1cbiAgICAgICAgLz4pXG4gICAgfVxuICAgIGNvbnN0IHJlbmRlckhpZ2hsaWdodD0oKT0+e1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBpID0gZWRpdG9yLmN1cnNvckluZGV4XG4gICAgICAgIGNvbnN0IHt4LHl9ID0gZWRpdG9yLmhpZ2hsaWdodENvb3JkcygpXG4gICAgICAgIGNvbnN0IHtjdXJzb3JJbmRleDpjaSx2aWV3cG9ydFg6dngsdmlld3BvcnRZOnZ5LHZpZXdwb3J0SGVpZ2h0OnZoLHZpZXdwb3J0V2lkdGg6dnd9ID0gZWRpdG9yO1xuICAgICAgICBjb25zdCB0b2tlbml6ZXI9Z2V0VG9rZW5pemVyKHRva2VuaXplckRlZnx8e1xuICAgICAgICAgICAgbmFtZTond29yZHMnLFxuICAgICAgICAgICAgZmxhZ3M6J21nJyxcbiAgICAgICAgICAgIGRlZmluaXRpb25zOntcbiAgICAgICAgICAgICAgICBXaGl0ZXNwYWNlOiAgICAgICB7c3R5bGU6IHtmZzoncmVkJ30scGF0dGVybjovXFxzKy9taWd9LFxuICAgICAgICAgICAgICAgIFdvcmQ6ICAgICAgICAgICAgIHtzdHlsZToge2ZnOidncmVlbid9LHBhdHRlcm46L1xcYi4rP1xcYi9taWd9LFxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgICBjb25zdCB0b2tlblVuZGVyQ3Vyc29yPWVkaXRvci50b2tlblVuZGVyQ3Vyc29yKHgseSx0b2tlbml6ZXIpXG4gICAgICAgIGlmKHRva2VuVW5kZXJDdXJzb3IpIHtcbiAgICAgICAgICAgIHJldHVybiAoPGJveFxuICAgICAgICAgICAgICAgIGtleT17YGVkaXRvci1oaWdobGlnaHQtJHtEYXRlLm5vdygpfWB9XG4gICAgICAgICAgICAgICAgdG9wPXt5IC0gdnl9XG4gICAgICAgICAgICAgICAgbGVmdD17dG9rZW5VbmRlckN1cnNvci5zdGFydH1cbiAgICAgICAgICAgICAgICB3aWR0aD17dG9rZW5VbmRlckN1cnNvci50ZXh0Lmxlbmd0aH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgICAgIHN0eWxlPXt7Li4udG9rZW5VbmRlckN1cnNvci5zdHlsZSwgaW52ZXJzZTogdHJ1ZX19XG4gICAgICAgICAgICAgICAgY29udGVudD17dG9rZW5VbmRlckN1cnNvci50ZXh0fVxuICAgICAgICAgICAgLz4pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gW11cbiAgICAgICAgfVxuICAgIH1cbiAgICBjb25zdCByZW5kZXJTY3JvbGxiYXIgPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGJhckVsZW1lbnRzPSBbKDxib3hcbiAgICAgICAgICAgIGtleT17YHNjcm9sbGJhci1iZy0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgIHJpZ2h0PXswfVxuICAgICAgICAgICAgd2lkdGg9ezF9XG4gICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgc3R5bGU9e3tmZzogJ2N5YW4nLGJnOiAnZ3JleSd9fVxuICAgICAgICAvPildO1xuICAgICAgICBpZighZWRpdG9yKXtcbiAgICAgICAgICAgIHJldHVybiBiYXJFbGVtZW50c1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHRoPWVkaXRvci5yZW5kZXJUb0xpbmVzKCkubGVuZ3RoXG5cbiAgICAgICAgY29uc3Qge2N1cnNvckluZGV4OmNpLHZpZXdwb3J0WDp2eCx2aWV3cG9ydFk6dnksdmlld3BvcnRIZWlnaHQ6dmgsdmlld3BvcnRXaWR0aDp2d30gPSBlZGl0b3I7XG4gICAgICAgIGNvbnN0IHNoPU1hdGguZmxvb3IodmgqdmgvdGgpKzFcbiAgICAgICAgY29uc3Qgc3k9TWF0aC5mbG9vcih2eSp2aC90aCkrMVxuICAgICAgICBiYXJFbGVtZW50cy5wdXNoKCg8Ym94XG4gICAgICAgICAgICBrZXk9e2BzY3JvbGxiYXItYnRuLSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgcmlnaHQ9ezB9XG4gICAgICAgICAgICB3aWR0aD17MX1cbiAgICAgICAgICAgIHRvcD17c3l9XG4gICAgICAgICAgICBoZWlnaHQ9e3NofVxuICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgIHN0eWxlPXt7Zmc6ICdjeWFuJyxiZzogJ2N5YW4nfX1cbiAgICAgICAgLz4pKVxuICAgICAgICByZXR1cm4gYmFyRWxlbWVudHNcbiAgICB9XG4gICAgY29uc3QgcmVuZGVyU3RhdHVzPSgpPT57XG4gICAgICAgIGlmKCFlZGl0b3Ipe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHt2aWV3cG9ydFg6dngsdmlld3BvcnRZOnZ5LHZpZXdwb3J0SGVpZ2h0OnZoLHZpZXdwb3J0V2lkdGg6dnd9ID0gZWRpdG9yXG4gICAgICAgIGNvbnN0IHQ9SlNPTi5zdHJpbmdpZnkoZWRpdG9yLmN1cnNvckNvb3JkcygpKS5yZXBsYWNlKC9cIi9naSwnJylcbiAgICAgICAgcmV0dXJuICg8Ym94XG4gICAgICAgICAgICBtb3VzZSBrZXlzXG4gICAgICAgICAgICBrZXk9e2BlZGl0b3Itc3RhdHVzLSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgdG9wPXstMX1cbiAgICAgICAgICAgIGxlZnQ9e3Z3LTExfVxuICAgICAgICAgICAgd2lkdGg9e3QubGVuZ3RofSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBzdHlsZT17e2ludmVyc2U6dHJ1ZX19XG4gICAgICAgICAgICBjb250ZW50PXt0fVxuICAgICAgICAvPilcbiAgICB9XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveFxuICAgICAgICAgICAgcmVmPXtib3hSZWZ9XG4gICAgICAgICAgICB7Li4uYm94UHJvcHN9XG4gICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgc3R5bGU9e3sgYm9yZGVyOiB7IGZnOiAnY3lhbicgfSB9fVxuICAgICAgICAgICAgdGFncz17ZmFsc2V9ICAgICAgICAgICAvLyByYXcgQU5TSVxuICAgICAgICAgICAgc2Nyb2xsYWJsZT17ZmFsc2V9XG4gICAgICAgICAgICBvbktleXByZXNzPXtpbnRlcm5hbE9uS2V5UHJlc3N9XG4gICAgICAgICAgICBvbk1vdXNlPXttb3VzZUFjdGlvbn1cbiAgICAgICAgPlxuICAgICAgICAgICAgey8qbGFiZWwgPSB7YCR7Ym94UHJvcHMubGFiZWwgfHwgJ0VkaXRpbmcnfSAke0pTT04uc3RyaW5naWZ5KGVkaXRvci5jdXJzb3JDb29yZHMoKSl9ICR7ZWRpdG9yLmN1cnNvckluZGV4fWB9Ki99XG4gICAgICAgICAgICB7cmVuZGVyTGluZXMoKX1cbiAgICAgICAgICAgIHtyZW5kZXJDdXJzb3IoKX1cbiAgICAgICAgICAgIHtyZW5kZXJTY3JvbGxiYXIoKX1cbiAgICAgICAgICAgIHtjaGlsZHJlbnx8W119XG4gICAgICAgICAgICB7cmVuZGVySGlnaGxpZ2h0KCl9XG4gICAgICAgICAgICB7cmVuZGVyU3RhdHVzKCl9XG4gICAgICAgIDwvYm94Pilcbn0iLCIvLyBzcmMvRmlsZVRyZWUuanNcbmltcG9ydCBSZWFjdCwge0NvbXBvbmVudCwgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlfSBmcm9tICdyZWFjdCc7XG5pbXBvcnQgeyBMaXN0RWxlbWVudCBhcyBsaXN0LCBUZXh0RWxlbWVudCBhcyB0ZXh0LCBCb3hFbGVtZW50IGFzIGJveCB9IGZyb20gJ3JlYWN0LWJsZXNzZWQnO1xuaW1wb3J0IHsgV29ya3NwYWNlLElOb2RlIH0gZnJvbSAnLi9Xb3Jrc3BhY2UnO1xuaW1wb3J0IHtpbnNlcnRBdCwgc2FmZVN0cmluZ2lmeX0gZnJvbSBcIi4vdXRpbFwiO1xuaW1wb3J0IHtMaXN0Q29tcG9uZW50fSBmcm9tIFwiLi9MaXN0Q29tcG9uZW50XCI7XG5pbXBvcnQgTW9kYWxEaWFsb2cgZnJvbSBcIi4vTW9kYWxEaWFsb2dcIjtcbmNvbnN0IGxpc3RpbmdUb2tlbml6ZXJEZWZpbml0aW9uPXtcbiAgICBuYW1lOidsaXN0aW5nJyxcbiAgICBmbGFnczonbWcnLFxuICAgIGRlZmluaXRpb25zOntcbiAgICAgICAgXCJXaGl0ZXNwYWNlXCI6ICAgICB7c3R5bGU6IHtmZzond2hpdGUnfSxwYXR0ZXJuOi9cXHMrL21naX0sXG4gICAgICAgIFwiRm9sZGVyXCI6ICAgICAgICAge3N0eWxlOiB7Zmc6J3doaXRlJ30scGF0dGVybjovKD88PVxcW1stK11dKVxcUysvbWdpfSxcbiAgICAgICAgXCJPcGVuQnV0dG9uXCI6ICAgICB7c3R5bGU6IHtmZzoneWVsbG93J30scGF0dGVybjovXFxbXFwrXS9tZ2l9LFxuICAgICAgICBcIkNsb3NlQnV0dG9uXCI6ICAgIHtzdHlsZToge2ZnOid5ZWxsb3cnfSxwYXR0ZXJuOi9cXFstXS9tZ2l9LFxuICAgICAgICBcIkFkZERpckJ1dHRvblwiOiAgIHtzdHlsZToge2ZnOidjeWFuJ30scGF0dGVybjovXFxbXFwrRF0vbWdpfSxcbiAgICAgICAgXCJBZGRGaWxlQnV0dG9uXCI6ICB7c3R5bGU6IHtmZzonbWFnZW50YSd9LHBhdHRlcm46L1xcW1xcK0ZdL21naX0sXG4gICAgICAgIFwiUmVuYW1lQnV0dG9uXCI6ICAge3N0eWxlOiB7Zmc6J2JsdWUnfSxwYXR0ZXJuOi9cXFtyXS9tZ2l9LFxuICAgICAgICBcIkRlbGV0ZUJ1dHRvblwiOiAgIHtzdHlsZToge2ZnOidyZWQnfSxwYXR0ZXJuOi9cXFt4XS9tZ2l9LFxuICAgICAgICBcIk5vZGVOYW1lXCI6ICAgICAgIHtzdHlsZToge2ZnOidncmVlbid9LHBhdHRlcm46L1thLXpBLVowLTlfPXt9XFxbXFxdJSooKW0sLjo7IT9Afi1dKy9tZ2l9LFxuICAgICAgICBcIldvcmRcIjogICAgICAgICAgIHtzdHlsZToge2ZnOidncmVlbid9LHBhdHRlcm46L1xccy4rP1xccy9tZ2l9LFxuICAgIH1cbn1cbi8qKlxuICpcbiAqIEBwYXJhbSB7SU5vZGVbXX0gdHJlZVxuICogQHBhcmFtIHsobm9kZTpJTm9kZSktPnVuZGVmaW5lZH0gb25EaXJTZWxlY3RcbiAqIEBwYXJhbSB7KG5vZGU6SU5vZGUpLT51bmRlZmluZWR9IG9uRmlsZVNlbGVjdFxuICogQHJldHVybnMge0pTWC5FbGVtZW50fVxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEZpbGVUcmVlKHtcbiAgICBjaGlsZHJlbixcbiAgICByb290RGlyLFxuICAgIG9uRGlyU2VsZWN0LFxuICAgIG9uRmlsZVNlbGVjdCxcbiAgICBsYWJlbCxcbiAgICBpbm9kZUZpbHRlcj0oaW5vZGUsaW5kZXgsbm9kZXMscGFyZW50KT0+e3JldHVybiB0cnVlfSxcbiAgICBjdXJzb3I9dHJ1ZSxcbiAgICAuLi5ib3hQcm9wc1xufSl7XG4gICAgY29uc3QgYm94UmVmID0gdXNlUmVmKCk7XG4gICAgY29uc3QgW21lc3NhZ2UsIHNldE1lc3NhZ2VdID0gUmVhY3QudXNlU3RhdGUoZmFsc2UpO1xuICAgIGNvbnN0IFtzZWxlY3RlZCwgc2V0U2VsZWN0ZWRdID0gUmVhY3QudXNlU3RhdGUobnVsbCk7XG4gICAgY29uc3QgW2N1cnNvckRhdGEsIHNldEN1cnNvckRhdGFdID0gUmVhY3QudXNlU3RhdGUobnVsbCk7XG4gICAgY29uc3QgW3dvcmtzcGFjZSxzZXRXb3Jrc3BhY2VdID0gdXNlU3RhdGUobmV3IFdvcmtzcGFjZShpbm9kZUZpbHRlcikpO1xuXG5cblxuICAgIC8vIGZvY3VzIHRoZSBtb2RhbCBzbyBpdCBjYW4gY2F0Y2gga2V5cHJlc3Nlc1xuICAgIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgICAgIGNvbnN0IG5vZGUgPSBib3hSZWYuY3VycmVudDtcbiAgICAgICAgaWYgKG5vZGUpIG5vZGUuZm9jdXMoKTtcbiAgICAgICAgd29ya3NwYWNlLmluaXQocm9vdERpcilcbiAgICAgICAgICAgIC50aGVuKHdrID0+IHdvcmtzcGFjZS5vcGVuKHdvcmtzcGFjZS5yb290Tm9kZSkpXG4gICAgICAgICAgICAudGhlbih3ayA9PiB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKT0+e1xuICAgICAgICAgICAgICAgICAgICBzZXRXb3Jrc3BhY2Uod2suY29weSgpKVxuICAgICAgICAgICAgICAgIH0sMTAwKVxuICAgICAgICAgICAgICAgIC8vLyBzZXRNZXNzYWdlKGBsb2FkZWQgdHJlZSBkYXRhICR7SlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIC8vLyAgIHdrXG4gICAgICAgICAgICAgICAgLy8vIH0pfWApXG4gICAgICAgICAgICB9KVxuICAgICAgICAvLyBzZXRXb3Jrc3BhY2Uod29ya3NwYWNlLmNvcHkoKSlcbiAgICB9LCBbcm9vdERpcl0pO1xuICAgIGxldCBiYXNlTGV2ZWw9cm9vdERpci5zcGxpdChcIi9cIikubGVuZ3RoKjJcbiAgICBpZiAoYmFzZUxldmVsPjApIHtcbiAgICAgICBiYXNlTGV2ZWwgPSBiYXNlTGV2ZWwtMVxuICAgIH1cbiAgICBsZXQgbGluZXMgPSAoKSA9PiB7XG4gICAgICAgIHRyeXtcbiAgICAgICAgICAgIGNvbnN0IGxwb3MgPSBib3hSZWYuY3VycmVudC5scG9zXG4gICAgICAgICAgICBjb25zdCB0cmVlRGF0YSA9IHdvcmtzcGFjZS5mbGF0dGVuKCkuZmlsdGVyKGlub2RlRmlsdGVyKVxuXG4gICAgICAgICAgICByZXR1cm4gKHRyZWVEYXRhIHx8IFtdKS5tYXAoKHYsIGksIGEpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBsaW5lQnVmZmVyID0gXCIgXCIucmVwZWF0KGxwb3Mud2lkdGgpXG4gICAgICAgICAgICAgICAgY29uc3QgdCA9IHYudG9UZXh0KCkuc3Vic3RyaW5nKGJhc2VMZXZlbClcbiAgICAgICAgICAgICAgICBsZXQgcnIgPSBpbnNlcnRBdChsaW5lQnVmZmVyLDAsdClcbiAgICAgICAgICAgICAgICBzd2l0Y2ggKHYudHlwZS5zdWJzdHJpbmcoMCwgMSkpIHtcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAnZCc6XG4gICAgICAgICAgICAgICAgICAgICAgICBycj1pbnNlcnRBdChycixscG9zLndpZHRoLTE3LCdbK0RdWytGXVtyXVt4XScpXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcnJcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgIHJyPWluc2VydEF0KHJyLGxwb3Mud2lkdGgtOSwnW3JdW3hdJylcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiByclxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1jYXRjaChlcnIpe1xuICAgICAgICAgICAgcmV0dXJuIFtdXG4gICAgICAgIH1cbiAgICB9XG4gICAgY29uc3Qgb25Ub2tlbkNsaWNrPShldmVudERhdGEpPT57XG4gICAgICAgIGNvbnN0IHRyZWVEYXRhID0gd29ya3NwYWNlLmZsYXR0ZW4oKS5maWx0ZXIoaW5vZGVGaWx0ZXIpXG4gICAgICAgIGNvbnN0IHtsaW5lcywgdmlzaWJsZUxpbmVzLCBsaW5lLCBjdXJzb3I6e3gseX0sY3Vyc29yU2NyZWVuLCBidWZmZXIsIHZpc2libGVCdWZmZXIsIGluZGV4LHRva2Vucyx0b2tlblVuZGVyQ3Vyc29yLHBocmFzZX0gPSBldmVudERhdGFcbiAgICAgICAgY29uc3Qgbm9kZSA9IHRyZWVEYXRhW3ldO1xuICAgICAgICAvLyB0aHJvdyBKU09OLnN0cmluZ2lmeSh7bm9kZSx5fSxudWxsLCAnICcpXG4gICAgICAgIC8vIGlmIChub2RlLnR5cGUuaW5kZXhPZignZCcpPi0xKSB7XG4gICAgICAgIHN3aXRjaChwaHJhc2UuZmlsdGVyKHYgPT4gdiE9PSdXaGl0ZXNwYWNlJykuam9pbihcIixcIikpe1xuICAgICAgICAgICAgY2FzZSBcIldoaXRlc3BhY2UsTm9kZU5hbWVcIjpcbiAgICAgICAgICAgIGNhc2UgXCJOb2RlTmFtZSxSZW5hbWVCdXR0b24sRGVsZXRlQnV0dG9uXCI6XG4gICAgICAgICAgICAgICAgc3dpdGNoKCh0b2tlblVuZGVyQ3Vyc29yfHx7dHlwZTondW5kZWZpbmVkJ30pLnR5cGUpe1xuICAgICAgICAgICAgICAgICAgICBjYXNlIFwiTm9kZU5hbWVcIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldFNlbGVjdGVkKG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgb25GaWxlU2VsZWN0KG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OjAseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIlJlbmFtZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgUmVuYW1lXFxuJHtub2RlLmZ1bGxQYXRofWApXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzZXRDdXJzb3JEYXRhKHtjdXJzb3I6e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5fSxjdXJzb3JTY3JlZW46e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5OmN1cnNvclNjcmVlbi55fSxjb250ZW50OnRva2VuVW5kZXJDdXJzb3IudGV4dCxzdHlsZTp0b2tlblVuZGVyQ3Vyc29yLnN0eWxlfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBjYXNlIFwiRGVsZXRlQnV0dG9uXCI6XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRNZXNzYWdlKGBEZWxldGVcXG4ke25vZGUuZnVsbFBhdGh9YClcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSBcIldoaXRlc3BhY2UsT3BlbkJ1dHRvbixXaGl0ZXNwYWNlLE5vZGVOYW1lXCI6XG4gICAgICAgICAgICBjYXNlIFwiV2hpdGVzcGFjZSxDbG9zZUJ1dHRvbixXaGl0ZXNwYWNlLE5vZGVOYW1lXCI6XG4gICAgICAgICAgICBjYXNlIFwiT3BlbkJ1dHRvbixOb2RlTmFtZSxBZGREaXJCdXR0b24sQWRkRmlsZUJ1dHRvbixSZW5hbWVCdXR0b24sRGVsZXRlQnV0dG9uXCI6XG4gICAgICAgICAgICBjYXNlIFwiQ2xvc2VCdXR0b24sTm9kZU5hbWUsQWRkRGlyQnV0dG9uLEFkZEZpbGVCdXR0b24sUmVuYW1lQnV0dG9uLERlbGV0ZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgIHN3aXRjaCgodG9rZW5VbmRlckN1cnNvcnx8e3R5cGU6J3VuZGVmaW5lZCd9KS50eXBlKXtcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIk9wZW5CdXR0b25cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIG5vZGUub3Blbih3b3Jrc3BhY2Uucm9vdERpcix3b3Jrc3BhY2UuaWcpLnRoZW4obiA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgd2s9d29ya3NwYWNlLmNvcHkoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRkID0gd2suZmxhdHRlbigpLmZpbHRlcihpbm9kZUZpbHRlcilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXRXb3Jrc3BhY2Uod2spXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4LHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBjYXNlIFwiQ2xvc2VCdXR0b25cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIG5vZGUuY2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgd2s9d29ya3NwYWNlLmNvcHkoKVxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdGQgPSB3ay5mbGF0dGVuKCkuZmlsdGVyKGlub2RlRmlsdGVyKVxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0V29ya3NwYWNlKHdrKVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIk5vZGVOYW1lXCI6XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRTZWxlY3RlZChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG9uRGlyU2VsZWN0KG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIkFkZERpckJ1dHRvblwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgQWRkRGlyXFxuJHtub2RlLmZ1bGxQYXRofWApXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzZXRDdXJzb3JEYXRhKHtjdXJzb3I6e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5fSxjdXJzb3JTY3JlZW46e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5OmN1cnNvclNjcmVlbi55fSxjb250ZW50OnRva2VuVW5kZXJDdXJzb3IudGV4dCxzdHlsZTp0b2tlblVuZGVyQ3Vyc29yLnN0eWxlfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBjYXNlIFwiQWRkRmlsZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgQWRkRmlsZVxcbiR7bm9kZS5mdWxsUGF0aH1gKVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIlJlbmFtZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgUmVuYW1lXFxuJHtub2RlLmZ1bGxQYXRofWApXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzZXRDdXJzb3JEYXRhKHtjdXJzb3I6e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5fSxjdXJzb3JTY3JlZW46e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5OmN1cnNvclNjcmVlbi55fSxjb250ZW50OnRva2VuVW5kZXJDdXJzb3IudGV4dCxzdHlsZTp0b2tlblVuZGVyQ3Vyc29yLnN0eWxlfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBjYXNlIFwiRGVsZXRlQnV0dG9uXCI6XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRNZXNzYWdlKGBEZWxldGVcXG4ke25vZGUuZnVsbFBhdGh9YClcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNldEN1cnNvckRhdGEoe2N1cnNvcjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHl9LGN1cnNvclNjcmVlbjp7eDp0b2tlblVuZGVyQ3Vyc29yLnN0YXJ0LHk6Y3Vyc29yU2NyZWVuLnl9LGNvbnRlbnQ6dG9rZW5VbmRlckN1cnNvci50ZXh0LHN0eWxlOnRva2VuVW5kZXJDdXJzb3Iuc3R5bGV9KVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgcGhyYXNlIFN0cnVjdHVyZSAnJHtwaHJhc2V9J2ApXG4gICAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgY3Vyc29yRXh0cmE9KCk9PntcbiAgICAgICAgaWYoIWN1cnNvckRhdGEpIHJldHVybiA8Ym94IHRvcD17MH0gbGVmdD17MH0gd2lkdGg9ezF9IGhlaWdodD17MX0gY29udGVudD17JyAnfS8+O1xuICAgICAgICBjb25zdCB7Y3Vyc29yLGN1cnNvclNjcmVlbixjb250ZW50fSA9IGN1cnNvckRhdGFcbiAgICAgICAgcmV0dXJuIDxib3gga2V5PXtgeGN1cnNvci0ke01hdGgucmFuZG9tKCl9LSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgdG9wPXtjdXJzb3JTY3JlZW4ueX0gbGVmdD17Y3Vyc29yU2NyZWVuLnh9XG4gICAgICAgICAgICB3aWR0aD17Y29udGVudC5sZW5ndGh9IGhlaWdodD17MX1cbiAgICAgICAgICAgIHN0eWxlPXt7aW52ZXJzZTogdHJ1ZX19XG4gICAgICAgICAgICBjb250ZW50PXtjb250ZW50fVxuICAgICAgICAvPlxuICAgIH1cbiAgICByZXR1cm4gKFxuICAgICAgICA8PlxuICAgICAgICA8Ym94IHsuLi5ib3hQcm9wc30gcmVmPXtib3hSZWZ9PlxuICAgICAgICAgICAgPExpc3RDb21wb25lbnRcbiAgICAgICAgICAgICAgICBzY3JvbGxiYXI9e3sgY2g6ICc9JywgdHJhY2s6IHsgZmc6J2JsdWUnLCBiZzogJ2dyZXknIH0gfX1cbiAgICAgICAgICAgICAgICB0b3A9ezB9XG4gICAgICAgICAgICAgICAgYm90dG9tPXsyfVxuICAgICAgICAgICAgICAgIGxpbmVzPXtsaW5lcygpfVxuICAgICAgICAgICAgICAgIGtleXMgbW91c2VcbiAgICAgICAgICAgICAgICBzdHlsZT17eyBzZWxlY3RlZDogeyBiZzogJ2JsdWUnIH0gfX1cbiAgICAgICAgICAgICAgICBvblRva2VuQ2xpY2s9e29uVG9rZW5DbGlja31cbiAgICAgICAgICAgICAgICB0b2tlbml6ZXJEZWY9e2xpc3RpbmdUb2tlbml6ZXJEZWZpbml0aW9ufVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIHsvKjxib3ggdG9wPXswfSBjb250ZW50PXtzZWxlY3RlZCA/IHNlbGVjdGVkLmZ1bGxQYXRoIDogJycgKyAnICcgKyBsYWJlbH0gaGVpZ2h0PXsxfS8+Ki99XG4gICAgICAgICAgICB7Y2hpbGRyZW58fFtdfVxuICAgICAgICAgICAge2N1cnNvcj9jdXJzb3JFeHRyYSgpOltdfVxuICAgICAgICA8L2JveD5cbiAgICAgICAge21lc3NhZ2UgJiYgKFxuICAgICAgICAgICAgPE1vZGFsRGlhbG9nXG4gICAgICAgICAgICAgICAgbGFiZWw9eydNZXNzYWdlJ31cbiAgICAgICAgICAgICAgICB0aXRsZT1cIk1lc3NhZ2VcIlxuICAgICAgICAgICAgICAgIG9uQ2xvc2U9eygpID0+IHNldE1lc3NhZ2UoZmFsc2UpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIDx0ZXh0PnttZXNzYWdlfTwvdGV4dD5cbiAgICAgICAgICAgIDwvTW9kYWxEaWFsb2c+XG4gICAgICAgICl9XG4gICAgPC8+XG4gICAgKTtcbn1cblxuIiwiLy8gY29tcG9uZW50cy9Nb2RhbERpYWxvZy5qc1xuaW1wb3J0IFJlYWN0LCB7IHVzZUVmZmVjdCwgdXNlUmVmLHVzZVN0YXRlIH0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHsgQm94RWxlbWVudCBhcyBib3gsIFRleHRFbGVtZW50IGFzIHRleHQsIEJ1dHRvbkVsZW1lbnQgYXMgYnV0dG9uIH0gZnJvbSAncmVhY3QtYmxlc3NlZCc7XG5pbXBvcnQgRmlsZVRyZWUgZnJvbSBcIi4vRmlsZVRyZWVcIjtcbmltcG9ydCB7V29ya3NwYWNlfSBmcm9tIFwiLi9Xb3Jrc3BhY2VcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gRm9sZGVyUGlja2VyRGlhbG9nKHtcbiAgICB0aXRsZSA9ICdEaWFsb2cnLFxuICAgIHdpZHRoID0gJzUwJScsXG4gICAgaGVpZ2h0ID0gJzUwJScsXG4gICAgb25Gb2xkZXJTZWxlY3QsXG59KSB7XG4gICAgY29uc3QgW3NlbGVjdGVkLCBzZXRTZWxlY3RlZF0gPSBSZWFjdC51c2VTdGF0ZShudWxsKTtcblxuICAgIHJldHVybiAoXG4gICAgICAgIDxGaWxlVHJlZVxuICAgICAgICAgICAgdG9wPVwiY2VudGVyXCJcbiAgICAgICAgICAgIGxlZnQ9XCJjZW50ZXJcIlxuICAgICAgICAgICAgYm9yZGVyPXt7IHR5cGU6ICdsaW5lJyB9fVxuICAgICAgICAgICAgc3R5bGU9e3sgYmc6ICdibGFjaycsIGZnOiAnd2hpdGUnIH19XG4gICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAvLyBjbG9zZSBvbiBFU0NcbiAgICAgICAgICAgIG9uS2V5PXsoY2gsIGtleSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChrZXkubmFtZSA9PT0gJ2VzY2FwZScpIG9uRm9sZGVyU2VsZWN0KG51bGwpO1xuICAgICAgICAgICAgfX1cbiAgICAgICAgICAgIGxhYmVsPXtzZWxlY3RlZD9zZWxlY3RlZC5mdWxsTmFtZTonUGljayBXb3Jrc3BhY2UnfVxuICAgICAgICAgICAgcm9vdERpcj17Jy8nfVxuICAgICAgICAgICAgaW5vZGVGaWx0ZXI9eyhpbm9kZSxpbmRleCxub2RlcyxwYXJlbnQpPT57cmV0dXJuIGlub2RlLnR5cGUuaW5kZXhPZignZCcpPi0xfX1cbiAgICAgICAgICAgIG9uRGlyU2VsZWN0PXsoc2VsZWN0RGlyKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gdGhyb3cgSlNPTi5zdHJpbmdpZnkoc2VsZWN0RGlyLG51bGwsJyAnKTtcbiAgICAgICAgICAgICAgICBzZXRTZWxlY3RlZChzZWxlY3REaXIpO1xuICAgICAgICAgICAgfX1cbiAgICAgICAgICAgIG9uRmlsZVNlbGVjdD17KCk9Pnt9fVxuICAgICAgICA+XG4gICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICBmb2N1c2VkXG4gICAgICAgICAgICAgICAgbGVmdD17MH1cbiAgICAgICAgICAgICAgICBib3R0b209ezB9XG4gICAgICAgICAgICAgICAgaGVpZ2h0PXszfVxuICAgICAgICAgICAgICAgIHdpZHRoPXsnNDUlJ31cbiAgICAgICAgICAgICAgICB2YWxpZ249eydtaWRkbGUnfVxuICAgICAgICAgICAgICAgIGFsaWduPXsnY2VudGVyJ31cbiAgICAgICAgICAgICAgICBzdHlsZT17e2JnOicjZmZhYTAwJyxmZzonIzMzMzMzMycsaG92ZXI6e2JnOicjZmZkZDg4JyxmZzonIzMzMzMzMyd9fX1cbiAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8qIGRvIHNvbWV0aGluZyAqL1xuICAgICAgICAgICAgICAgICAgICBvbkZvbGRlclNlbGVjdChzZWxlY3RlZClcbiAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgIGNvbnRlbnQ9eydzZWxlY3QnfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgICAgICAgICBpbnB1dFxuICAgICAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgICAgICAgICByaWdodD17MH1cbiAgICAgICAgICAgICAgICAgICAgYm90dG9tPXswfVxuICAgICAgICAgICAgICAgICAgICBoZWlnaHQ9ezN9XG4gICAgICAgICAgICAgICAgICAgIHZhbGlnbj17J21pZGRsZSd9XG4gICAgICAgICAgICAgICAgICAgIGFsaWduPXsnY2VudGVyJ31cbiAgICAgICAgICAgICAgICAgICAgd2lkdGg9eyc0NSUnfVxuICAgICAgICAgICAgICAgICAgICBzdHlsZT17e2JnOicjZmZhYTAwJyxmZzonIzMzMzMzMycsaG92ZXI6e2JnOicjZmZkZDg4JyxmZzonIzMzMzMzMyd9fX1cbiAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICBvbkZvbGRlclNlbGVjdChudWxsKVxuICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgY29udGVudD17J2NhbmNlbCd9XG4gICAgICAgICAgICAvPlxuICAgICAgICA8L0ZpbGVUcmVlPlxuICAgIClcbn1cbiIsIi8vIGNvbXBvbmVudHMvVlRhYnMuanNcbmltcG9ydCBSZWFjdCwgeyB1c2VTdGF0ZSB9IGZyb20gJ3JlYWN0JztcbmltcG9ydCB7IEJveEVsZW1lbnQgYXMgYm94LCBUZXh0RWxlbWVudCBhcyB0ZXh0IH0gZnJvbSAncmVhY3QtYmxlc3NlZCc7XG5pbXBvcnQgeyBHcmlkLEdyaWRJdGVtIH0gZnJvbSAncmVhY3QtYmxlc3NlZC1jb250cmliLTE3J1xuXG4vKipcbiAqIDxWVGFicyB0YWJXaWR0aD1cIjIwJVwiPlxuICogICA8VGFiIG5hbWU9XCJQcm9qZWN0XCI+4oCmPC9UYWI+XG4gKiAgIDxUYWIgbmFtZT1cIkdpdFwiPuKApjwvVGFiPlxuICogPC9WVGFicz5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIFZUYWJzKHsgY2hpbGRyZW4sIC4uLmJveFByb3BzfSkge1xuICAgIGNvbnN0IHRhYnMgPSBSZWFjdC5DaGlsZHJlbi50b0FycmF5KGNoaWxkcmVuKVxuICAgICAgICAuZmlsdGVyKGNoaWxkID0+IFJlYWN0LmlzVmFsaWRFbGVtZW50KGNoaWxkKSAmJiBjaGlsZC5wcm9wcy5uYW1lKTtcblxuICAgIGNvbnN0IFthY3RpdmVJbmRleCwgc2V0QWN0aXZlSW5kZXhdID0gdXNlU3RhdGUoMCk7XG4gICAgY29uc3QgdGFiU2VsZWN0b3JTdHlsZT17Zmc6JyNmZmFhMDAnLGJnOicjMzMzMzMzJyxob3Zlcjp7Ymc6JyNmZmRkODgnLGZnOicjMzMzMzMzJ319XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IHsuLi5ib3hQcm9wc30+XG4gICAgICAgIDxHcmlkIHJvd3M9ezF9IGNvbHM9ezZ9IGhpZGVCb3JkZXI+XG4gICAgICAgICAgICB7LyogVGFiIGxpc3QgKi99XG4gICAgICAgICAgICA8Ym94IHJvdz17MH0gY29sPXswfSByb3dTcGFuPXsxfSBjb2xTcGFuPXsxfT5cbiAgICAgICAgICAgICAgICB7dGFicy5tYXAoKHRhYiwgaSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGtleT17dGFiLnByb3BzLm5hbWV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdG9wPXtpICogM31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZWlnaHQ9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFncz17ZmFsc2V9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldEFjdGl2ZUluZGV4KGkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnl7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YWJzW2ldLnByb3BzLm9uVGFiQ2xpY2soKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9Y2F0Y2goZXJyKXt9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdHlsZT17ey4uLnRhYlNlbGVjdG9yU3R5bGUsIGludmVyc2U6IChhY3RpdmVJbmRleCA9PSBpKX19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudD17J1xcbiAnK3RhYi5wcm9wcy5uYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIH0pfVxuICAgICAgICAgICAgPC9ib3g+XG5cbiAgICAgICAgICAgIHsvKiBBY3RpdmUgdGFiIHBhbmVsICovfVxuICAgICAgICAgICAgPGJveCByb3c9ezB9IGNvbD17MX0gcm93U3Bhbj17MX0gY29sU3Bhbj17NX0+XG4gICAgICAgICAgICAgICAge3RhYnNbYWN0aXZlSW5kZXhdLnByb3BzLmNoaWxkcmVufVxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvR3JpZD5cbiAgICAgICAgPC9ib3g+XG4gICAgKTtcbn1cblxuLyoqXG4gKiBKdXN0IGEgc2VtYW50aWMgd3JhcHBlciB0byBjYXJyeSB0aGUgYG5hbWVgIHByb3BcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIFRhYih7IGNoaWxkcmVuIH0pIHtcbiAgICByZXR1cm4gPD57Y2hpbGRyZW59PC8+O1xufVxuIiwiaW1wb3J0IGZzIGZyb20gJ2ZzJztcbmltcG9ydCB7IGdldE5hbWVkVG9rZW5pemVyLCBUb2tlbml6ZXJUb2tlbiB9IGZyb20gJy4vdG9rZW5pemVyLmpzJztcbmltcG9ydCB7IHNhZmVTdHJpbmdpZnkgfSBmcm9tICcuL3V0aWwnO1xuaW1wb3J0IHsgY29weSBhcyBjbGlwYm9hcmRDb3B5LCBwYXN0ZSBhcyBjbGlwYm9hcmRQYXN0ZSB9IGZyb20gJ2NvcHktcGFzdGUnO1xuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIEdlb21ldHJ5IGhlbHBlcnNcbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuZXhwb3J0IGNsYXNzIFJlY3RhbmdsZSB7XG4gIHggPSAtMTsgeSA9IC0xOyB3ID0gLTE7IGggPSAtMTtcbiAgLyoqIEBwYXJhbSB7bnVtYmVyfSB4IEBwYXJhbSB7bnVtYmVyfSB5IEBwYXJhbSB7bnVtYmVyfSB3IEBwYXJhbSB7bnVtYmVyfSBoICovXG4gIGNvbnN0cnVjdG9yKHgsIHksIHcsIGgpIHsgdGhpcy54ID0geDsgdGhpcy55ID0geTsgdGhpcy53ID0gdzsgdGhpcy5oID0gaDsgfVxuICAvKiogQHBhcmFtIHtDb2RlQnVmZmVyRWRpdG9yfSBlZGl0b3IgKi9cbiAgc3RhdGljIGZyb21FZGl0b3IoZWRpdG9yKSB7XG4gICAgcmV0dXJuIG5ldyBSZWN0YW5nbGUoZWRpdG9yLnZpZXdwb3J0WCwgZWRpdG9yLnZpZXdwb3J0WSwgZWRpdG9yLnZpZXdwb3J0V2lkdGgsIGVkaXRvci52aWV3cG9ydEhlaWdodCk7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIEN1cnNvclBvaW50IHtcbiAgeCA9IC0xOyB5ID0gLTE7IGNoYXIgPSAnLSc7IHN0eWxlID0ge307XG4gIGNvbnN0cnVjdG9yKHgsIHksIGNoYXIsIHN0eWxlKSB7XG4gICAgdGhpcy54ID0gdHlwZW9mIHggPT09ICdudW1iZXInID8geCA6IC0xO1xuICAgIHRoaXMueSA9IHR5cGVvZiB5ID09PSAnbnVtYmVyJyA/IHkgOiAtMTtcbiAgICB0aGlzLmNoYXIgPSB0eXBlb2YgY2hhciA9PT0gJ3N0cmluZycgPyBjaGFyIDogJy0nO1xuICAgIHRoaXMuc3R5bGUgPSBzdHlsZSB8fCB7fTtcbiAgfVxuICAvKiogQHBhcmFtIHtSZWN0YW5nbGV9IHZpc2libGVBcmVhICovXG4gIGlzVmlzaWJsZSh2aXNpYmxlQXJlYSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIHRoaXMueCA+PSB2aXNpYmxlQXJlYS54ICYmIHRoaXMueCA8PSAodmlzaWJsZUFyZWEueCArIHZpc2libGVBcmVhLncpICYmXG4gICAgICAgIHRoaXMueSA+PSB2aXNpYmxlQXJlYS55ICYmIHRoaXMueSA8PSAodmlzaWJsZUFyZWEueSArIHZpc2libGVBcmVhLmgpXG4gICAgKTtcbiAgfVxuICBjb3B5KCkge1xuICAgIGNvbnN0IGNwID0gbmV3IEN1cnNvclBvaW50KCk7XG4gICAgY3AueCA9IHRoaXMueDsgY3AueSA9IHRoaXMueTsgY3AuY2hhciA9IHRoaXMuY2hhcjsgY3Auc3R5bGUgPSB7IC4uLnRoaXMuc3R5bGUgfTtcbiAgICByZXR1cm4gY3A7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIENvZGVCdWZmZXJFZGl0b3JTZWxlY3Rpb24ge1xuICAvKiogQHR5cGUge0N1cnNvclBvaW50fSAqLyBzdGFydCA9IG5ldyBDdXJzb3JQb2ludCgpO1xuICAvKiogQHR5cGUge0N1cnNvclBvaW50fSAqLyBlbmQgPSBuZXcgQ3Vyc29yUG9pbnQoKTtcbiAgLyoqIEBwYXJhbSB7Q3Vyc29yUG9pbnR9IHN0YXJ0ICovXG4gIGNvbnN0cnVjdG9yKHN0YXJ0KSB7IHRoaXMuc3RhcnQgPSBzdGFydC5jb3B5KCk7IH1cbiAgLyoqIEBwYXJhbSB7UmVjdGFuZ2xlfSB2aXNpYmxlQXJlYSAqL1xuICBpc1Zpc2libGUodmlzaWJsZUFyZWEpIHsgcmV0dXJuIHRoaXMuc3RhcnQuaXNWaXNpYmxlKHZpc2libGVBcmVhKSB8fCB0aGlzLmVuZC5pc1Zpc2libGUodmlzaWJsZUFyZWEpOyB9XG4gIC8qKiBAcGFyYW0ge0N1cnNvclBvaW50fSB2YWwgKi9cbiAgc2V0RW5kKHZhbCkgeyB0aGlzLmVuZCA9IHZhbDsgcmV0dXJuIHRoaXM7IH1cbiAgY29weSgpIHsgY29uc3QgY3AgPSBuZXcgQ29kZUJ1ZmZlckVkaXRvclNlbGVjdGlvbih0aGlzLnN0YXJ0LmNvcHkoKSk7IGNwLnNldEVuZCh0aGlzLmVuZCk7IHJldHVybiBjcDsgfVxufVxuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIENvZGVCdWZmZXJFZGl0b3Jcbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuZXhwb3J0IGNsYXNzIENvZGVCdWZmZXJFZGl0b3Ige1xuICAvKipcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoXG4gICAqIEBwYXJhbSB7e3Jvd3M6bnVtYmVyLCBjb2xzOm51bWJlcn19IHdpbmRvd1NpemVcbiAgICovXG4gIGNvbnN0cnVjdG9yKGZpbGVQYXRoLCB3aW5kb3dTaXplKSB7XG4gICAgdGhpcy5maWxlUGF0aCA9IGZpbGVQYXRoO1xuICAgIHRoaXMudmlld3BvcnRZID0gMDsgdGhpcy52aWV3cG9ydFggPSAwO1xuICAgIHRoaXMudmlld3BvcnRIZWlnaHQgPSB3aW5kb3dTaXplLnJvd3M7IHRoaXMudmlld3BvcnRXaWR0aCA9IHdpbmRvd1NpemUuY29scztcbiAgICB0aGlzLmxpbmVzID0gW107XG4gICAgLyoqIEB0eXBlIHt7W2xpbmU6bnVtYmVyXTpUb2tlbml6ZXJUb2tlbltdfXxUb2tlbml6ZXJUb2tlbltdW119ICovXG4gICAgdGhpcy50b2tlbnMgPSBbXTtcbiAgICB0aGlzLnRva2VuaXplciA9IGZ1bmN0aW9uIChsaW5lLCBsaW5lTnVtYmVyKSB7IHJldHVybiBsaW5lLnNwbGl0KCcgJykuZmxhdE1hcChuID0+IFtuLCAnICddKTsgfTtcbiAgICB0aGlzLl9zYXZlVGltZW91dCA9IDA7XG4gICAgdGhpcy5fc2F2ZWQgPSAnJztcblxuICAgIC8qKiBAdHlwZSB7Q3Vyc29yUG9pbnRbXX0gKi8gdGhpcy5jdXJzb3JzID0gW107XG4gICAgLyoqIEB0eXBlIHtDb2RlQnVmZmVyRWRpdG9yU2VsZWN0aW9uIHwgbnVsbH0gKi8gdGhpcy5zZWxlY3RTdGFydCA9IG51bGw7XG4gICAgLyoqIEB0eXBlIHtDb2RlQnVmZmVyRWRpdG9yU2VsZWN0aW9uW119ICovIHRoaXMuc2VsZWN0aW9ucyA9IFtdO1xuXG4gICAgdGhpcy5zZXRGaWxlUGF0aChmaWxlUGF0aCk7XG4gIH1cblxuICAvLyDilIDilIAgZmlsZSAvIHRva2VucyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgc2V0RmlsZVBhdGgoZmlsZVBhdGgpIHtcbiAgICB0aGlzLmZpbGVQYXRoID0gZmlsZVBhdGg7XG4gICAgY29uc3QgZXh0ID0gKGZpbGVQYXRoLnNwbGl0KCcuJykucG9wKCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgdGhpcy50b2tlbml6ZXIgPSBnZXROYW1lZFRva2VuaXplcihleHQpO1xuICAgIHRoaXMubGluZXMgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsIHsgZW5jb2Rpbmc6ICd1dGYtOCcgfSkuc3BsaXQoJ1xcbicpO1xuICAgIHRoaXMudXBkYXRlVG9rZW5zKCk7XG4gIH1cblxuICBzYXZlKCkge1xuICAgIGNsZWFyVGltZW91dCh0aGlzLl9zYXZlVGltZW91dCk7XG4gICAgdGhpcy5fc2F2ZVRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIGZzLndyaXRlRmlsZVN5bmModGhpcy5maWxlUGF0aCwgdGhpcy5saW5lcy5qb2luKCdcXG4nKSk7XG4gICAgICB0aGlzLl9zYXZlZCA9IGBzYXZlZCAke25ldyBEYXRlKCkudG9JU09TdHJpbmcoKX1gO1xuICAgIH0sIDEwMDApO1xuICB9XG5cbiAgLyoqIEBwYXJhbSB7bnVtYmVyfSBsaW5lTnVtYmVyICovXG4gIHVwZGF0ZVRva2Vuc0xpbmUobGluZU51bWJlcikge1xuICAgIGlmIChsaW5lTnVtYmVyIDwgMCB8fCBsaW5lTnVtYmVyID49IHRoaXMubGluZXMubGVuZ3RoKSByZXR1cm47XG4gICAgdGhpcy50b2tlbnNbbGluZU51bWJlcl0gPSB0aGlzLnRva2VuaXplcih0aGlzLmxpbmVzW2xpbmVOdW1iZXJdLCBsaW5lTnVtYmVyKSB8fCBbXTtcbiAgfVxuXG4gIHVwZGF0ZVRva2VucygpIHtcbiAgICB0aGlzLnRva2VucyA9IHRoaXMubGluZXMubWFwKChsaW5lLCBpKSA9PiB0aGlzLnRva2VuaXplcihsaW5lLCBpKSB8fCBbXSk7XG4gIH1cblxuICAvLyDilIDilIAgdmlld3BvcnQg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gIHNjcm9sbFZpZXdwb3J0KG4pIHtcbiAgICBjb25zdCBtYXhZID0gTWF0aC5tYXgoMCwgdGhpcy5saW5lcy5sZW5ndGggLSB0aGlzLnZpZXdwb3J0SGVpZ2h0KTtcbiAgICB0aGlzLnZpZXdwb3J0WSA9IGNsYW1wKHRoaXMudmlld3BvcnRZICsgbiwgMCwgbWF4WSk7XG4gIH1cblxuICBfZW5zdXJlQ3Vyc29ySW5WaWV3KGN1cnNvcikge1xuICAgIGlmIChjdXJzb3IueSA8IHRoaXMudmlld3BvcnRZKSB0aGlzLnZpZXdwb3J0WSA9IGN1cnNvci55O1xuICAgIGVsc2UgaWYgKGN1cnNvci55ID49ICh0aGlzLnZpZXdwb3J0WSArIHRoaXMudmlld3BvcnRIZWlnaHQpKSB0aGlzLnZpZXdwb3J0WSA9IGN1cnNvci55IC0gdGhpcy52aWV3cG9ydEhlaWdodCArIDE7XG5cbiAgICBpZiAoY3Vyc29yLnggPCB0aGlzLnZpZXdwb3J0WCkgdGhpcy52aWV3cG9ydFggPSBjdXJzb3IueDtcbiAgICBlbHNlIGlmIChjdXJzb3IueCA+PSB0aGlzLnZpZXdwb3J0WCArIHRoaXMudmlld3BvcnRXaWR0aCkgdGhpcy52aWV3cG9ydFggPSBjdXJzb3IueCAtIHRoaXMudmlld3BvcnRXaWR0aCArIDE7XG4gIH1cblxuICBfY29tcHV0ZVBhZExlbmd0aCgpIHtcbiAgICAvLyBjb2x1bW4gd2l0aCBsaW5lIG51bWJlcnMsIHNpbWlsYXIgdG8gb3JpZ2luYWwgaW1wbGVtZW50YXRpb25cbiAgICByZXR1cm4gTWF0aC5jZWlsKE1hdGgubG9nMTAoTWF0aC5tYXgoMSwgdGhpcy52aWV3cG9ydEhlaWdodCArIHRoaXMudmlld3BvcnRZKSkpICsgMTtcbiAgfVxuXG4gIF9zY3JlZW5Ub0N1cnNvcihzY3JlZW5FdmVudCwgdmlld3BvcnRQb3NpdGlvbikge1xuICAgIGNvbnN0IHsgeGksIHlpIH0gPSB2aWV3cG9ydFBvc2l0aW9uO1xuICAgIGNvbnN0IHBhZCA9IHRoaXMuX2NvbXB1dGVQYWRMZW5ndGgoKTtcbiAgICBjb25zdCBjeCA9IChzY3JlZW5FdmVudC54IC0geGkgLSBwYWQgLSAzKSArIHRoaXMudmlld3BvcnRYOyAvLyAtMyBtYXRjaGVzIG9yaWdpbmFsIG9mZnNldHNcbiAgICBjb25zdCBjeSA9IChzY3JlZW5FdmVudC55IC0geWkgLSAxKSArIHRoaXMudmlld3BvcnRZO1xuICAgIHJldHVybiB0aGlzLmdldEN1cnNvcih7IHg6IGN4LCB5OiBjeSB9KTtcbiAgfVxuXG4gIC8vIOKUgOKUgCB0b2tlbi1hd2FyZSBjdXJzb3Ig4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gIC8qKiBAcmV0dXJucyB7Q3Vyc29yUG9pbnR9ICovXG4gIGdldEN1cnNvcih7IHgsIHkgfSkge1xuICAgIGNvbnN0IG1heFkgPSBNYXRoLm1heCgwLCB0aGlzLmxpbmVzLmxlbmd0aCAtIDEpO1xuICAgIHkgPSBjbGFtcChwYXJzZUludCh5ID8/IDAsIDEwKSwgMCwgbWF4WSk7XG4gICAgY29uc3QgbGluZSA9IHRoaXMubGluZXNbeV0gPz8gJyc7XG4gICAgeCA9IGNsYW1wKHBhcnNlSW50KHggPz8gMCwgMTApLCAwLCBsaW5lLmxlbmd0aCk7XG5cbiAgICBjb25zdCBjcnMgPSBuZXcgQ3Vyc29yUG9pbnQoeCwgeSwgbGluZVt4XSA/PyAnICcpO1xuICAgIGNvbnN0IGxpbmVUb2tlbnMgPSAodGhpcy50b2tlbnNbeV0gfHwgW10pO1xuXG4gICAgLy8gdHJ5IHRvIGxvY2F0ZSB0b2tlbiBjb3ZlcmluZyB4XG4gICAgY29uc3QgdGsgPSBsaW5lVG9rZW5zLmZpbmQodCA9PlxuICAgICAgICB0ICYmIHR5cGVvZiB0LnN0YXJ0ICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2YgdC5lbmQgIT09ICd1bmRlZmluZWQnICYmIHggPj0gK3Quc3RhcnQgJiYgeCA8PSArdC5lbmRcbiAgICApO1xuXG4gICAgY3JzLnN0eWxlID0gdGsgJiYgdGsuc3R5bGUgPyB0ay5zdHlsZSA6IHsgZmc6ICcjZmYwMDAwJywgYmc6ICcjZmZmZjQ0JyB9O1xuICAgIHJldHVybiBjcnM7XG4gIH1cblxuICAvKiogQHJldHVybnMge3tbbGluZUlkOnN0cmluZ106VG9rZW5pemVyVG9rZW5bXX19ICovXG4gIHJlbmRlclZpZXdwb3J0KCkge1xuICAgIGNvbnN0IG91dCA9IHt9O1xuICAgIGNvbnN0IHkwID0gdGhpcy52aWV3cG9ydFksIHkxID0gdGhpcy52aWV3cG9ydFkgKyB0aGlzLnZpZXdwb3J0SGVpZ2h0O1xuICAgIGZvciAobGV0IGkgPSB5MDsgaSA8PSBNYXRoLm1pbih5MSwgdGhpcy5saW5lcy5sZW5ndGggLSAxKTsgaSsrKSBvdXRbaV0gPSB0aGlzLnRva2Vuc1tpXTtcbiAgICByZXR1cm4gb3V0O1xuICB9XG5cbiAgLy8g4pSA4pSAIG1vdXNlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICBvbk1vdXNlKHNjcmVlbkV2ZW50LCB2aWV3cG9ydFBvc2l0aW9uKSB7XG4gICAgbGV0IGhhc0NoYW5nZWQgPSBmYWxzZTtcbiAgICBsZXQgbXVzdFJlbmRlciA9IGZhbHNlO1xuICAgIGNvbnN0IGNsaWNrcyA9IEFycmF5LmZyb20oc2NyZWVuRXZlbnQuYnVmIHx8IFtdKS5maWx0ZXIodiA9PiB2ID09PSA3NykubGVuZ3RoOyAvLyB3aGVlbCBncmFudWxhcml0eVxuXG4gICAgc3dpdGNoIChzY3JlZW5FdmVudC5hY3Rpb24pIHtcbiAgICAgIGNhc2UgJ21vdXNlZG93bic6IHtcbiAgICAgICAgY29uc3QgY3JzID0gdGhpcy5fc2NyZWVuVG9DdXJzb3Ioc2NyZWVuRXZlbnQsIHZpZXdwb3J0UG9zaXRpb24pO1xuICAgICAgICB0aGlzLnNlbGVjdFN0YXJ0ID0gbmV3IENvZGVCdWZmZXJFZGl0b3JTZWxlY3Rpb24oY3JzKTtcbiAgICAgICAgdGhpcy5zZWxlY3RTdGFydC5zZXRFbmQoY3JzKTtcbiAgICAgICAgaWYgKHNjcmVlbkV2ZW50Lm1ldGEpIHRoaXMuY3Vyc29ycy5wdXNoKGNycyk7IGVsc2UgdGhpcy5jdXJzb3JzID0gW2Nyc107XG4gICAgICAgIGhhc0NoYW5nZWQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ21vdXNlbW92ZSc6IHtcbiAgICAgICAgaWYgKHRoaXMuc2VsZWN0U3RhcnQpIHRoaXMuc2VsZWN0U3RhcnQuc2V0RW5kKHRoaXMuX3NjcmVlblRvQ3Vyc29yKHNjcmVlbkV2ZW50LCB2aWV3cG9ydFBvc2l0aW9uKSk7XG4gICAgICAgIG11c3RSZW5kZXIgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ21vdXNldXAnOiB7XG4gICAgICAgIGlmICh0aGlzLnNlbGVjdFN0YXJ0KSB7XG4gICAgICAgICAgaWYgKHNjcmVlbkV2ZW50Lm1ldGEpIHRoaXMuc2VsZWN0aW9ucy5wdXNoKHRoaXMuc2VsZWN0U3RhcnQuY29weSgpKTtcbiAgICAgICAgICBlbHNlIHRoaXMuc2VsZWN0aW9ucyA9IFt0aGlzLnNlbGVjdFN0YXJ0LmNvcHkoKV07XG4gICAgICAgIH1cbiAgICAgICAgaGFzQ2hhbmdlZCA9IHRydWU7XG4gICAgICAgIHRoaXMuc2VsZWN0U3RhcnQgPSBudWxsO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ3doZWVsdXAnOiB0aGlzLnNjcm9sbFZpZXdwb3J0KC1jbGlja3MpOyBtdXN0UmVuZGVyID0gdHJ1ZTsgYnJlYWs7XG4gICAgICBjYXNlICd3aGVlbGRvd24nOiB0aGlzLnNjcm9sbFZpZXdwb3J0KCtjbGlja3MpOyBtdXN0UmVuZGVyID0gdHJ1ZTsgYnJlYWs7XG4gICAgICBkZWZhdWx0OiB0aHJvdyBuZXcgRXJyb3Ioc2FmZVN0cmluZ2lmeShzY3JlZW5FdmVudCkpO1xuICAgIH1cbiAgICByZXR1cm4gW2hhc0NoYW5nZWQsIG11c3RSZW5kZXJdO1xuICB9XG5cbiAgLy8g4pSA4pSAIGtleWJvYXJkIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICBvbktleShjaCwga2V5LCBvbkNoYW5nZSA9ICgpID0+IHsgfSkge1xuICAgIGxldCBoYXNDaGFuZ2VkID0gZmFsc2U7XG4gICAgbGV0IG11c3RSZW5kZXIgPSBmYWxzZTtcblxuICAgIGNvbnN0IG1vdmVBbGwgPSBmbiA9PiB7IHRoaXMuY3Vyc29ycyA9IHRoaXMuY3Vyc29ycy5tYXAoY3JzID0+IGZuKGNycykpOyB9O1xuXG4gICAgc3dpdGNoIChrZXkuZnVsbCkge1xuICAgICAgY2FzZSAndXAnOiBtb3ZlQWxsKGNycyA9PiB0aGlzLm1vdmVDdXJzb3JVcChjcnMpKTsgaWYgKCFrZXkubWV0YSkgdGhpcy5zZWxlY3RTdGFydCA9IG51bGw7IG11c3RSZW5kZXIgPSB0cnVlOyBicmVhaztcbiAgICAgIGNhc2UgJ2Rvd24nOiBtb3ZlQWxsKGNycyA9PiB0aGlzLm1vdmVDdXJzb3JEb3duKGNycykpOyBpZiAoIWtleS5tZXRhKSB0aGlzLnNlbGVjdFN0YXJ0ID0gbnVsbDsgbXVzdFJlbmRlciA9IHRydWU7IGJyZWFrO1xuICAgICAgY2FzZSAnbGVmdCc6XG4gICAgICAgIGlmIChrZXkuY3RybCkgbW92ZUFsbChjcnMgPT4gdGhpcy5fd29yZExlZnQoY3JzKSk7IGVsc2UgbW92ZUFsbChjcnMgPT4gdGhpcy5tb3ZlQ3Vyc29yTGVmdChjcnMpKTtcbiAgICAgICAgaWYgKCFrZXkubWV0YSkgdGhpcy5zZWxlY3RTdGFydCA9IG51bGw7IG11c3RSZW5kZXIgPSB0cnVlOyBicmVhaztcbiAgICAgIGNhc2UgJ3JpZ2h0JzpcbiAgICAgICAgaWYgKGtleS5jdHJsKSBtb3ZlQWxsKGNycyA9PiB0aGlzLl93b3JkUmlnaHQoY3JzKSk7IGVsc2UgbW92ZUFsbChjcnMgPT4gdGhpcy5tb3ZlQ3Vyc29yUmlnaHQoY3JzKSk7XG4gICAgICAgIGlmICgha2V5Lm1ldGEpIHRoaXMuc2VsZWN0U3RhcnQgPSBudWxsOyBtdXN0UmVuZGVyID0gdHJ1ZTsgYnJlYWs7XG4gICAgICBjYXNlICdob21lJzogbW92ZUFsbChjcnMgPT4gdGhpcy5nZXRDdXJzb3IoeyB4OiAwLCB5OiBjcnMueSB9KSk7IG11c3RSZW5kZXIgPSB0cnVlOyBicmVhaztcbiAgICAgIGNhc2UgJ2VuZCc6IG1vdmVBbGwoY3JzID0+IHRoaXMuZ2V0Q3Vyc29yKHsgeDogdGhpcy5saW5lc1tjcnMueV0ubGVuZ3RoLCB5OiBjcnMueSB9KSk7IG11c3RSZW5kZXIgPSB0cnVlOyBicmVhaztcbiAgICAgIGNhc2UgJ3BhZ2V1cCc6IHRoaXMuc2Nyb2xsVmlld3BvcnQoLXRoaXMudmlld3BvcnRIZWlnaHQpOyBtdXN0UmVuZGVyID0gdHJ1ZTsgYnJlYWs7XG4gICAgICBjYXNlICdwYWdlZG93bic6IHRoaXMuc2Nyb2xsVmlld3BvcnQoK3RoaXMudmlld3BvcnRIZWlnaHQpOyBtdXN0UmVuZGVyID0gdHJ1ZTsgYnJlYWs7XG5cbiAgICAgIGNhc2UgJ2JhY2tzcGFjZSc6IHRoaXMuY3Vyc29ycy5mb3JFYWNoKGNycyA9PiB0aGlzLmJhY2tzcGFjZShjcnMpKTsgaGFzQ2hhbmdlZCA9IHRydWU7IGJyZWFrO1xuICAgICAgY2FzZSAnZGVsZXRlJzogdGhpcy5jdXJzb3JzLmZvckVhY2goY3JzID0+IHRoaXMuZGVsZXRlKGNycykpOyBoYXNDaGFuZ2VkID0gdHJ1ZTsgYnJlYWs7XG5cbiAgICAgIGNhc2UgJ3JldHVybic6XG4gICAgICAgIHRoaXMuX2ZvckVhY2hTb3J0ZWRDdXJzb3IoKGNycywgaSkgPT4geyBjcnMueSArPSBpOyB0aGlzLmluc2VydCgnXFxuJywgY3JzKTsgY3JzLnkgKz0gMTsgY3JzLnggPSAwOyB9KTtcbiAgICAgICAgaGFzQ2hhbmdlZCA9IHRydWU7IGJyZWFrO1xuXG4gICAgICBjYXNlICd0YWInOlxuICAgICAgICB0aGlzLl9mb3JFYWNoU29ydGVkQ3Vyc29yKGNycyA9PiB7IHRoaXMuaW5zZXJ0KCdcXHQnLCBjcnMpOyB9KTtcbiAgICAgICAgaGFzQ2hhbmdlZCA9IHRydWU7IGJyZWFrO1xuXG4gICAgICBjYXNlICdDLWMnOiB7IC8vIGNvcHkgc2VsZWN0aW9uKHMpXG4gICAgICAgIGNvbnN0IHRleHQgPSB0aGlzLnNlbGVjdGlvbnMuZmxhdE1hcChzID0+IHtcbiAgICAgICAgICBjb25zdCBsaW5lcyA9IFtdO1xuICAgICAgICAgIGNvbnN0IHkwID0gTWF0aC5taW4ocy5zdGFydC55LCBzLmVuZC55KSwgeTEgPSBNYXRoLm1heChzLnN0YXJ0LnksIHMuZW5kLnkpO1xuICAgICAgICAgIGNvbnN0IHgwID0gTWF0aC5taW4ocy5zdGFydC54LCBzLmVuZC54KSwgeDEgPSBNYXRoLm1heChzLnN0YXJ0LngsIHMuZW5kLngpO1xuICAgICAgICAgIGZvciAobGV0IHkgPSB5MDsgeSA8PSB5MTsgeSsrKSB7XG4gICAgICAgICAgICBjb25zdCBsaW5lID0gdGhpcy5saW5lc1t5XSA/PyAnJztcbiAgICAgICAgICAgIGNvbnN0IGZyb20gPSAoeSA9PT0geTApID8geDAgOiAwO1xuICAgICAgICAgICAgY29uc3QgdG8gPSAoeSA9PT0geTEpID8geDEgKyAxIDogbGluZS5sZW5ndGg7XG4gICAgICAgICAgICBsaW5lcy5wdXNoKGxpbmUuc3Vic3RyaW5nKGZyb20sIHRvKSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBsaW5lcztcbiAgICAgICAgfSkuam9pbignXFxuJyk7XG4gICAgICAgIGNsaXBib2FyZENvcHkodGV4dCwgKCkgPT4ge30pO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ0MtcCc6IHsgdGhyb3cgbmV3IEVycm9yKCdwYXN0ZSBvcGVyYXRpb24gbm90IGltcGxlbWVudGVkJyk7IH1cbiAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgY29uc3QgcHJpbnRhYmxlID0gKGtleS5zZXF1ZW5jZSAmJiBrZXkuc2VxdWVuY2UubGVuZ3RoID09PSAxKSA/IGtleS5zZXF1ZW5jZVxuICAgICAgICAgICAgOiAoa2V5Lm5hbWUgJiYga2V5Lm5hbWUubGVuZ3RoID09PSAxKSA/IGtleS5uYW1lXG4gICAgICAgICAgICAgICAgOiAoY2ggJiYgY2gubGVuZ3RoID8gY2ggOiAnJyk7XG4gICAgICAgIGlmIChwcmludGFibGUpIHsgdGhpcy5jdXJzb3JzLmZvckVhY2goY3JzID0+IHRoaXMuaW5zZXJ0KHByaW50YWJsZSwgY3JzKSk7IGhhc0NoYW5nZWQgPSB0cnVlOyB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGhhc0NoYW5nZWQpIHRoaXMuc2F2ZSgpO1xuICAgIHJldHVybiBbaGFzQ2hhbmdlZCwgbXVzdFJlbmRlcl07XG4gIH1cblxuICBfZm9yRWFjaFNvcnRlZEN1cnNvcihmbikgeyB0aGlzLmN1cnNvcnMudG9Tb3J0ZWQoKGEsIGIpID0+IGEueSAtIGIueSkuZm9yRWFjaChmbik7IH1cblxuICAvLyDilIDilIAgbW92ZW1lbnQg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gIC8qKiBAcGFyYW0ge0N1cnNvclBvaW50fSBjdXJzb3IgKi8gbW92ZUN1cnNvclVwKGN1cnNvcikge1xuICAgIGlmIChjdXJzb3IueSA+IDApIHsgY3Vyc29yLnktLTsgY29uc3QgbGluZSA9IHRoaXMubGluZXNbY3Vyc29yLnldID8/ICcnOyBjdXJzb3IueCA9IE1hdGgubWluKGN1cnNvci54LCBsaW5lLmxlbmd0aCk7IHRoaXMuX2Vuc3VyZUN1cnNvckluVmlldyhjdXJzb3IpOyB9XG4gICAgcmV0dXJuIGN1cnNvcjtcbiAgfVxuICAvKiogQHBhcmFtIHtDdXJzb3JQb2ludH0gY3Vyc29yICovIG1vdmVDdXJzb3JEb3duKGN1cnNvcikge1xuICAgIGlmICgoY3Vyc29yLnkgKyAxKSA8IHRoaXMubGluZXMubGVuZ3RoKSB7IGNvbnN0IG5leHQgPSB0aGlzLmxpbmVzW2N1cnNvci55ICsgMV0gPz8gJyc7IGN1cnNvci54ID0gTWF0aC5taW4oY3Vyc29yLngsIG5leHQubGVuZ3RoKTsgY3Vyc29yLnkrKzsgdGhpcy5fZW5zdXJlQ3Vyc29ySW5WaWV3KGN1cnNvcik7IH1cbiAgICByZXR1cm4gY3Vyc29yO1xuICB9XG4gIC8qKiBAcGFyYW0ge0N1cnNvclBvaW50fSBjdXJzb3IgKi8gbW92ZUN1cnNvckxlZnQoY3Vyc29yKSB7XG4gICAgaWYgKGN1cnNvci54ID4gMCkgeyBjdXJzb3IueC0tOyB0aGlzLl9lbnN1cmVDdXJzb3JJblZpZXcoY3Vyc29yKTsgfVxuICAgIHJldHVybiBjdXJzb3I7XG4gIH1cbiAgLyoqIEBwYXJhbSB7Q3Vyc29yUG9pbnR9IGN1cnNvciAqLyBtb3ZlQ3Vyc29yUmlnaHQoY3Vyc29yKSB7XG4gICAgY29uc3QgbGluZSA9IHRoaXMubGluZXNbY3Vyc29yLnldID8/ICcnO1xuICAgIGN1cnNvci54ID0gTWF0aC5taW4oY3Vyc29yLnggKyAxLCBsaW5lLmxlbmd0aCk7XG4gICAgdGhpcy5fZW5zdXJlQ3Vyc29ySW5WaWV3KGN1cnNvcik7XG4gICAgcmV0dXJuIGN1cnNvcjtcbiAgfVxuXG4gIF93b3JkTGVmdChjdXJzb3IpIHtcbiAgICBjb25zdCBsaW5lID0gdGhpcy5saW5lc1tjdXJzb3IueV0gPz8gJyc7XG4gICAgbGV0IHggPSBjdXJzb3IueCAtIDE7XG4gICAgd2hpbGUgKHggPiAwICYmIGxpbmVbeF0gPT09ICcgJykgeC0tO1xuICAgIHdoaWxlICh4ID4gMCAmJiBsaW5lW3ggLSAxXSAmJiAvXFx3Ly50ZXN0KGxpbmVbeCAtIDFdKSkgeC0tO1xuICAgIGN1cnNvci54ID0gY2xhbXAoeCwgMCwgbGluZS5sZW5ndGgpO1xuICAgIHRoaXMuX2Vuc3VyZUN1cnNvckluVmlldyhjdXJzb3IpO1xuICAgIHJldHVybiBjdXJzb3I7XG4gIH1cbiAgX3dvcmRSaWdodChjdXJzb3IpIHtcbiAgICBjb25zdCBsaW5lID0gdGhpcy5saW5lc1tjdXJzb3IueV0gPz8gJyc7XG4gICAgbGV0IHggPSBjdXJzb3IueDtcbiAgICB3aGlsZSAoeCA8IGxpbmUubGVuZ3RoICYmIGxpbmVbeF0gPT09ICcgJykgeCsrO1xuICAgIHdoaWxlICh4IDwgbGluZS5sZW5ndGggJiYgL1xcdy8udGVzdChsaW5lW3hdKSkgeCsrO1xuICAgIGN1cnNvci54ID0gY2xhbXAoeCwgMCwgbGluZS5sZW5ndGgpO1xuICAgIHRoaXMuX2Vuc3VyZUN1cnNvckluVmlldyhjdXJzb3IpO1xuICAgIHJldHVybiBjdXJzb3I7XG4gIH1cblxuICBtb3ZlQ3Vyc29yVmVydGljYWxseShuLCBjdXJzb3IpIHtcbiAgICBpZiAobiA9PT0gMCkgcmV0dXJuIGN1cnNvcjtcbiAgICBjb25zdCBkaXIgPSBNYXRoLnNpZ24obik7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBNYXRoLmFicyhuKTsgaSsrKSB7XG4gICAgICBpZiAoZGlyID4gMCkgdGhpcy5tb3ZlQ3Vyc29yRG93bihjdXJzb3IpOyBlbHNlIHRoaXMubW92ZUN1cnNvclVwKGN1cnNvcik7XG4gICAgfVxuICAgIHJldHVybiBjdXJzb3I7XG4gIH1cblxuICAvLyDilIDilIAgZWRpdHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gIC8qKiBAcGFyYW0ge3N0cmluZ30gdGV4dCBAcGFyYW0ge0N1cnNvclBvaW50fSBjdXJzb3IgKi9cbiAgaW5zZXJ0KHRleHQsIGN1cnNvcikge1xuICAgIGNvbnN0IGxpbmUgPSB0aGlzLmxpbmVzW2N1cnNvci55XSA/PyAnJztcbiAgICBjb25zdCBiZWZvcmUgPSBsaW5lLnN1YnN0cmluZygwLCBjdXJzb3IueCk7XG4gICAgY29uc3QgYWZ0ZXIgPSBsaW5lLnN1YnN0cmluZyhjdXJzb3IueCk7XG5cbiAgICBjb25zdCBwYXJ0cyA9IFN0cmluZyh0ZXh0KS5zcGxpdCgnXFxuJyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgdGhpcy5saW5lc1tjdXJzb3IueV0gPSBiZWZvcmUgKyBwYXJ0c1swXSArIGFmdGVyO1xuICAgICAgdGhpcy51cGRhdGVUb2tlbnNMaW5lKGN1cnNvci55KTtcbiAgICAgIGN1cnNvci54ICs9IHBhcnRzWzBdLmxlbmd0aDtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgZmlyc3QgPSBiZWZvcmUgKyBwYXJ0c1swXTtcbiAgICAgIGNvbnN0IG1pZGRsZSA9IHBhcnRzLnNsaWNlKDEsIC0xKTtcbiAgICAgIGNvbnN0IGxhc3QgPSBwYXJ0c1twYXJ0cy5sZW5ndGggLSAxXSArIGFmdGVyO1xuICAgICAgY29uc3QgbmV3TGluZXMgPSBbZmlyc3QsIC4uLm1pZGRsZSwgbGFzdF07XG4gICAgICB0aGlzLmxpbmVzLnNwbGljZShjdXJzb3IueSwgMSwgLi4ubmV3TGluZXMpO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuZXdMaW5lcy5sZW5ndGg7IGkrKykgdGhpcy51cGRhdGVUb2tlbnNMaW5lKGN1cnNvci55ICsgaSk7XG4gICAgICBjdXJzb3IueSArPSAocGFydHMubGVuZ3RoIC0gMSk7XG4gICAgICBjdXJzb3IueCA9IHBhcnRzW3BhcnRzLmxlbmd0aCAtIDFdLmxlbmd0aDtcbiAgICB9XG4gICAgdGhpcy5fZW5zdXJlQ3Vyc29ySW5WaWV3KGN1cnNvcik7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKiogZGVsZXRlIGNoYXIgYXQgY3Vyc29yLCBvciBqb2luIHdpdGggbmV4dCBsaW5lIGlmIGF0IEVPTCAqL1xuICBkZWxldGUoY3Vyc29yKSB7XG4gICAgY29uc3QgbGluZSA9IHRoaXMubGluZXNbY3Vyc29yLnldID8/ICcnO1xuICAgIGlmIChjdXJzb3IueCA9PT0gbGluZS5sZW5ndGgpIHtcbiAgICAgIGlmIChjdXJzb3IueSA+PSB0aGlzLmxpbmVzLmxlbmd0aCAtIDEpIHJldHVybiB0aGlzOyAvLyBub3RoaW5nIHRvIGpvaW5cbiAgICAgIGNvbnN0IG5leHRMaW5lID0gdGhpcy5saW5lc1tjdXJzb3IueSArIDFdID8/ICcnO1xuICAgICAgdGhpcy5saW5lcy5zcGxpY2UoY3Vyc29yLnksIDIsIGxpbmUgKyBuZXh0TGluZSk7XG4gICAgICB0aGlzLnVwZGF0ZVRva2Vuc0xpbmUoY3Vyc29yLnkpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmxpbmVzW2N1cnNvci55XSA9IGxpbmUuc3Vic3RyaW5nKDAsIGN1cnNvci54KSArIGxpbmUuc3Vic3RyaW5nKGN1cnNvci54ICsgMSk7XG4gICAgICB0aGlzLnVwZGF0ZVRva2Vuc0xpbmUoY3Vyc29yLnkpO1xuICAgICAgLy8gY3Vyc29yIHN0YXlzIGluIHBsYWNlXG4gICAgfVxuICAgIHRoaXMuX2Vuc3VyZUN1cnNvckluVmlldyhjdXJzb3IpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgYmFja3NwYWNlKGN1cnNvcikge1xuICAgIGlmIChjdXJzb3IueCA+IDApIHtcbiAgICAgIGN1cnNvci54LS07IHRoaXMuZGVsZXRlKGN1cnNvcik7XG4gICAgfSBlbHNlIGlmIChjdXJzb3IueSA+IDApIHtcbiAgICAgIGNvbnN0IHByZXZMZW4gPSAodGhpcy5saW5lc1tjdXJzb3IueSAtIDFdID8/ICcnKS5sZW5ndGg7XG4gICAgICBjdXJzb3IueS0tOyBjdXJzb3IueCA9IHByZXZMZW47IHRoaXMuZGVsZXRlKGN1cnNvcik7IHRoaXMudXBkYXRlVG9rZW5zTGluZShjdXJzb3IueSk7XG4gICAgfVxuICAgIHRoaXMuX2Vuc3VyZUN1cnNvckluVmlldyhjdXJzb3IpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8g4pSA4pSAIGNsb25lIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAvKiogcmV0dXJuIGEgbmV3IGluc3RhbmNlIHdpdGggaWRlbnRpY2FsIHN0YXRlICovXG4gIGNvcHkoKSB7XG4gICAgY29uc3QgY2xvbmUgPSBuZXcgQ29kZUJ1ZmZlckVkaXRvcih0aGlzLmZpbGVQYXRoLCB7IHJvd3M6IHRoaXMudmlld3BvcnRIZWlnaHQsIGNvbHM6IHRoaXMudmlld3BvcnRXaWR0aCB9KTtcbiAgICBjbG9uZS5maWxlUGF0aD10aGlzLmZpbGVQYXRoXG4gICAgY2xvbmUudmlld3BvcnRZPXRoaXMudmlld3BvcnRZXG4gICAgY2xvbmUudmlld3BvcnRYPXRoaXMudmlld3BvcnRYXG4gICAgY2xvbmUubGluZXM9dGhpcy5saW5lc1xuICAgIGNsb25lLmN1cnNvcnM9dGhpcy5jdXJzb3JzXG4gICAgY2xvbmUudG9rZW5zPXRoaXMudG9rZW5zXG4gICAgY2xvbmUudG9rZW5pemVyPXRoaXMudG9rZW5pemVyXG4gICAgY2xvbmUuc2VsZWN0aW9ucz10aGlzLnNlbGVjdGlvbnNcbiAgICBjbG9uZS5zZWxlY3RTdGFydD10aGlzLnNlbGVjdFN0YXJ0XG4gICAgY2xvbmUuX3NhdmVkPXRoaXMuX3NhdmVkXG4gICAgcmV0dXJuIGNsb25lO1xuICB9XG5cbiAgZ2V0U3RhdHVzKCkge1xuICAgIGNvbnN0IHZpc2libGUgPSBPYmplY3Qua2V5cyh0aGlzLnJlbmRlclZpZXdwb3J0KCkpO1xuICAgIGNvbnN0IGZpcnN0ID0gdmlzaWJsZVswXSA/PyAwO1xuICAgIGNvbnN0IGxhc3QgPSB2aXNpYmxlW3Zpc2libGUubGVuZ3RoIC0gMV0gPz8gMDtcbiAgICBjb25zdCBqc29uID0ge1xuICAgICAgY3Vyc29yOiB0aGlzLmN1cnNvcnMsXG4gICAgICB2OiB7IHg6IHRoaXMudmlld3BvcnRYLCB5OiB0aGlzLnZpZXdwb3J0WSwgdzogdGhpcy52aWV3cG9ydFdpZHRoLCBoOiB0aGlzLnZpZXdwb3J0SGVpZ2h0IH0sXG4gICAgICBzOiB0aGlzLl9zYXZlZCxcbiAgICAgIGw6IGAke2ZpcnN0fSAuLi4gJHtsYXN0fWAsXG4gICAgfTtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoanNvbikucmVwbGFjZSgvXCIvZ2ksICcnKTtcbiAgfVxufVxuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIHV0aWxzXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmZ1bmN0aW9uIGNsYW1wKG4sIG1pbiwgbWF4KSB7IHJldHVybiBNYXRoLm1heChtaW4sIE1hdGgubWluKG1heCwgbikpOyB9XG4iLCJpbXBvcnQgUmVhY3QsIHt1c2VFZmZlY3QsIHVzZVJlZiwgdXNlU3RhdGV9IGZyb20gJ3JlYWN0JztcbmltcG9ydCB7Q29kZUJ1ZmZlckVkaXRvciwgQ3Vyc29yUG9pbnQsIFJlY3RhbmdsZX0gZnJvbSAnLi9Db2RlQnVmZmVyRWRpdG9yLmpzJztcbmltcG9ydCB7IEJveEVsZW1lbnQgYXMgYm94LCBUZXh0RWxlbWVudCBhcyB0ZXh0IH0gZnJvbSAncmVhY3QtYmxlc3NlZCc7XG5pbXBvcnQge3NhZmVTdHJpbmdpZnl9IGZyb20gXCIuL3V0aWxcIjtcblxuXG5leHBvcnQgZnVuY3Rpb24gQ29kZUJ1ZmZlckVkaXRvckNvbXBvbmVudCh7XG4gICAgZmlsZVBhdGgsXG4gICAgb25LZXlwcmVzcz0oY2gsa2V5KSA9Pnt9LFxuICAgIG9uQ2hhbmdlID0gKHtlZGl0b3IsY2gsa2V5LHNjcmVlbkV2ZW50LHZpZXdwb3J0fSkgPT4ge30sXG4gICAgb25FdmVudCA9ICh7ZWRpdG9yLGNoLGtleSxzY3JlZW5FdmVudCx2aWV3cG9ydH0pID0+IHt9LFxuICAgIC4uLmJveFByb3BzXG59KSB7XG4gIGNvbnN0IGJveFJlZiA9IHVzZVJlZigpO1xuICAvKipcbiAgICogQGNvbnN0YW50IHtbQ29kZUJ1ZmZlckVkaXRvciwoZWQ6Q29kZUJ1ZmZlckVkaXRvcik9PnZvaWRdfSBbZWRpdG9yLCBzZXRFZGl0b3JdXG4gICAqL1xuXG5cdFxuICBjb25zdCBbZWRpdG9yLCBzZXRFZGl0b3JdID0gdXNlU3RhdGUobnVsbCk7XG4gIGNvbnN0IFtzaXplLCBzZXRTaXplXSAgICAgPSB1c2VTdGF0ZSh7IHJvd3M6IDEwLCBjb2xzOiAzMCB9KTtcbiAgY29uc3RbbGFzdEV2ZW50LHNldExhc3RFdmVudF0gPSB1c2VTdGF0ZSh7ZWRpdG9yOm51bGwsY2g6bnVsbCxrZXk6bnVsbCxzY3JlZW5FdmVudDpudWxsLHZpZXdwb3J0Om51bGx9KVxuXG5cbiAgLy8gMSkgKFJlKWNyZWF0ZSBlZGl0b3Igd2hlbmV2ZXIgZmlsZVBhdGggY2hhbmdlc1xuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGlmIChmaWxlUGF0aCkge1xuICAgICAgY29uc3QgZWQgPSBuZXcgQ29kZUJ1ZmZlckVkaXRvcihmaWxlUGF0aCwgeyByb3dzOiBzaXplLnJvd3MsIGNvbHM6IHNpemUuY29scyB9KTtcbiAgICAgIC8vIGltbWVkaWF0ZWx5IHJlbmRlciB0aGUgbmV3IGZpbGVcbiAgICAgIGVkLnZpZXdwb3J0SGVpZ2h0ID0gc2l6ZS5yb3dzLTE7XG4gICAgICBlZC52aWV3cG9ydFdpZHRoID0gc2l6ZS5jb2xzO1xuICAgICAgc2V0RWRpdG9yKGVkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc2V0RWRpdG9yKG51bGwpO1xuICAgIH1cbiAgfSwgW2ZpbGVQYXRoXSk7XG5cbiAgLy8gMikgdXBkYXRlIHNpemUgb24gcmVzaXplXG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgY29uc3QgYm94ID0gYm94UmVmLmN1cnJlbnQ7XG4gICAgaWYgKCFib3gpIHJldHVybjtcbiAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XG4gICAgICBzZXRTaXplKHsgY29sczogYm94LndpZHRoLCByb3dzOiBib3guaGVpZ2h0LTIgfSk7XG4gICAgfTtcbiAgICB1cGRhdGUoKTtcbiAgICBib3gub24oJ3Jlc2l6ZScsIHVwZGF0ZSk7XG4gICAgcmV0dXJuICgpID0+IGJveC5yZW1vdmVMaXN0ZW5lcigncmVzaXplJywgdXBkYXRlKTtcbiAgfSwgW10pO1xuXG4gIC8vIHJ1biBvbmNlIG9uIHNpemUgY2hhbmdlXG4gIHVzZUVmZmVjdCgoKT0+e1xuICAgIGlmKGVkaXRvcil7XG4gICAgICBlZGl0b3Iudmlld3BvcnRXaWR0aCA9IHNpemUuY29scztcbiAgICAgIGVkaXRvci52aWV3cG9ydEhlaWdodCA9IHNpemUucm93cztcbiAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgIH1cbiAgfSwgW3NpemVdKTtcbiAgY29uc3QgcmVuZGVyQ3Vyc29ycyA9ICgpPT57XG4gICAgaWYoIWVkaXRvcil7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgPGJveCBrZXk9e2AwLTEtbm8tZmlsZWB9XG4gICAgICAgICAgICBsZWZ0PXs0fSB0b3A9ezF9IHdpZHRoPXsxfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICBzdHlsZT17e2JsaW5rOnRydWV9fVxuICAgICAgICAgICAgY29udGVudD17J18nfVxuICAgICAgICAgIC8+XG4gICAgICAgIClcbiAgICB9XG4gICAgY29uc3QgcGFkTGVuZ3RoPU1hdGguY2VpbChNYXRoLmxvZzEwKGVkaXRvci52aWV3cG9ydEhlaWdodCtlZGl0b3Iudmlld3BvcnRZKSkrMVxuXG4gICAgcmV0dXJuIFsuLi5lZGl0b3IuY3Vyc29yc11cbiAgICAgICAgLmZpbHRlcigoY3Vyc29yLHkpPT57XG4gICAgICAgICAgcmV0dXJuIGN1cnNvci55Pj1lZGl0b3Iudmlld3BvcnRZICYmIGN1cnNvci55IDw9IChlZGl0b3Iudmlld3BvcnRZK2VkaXRvci52aWV3cG9ydEhlaWdodClcbiAgICAgICAgfSlcbiAgICAgICAgLm1hcCgoY3JzLGlkKT0+e1xuICAgICAgICAgIGNvbnN0IGN1cnNvciA9IGVkaXRvci5nZXRDdXJzb3Ioey4uLmNyc30pXG4gICAgICAgICAgcmV0dXJuIDxib3gga2V5PXtgY3Vyc29yLSR7aWR9LSR7RGF0ZS5ub3coKX1gfVxuICAgICAgICAgICAgICBsZWZ0PXtjdXJzb3IueC1lZGl0b3Iudmlld3BvcnRYK3BhZExlbmd0aCsxKyAxfSB0b3A9e2N1cnNvci55LWVkaXRvci52aWV3cG9ydFl9IHdpZHRoPXsxfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgIHN0eWxlPXt7Li4uY3Vyc29yLnN0eWxlLHVuZGVybGluZTogdHJ1ZSxib2xkOnRydWUsaW52ZXJzZTp0cnVlfX1cbiAgICAgICAgICAgICAgdGFncz17ZmFsc2V9XG4gICAgICAgICAgICAgIGNvbnRlbnQ9e2N1cnNvci5jaGFyfVxuICAgICAgICAgIC8+XG4gICAgICAgIH0pXG5cbiAgfVxuICBjb25zdCByZW5kZXJTZWxlY3Rpb25zID0gKCkgPT4ge1xuICAgIGlmKCFlZGl0b3Ipe1xuICAgICAgcmV0dXJuIFtdXG4gICAgfVxuICAgIGNvbnN0IHBhZExlbmd0aD1NYXRoLmNlaWwoTWF0aC5sb2cxMChlZGl0b3Iudmlld3BvcnRIZWlnaHQrZWRpdG9yLnZpZXdwb3J0WSkpKzFcbiAgICBjb25zdCB2aXNpYmxlQXJlYSA9IFJlY3RhbmdsZS5mcm9tRWRpdG9yKGVkaXRvcilcblxuICAgIHJldHVybiBbLi4uZWRpdG9yLnNlbGVjdGlvbnNdXG4gICAgICAgIC5jb25jYXQoW2VkaXRvci5zZWxlY3RTdGFydF0pXG4gICAgICAgIC5maWx0ZXIoKHNlbGVjdGlvbix5KT0+e1xuICAgICAgICAgIHJldHVybiBzZWxlY3Rpb24gIT09IG51bGwgJiYgc2VsZWN0aW9uLmlzVmlzaWJsZSh2aXNpYmxlQXJlYSlcbiAgICAgICAgfSlcbiAgICAgICAgLmZsYXRNYXAocyA9PiB7XG4gICAgICAgICAgY29uc3QgbGluZXM9W11cbiAgICAgICAgICBmb3IobGV0IHk9cy5zdGFydC55O3k8PXMuZW5kLnk7eSsrKXtcbiAgICAgICAgICAgIGxpbmVzLnB1c2goe1xuICAgICAgICAgICAgICB4OnMuc3RhcnQueC1lZGl0b3Iudmlld3BvcnRYK3BhZExlbmd0aCsxKyAxLFxuICAgICAgICAgICAgICB5OnktZWRpdG9yLnZpZXdwb3J0WSxcbiAgICAgICAgICAgICAgc3R5bGU6IHMuc3RhcnQuc3R5bGUsXG4gICAgICAgICAgICAgIGNvbnRlbnQ6KGVkaXRvci5saW5lc1t5XS5zdWJzdHJpbmcocy5zdGFydC54LCBzLmVuZC54ICsgMSkpLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIGxpbmVzXG4gICAgICAgIH0pXG4gICAgICAgIC5tYXAoKHJzLGlkKT0+e1xuICAgICAgICAgIHJldHVybiA8Ym94IGtleT17YHNlbGVjdGlvbi0ke2lkfS0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgICAgICAgICAgICBsZWZ0PXtycy54fSB0b3A9e3JzLnl9IHdpZHRoPXtycy5jb250ZW50Lmxlbmd0aH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgICAgICAgICAgIHN0eWxlPXt7Li4ucnMuc3R5bGUsdW5kZXJsaW5lOiB0cnVlLGJvbGQ6dHJ1ZSxpbnZlcnNlOnRydWV9fVxuICAgICAgICAgICAgICAgICAgICAgIHRhZ3M9e2ZhbHNlfVxuICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ9e3JzLmNvbnRlbnR9XG4gICAgICAgICAgLz5cbiAgICAgICAgfSlcblxuICB9XG5cbiAgY29uc3QgdG9rZW5MaXN0ID0gKCk9PntcbiAgICBpZighZWRpdG9yKXtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICA8Ym94IGtleT17YDAtMC1uby1maWxlYH0gXG4gICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgbGVmdD17KHNpemUuY29scz4+MSkgLSA4fSB0b3A9eyhzaXplLnJvd3M+PjEpLTF9IHdpZHRoPXsxNn0gaGVpZ2h0PXszfSBcbiAgICAgICAgICAgIHN0eWxlPXt7Ymc6JyNlZWVlMDAnLGZnOicjMTExMTExJ319XG4gICAgICAgICAgICBjb250ZW50PXsnXFxuIE5vIEZpbGUgTG9hZGVkJ31cbiAgICAgICAgICAvPlxuICAgICAgICApXG4gICAgfVxuICAgIFxuICAgIGNvbnN0IHBhZExlbmd0aD1NYXRoLmNlaWwoTWF0aC5sb2cxMChlZGl0b3Iudmlld3BvcnRIZWlnaHQrZWRpdG9yLnZpZXdwb3J0WSkpKzFcbiAgICBjb25zdCBsaW5lcyA9IGVkaXRvci5yZW5kZXJWaWV3cG9ydCgpO1xuICAgIHJldHVybiBPYmplY3Qua2V5cyhsaW5lcykuZmxhdE1hcCgobGluZU51bWJlciwgaykgPT4ge1xuICAgICAgY29uc3QgbGluZSA9IGxpbmVzW2xpbmVOdW1iZXJdXG4gICAgICBjb25zdCBsaW5lTnVtYmVyVGV4dCA9IGAke1N0cmluZyhsaW5lTnVtYmVyKS5wYWRTdGFydChwYWRMZW5ndGgsICcgJyl9YFxuICAgICAgY29uc3QgbGluZU51bWJlckJveCA9IChcbiAgICAgICAgICA8Ym94IGtleT17YCR7bGluZU51bWJlcn0tbGluZU51bWJlci0ke0RhdGUubm93fWB9XG4gICAgICAgICAgICAgICBsZWZ0PXswfSB0b3A9e2t9IHdpZHRoPXtwYWRMZW5ndGggKyAxfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgICBzdHlsZT17e2JnOiAnIzIyMjIyMicsIGZnOiAnIzMzYWFiYicsIGludmVyc2U6IGVkaXRvci5jdXJzb3JzLm1hcChjID0+Yy55KS5pbmRleE9mKGxpbmVOdW1iZXIpPi0xfX1cbiAgICAgICAgICAgICAgIGNvbnRlbnQ9e2xpbmVOdW1iZXJUZXh0KyfilIInfVxuICAgICAgICAgIC8+KVxuICAgICAgY29uc3QgcGxhaW5MaW5lVGV4dCA9IChcbiAgICAgICAgICA8Ym94IGtleT17YGNvZGUtJHtsaW5lTnVtYmVyfS0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgICAgIGxlZnQ9e3BhZExlbmd0aCArIDEgKyAxfSB0b3A9e2t9IHdpZHRoPXtlZGl0b3IubGluZXNbbGluZU51bWJlcl0ubGVuZ3RofSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgICBzdHlsZT17e2JnOiAnIzIyMjIyMicsIGZnOiAnIzMzYWFiYicsIGludmVyc2U6IGVkaXRvci5jdXJzb3JzLm1hcChjID0+Yy55KS5pbmRleE9mKGxpbmVOdW1iZXIpPi0xfX1cbiAgICAgICAgICAgICAgIGNvbnRlbnQ9e2VkaXRvci5saW5lc1tsaW5lTnVtYmVyXX1cbiAgICAgICAgICAvPilcbiAgICAgIHJldHVybiBsaW5lLnJlZHVjZSgoYSwgdCkgPT4ge1xuICAgICAgICBhLnB1c2goXG4gICAgICAgICAgICA8Ym94IGtleT17YCR7dC54fS0ke3QueX0tJHtEYXRlLm5vdygpfWB9XG4gICAgICAgICAgICAgICAgIGxlZnQ9e3QueCArIHBhZExlbmd0aCArIDEgKyAxfSB0b3A9e3QueSAtIGVkaXRvci52aWV3cG9ydFl9IHdpZHRoPXt0LnRleHQubGVuZ3RofSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgICAgIHN0eWxlPXt0LnN0eWxlfVxuICAgICAgICAgICAgICAgICBjb250ZW50PXt0LnRleHR9XG4gICAgICAgICAgICAvPlxuICAgICAgICApXG4gICAgICAgIHJldHVybiBhXG4gICAgICB9LCBbXG4gICAgICAgIGxpbmVOdW1iZXJCb3gsXG4gICAgICAgIHBsYWluTGluZVRleHQvKixcbiAgICAgICAgPGJveFxuICAgICAgICAgIGtleT17YHRlcm1pbmF0b3ItJHtsaW5lTnVtYmVyfS0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICBsZWZ0PXtwYWRMZW5ndGggKyAxICsgbGluZS5sZW5ndGh9IHRvcD17bGluZU51bWJlciAtIGVkaXRvci52aWV3cG9ydFl9IHdpZHRoPXsxfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgc3R5bGU9e3tiZzpcIiMxMTMzMTFcIixmZzpcIiM1NTU1NTVcIn19XG4gICAgICAgICAgY29udGVudD17J8KsJ31cbiAgICAgICAgLz4qL1xuICAgICAgXSlcbiAgICB9KVxuICB9XG5cbiAgLy8gMykgT24ga2V5cHJlc3MsIHVwZGF0ZSBlZGl0b3IgdGhlbiByZS1yZW5kZXJcbiAgY29uc3QgaW50ZXJuYWxPbktleXByZXNzID0gKGNoLCBrZXkpID0+IHtcbiAgICBvbktleXByZXNzKGNoLGtleSlcbiAgICBpZihlZGl0b3IgPT0gbnVsbCB8fCBmaWxlUGF0aD09bnVsbCl7XG4gICAgICAgIHJldHVyblxuICAgIH1cbiAgICBjb25zdCBbaGFzQ2hhbmdlZCxtdXN0UmVuZGVyXSA9IGVkaXRvci5vbktleShjaCxrZXkpXG4gICAgaWYoaGFzQ2hhbmdlZCl7XG4gICAgICBjb25zdCBuZXdMYXN0RXZlbnQgPSB7Li4ubGFzdEV2ZW50LGVkaXRvcixjaCxrZXksdmlld3BvcnQ6Ym94UmVmLmN1cnJlbnQubHBvc31cbiAgICAgIG9uQ2hhbmdlKG5ld0xhc3RFdmVudClcbiAgICAgIHNldExhc3RFdmVudChuZXdMYXN0RXZlbnQpXG4gICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICB9IGVsc2UgaWYgKG11c3RSZW5kZXIpIHtcbiAgICAgIGNvbnN0IG5ld0xhc3RFdmVudCA9IHsuLi5sYXN0RXZlbnQsZWRpdG9yLGNoLGtleSx2aWV3cG9ydDpib3hSZWYuY3VycmVudC5scG9zfVxuICAgICAgb25FdmVudChuZXdMYXN0RXZlbnQpXG4gICAgICBzZXRMYXN0RXZlbnQobmV3TGFzdEV2ZW50KVxuICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgfVxuICAgIC8vIHJlZnJlc2goKTtcbiAgfTtcblxuICBjb25zdCBtb3VzZUFjdGlvbj0oc2NyZWVuRXZlbnQpID0+e1xuICAgIGlmKCFlZGl0b3Ipe1xuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGNvbnN0IFttdXN0Q2hhbmdlLG11c3RSZW5kZXJdID0gZWRpdG9yLm9uTW91c2Uoc2NyZWVuRXZlbnQsYm94UmVmLmN1cnJlbnQubHBvcylcbiAgICBpZihtdXN0Q2hhbmdlKXtcbiAgICAgIGNvbnN0IG5ld0xhc3RFdmVudCA9IHsuLi5sYXN0RXZlbnQsZWRpdG9yLHNjcmVlbkV2ZW50LHZpZXdwb3J0OmJveFJlZi5jdXJyZW50Lmxwb3N9XG4gICAgICBvbkNoYW5nZShuZXdMYXN0RXZlbnQpXG4gICAgICBzZXRMYXN0RXZlbnQobmV3TGFzdEV2ZW50KVxuICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgfSBlbHNlIGlmIChtdXN0UmVuZGVyKSB7XG4gICAgICBjb25zdCBuZXdMYXN0RXZlbnQgPSB7Li4ubGFzdEV2ZW50LGVkaXRvcixzY3JlZW5FdmVudCx2aWV3cG9ydDpib3hSZWYuY3VycmVudC5scG9zfVxuICAgICAgb25FdmVudChuZXdMYXN0RXZlbnQpXG4gICAgICBzZXRMYXN0RXZlbnQobmV3TGFzdEV2ZW50KVxuICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgfVxuICB9XG4gIHJldHVybiAoXG4gICAgPGJveFxuICAgICAgcmVmPXtib3hSZWZ9XG4gICAgICB7Li4uYm94UHJvcHN9XG4gICAgICBtb3VzZVxuICAgICAga2V5c1xuICAgICAgaW5wdXRcbiAgICAgIGNsaWNrYWJsZVxuICAgICAgZm9jdXNlZFxuICAgICAgYm9yZGVyPXt7IHR5cGU6ICdsaW5lJyB9fVxuICAgICAgc3R5bGU9e3sgYm9yZGVyOiB7IGZnOiAnY3lhbicgfSB9fVxuICAgICAgdGFncz17ZmFsc2V9ICAgICAgICAgICAvLyByYXcgQU5TSVxuICAgICAgc2Nyb2xsYWJsZT17ZmFsc2V9XG4gICAgICBvbktleXByZXNzPXtpbnRlcm5hbE9uS2V5cHJlc3N9XG4gICAgICBvbk1vdXNlPXttb3VzZUFjdGlvbn1cbiAgICAgIGxhYmVsPXtgRWRpdGluZzogJHtmaWxlUGF0aH1gfVxuICAgID5cbiAgICAgIHsvKiBzdGF0dXNcbiAgICAgIG9uQ2xpY2s9e3NldEN1cnNvclBvc2l0aW9ufVxuICAgICAgb25TY3JvbGw9e3Njcm9sbEN1cnNvcn1cbiAgICAgICovfVxuICAgICAge3Rva2VuTGlzdCgpfVxuICAgICAgey8qIHN0YXR1cyAqL31cbiAgICAgIDxib3hcbiAgICAgICAga2V5PXtgc3RhdHVzYH1cbiAgICAgICAgdG9wPXtzaXplLnJvd3N9XG4gICAgICAgIGxlZnQ9ezJ9XG4gICAgICAgIHdpZHRoPXtzaXplLmNvbHMtNn1cbiAgICAgICAgaGVpZ2h0PXsxfVxuICAgICAgICBjb250ZW50PXtlZGl0b3I/LmdldFN0YXR1cygpfVxuICAgICAgICB0YWdzPXtmYWxzZX1cbiAgICAgICAgc3R5bGU9e3tmZzonYmxhY2snLGJnOid5ZWxsb3cnfX1cbiAgICAgIC8+XG4gICAgICB7cmVuZGVyQ3Vyc29ycygpfVxuICAgICAge3JlbmRlclNlbGVjdGlvbnMoKX1cbiAgICA8L2JveD5cbiAgKTtcbn0iLCJjb25zdCB1dGlsID0gcmVxdWlyZSgndXRpbCcpO1xuY29uc3QgY3AgPSByZXF1aXJlKCdjaGlsZF9wcm9jZXNzJyk7XG5jb25zdCBleGVjID0gdXRpbC5wcm9taXNpZnkoY3AuZXhlYyk7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRTdGF0dXMoY3dkKSB7XG4gIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleGVjKGBnaXQgc3RhdHVzIC0tcG9yY2VsYWluYCwgeyBjd2QgfSk7XG4gIHJldHVybiBzdGRvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRDb21taXRzKGN3ZCkge1xuICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXhlYyhgZ2l0IGxvZyAtLXByZXR0eT1mb3JtYXQ6XCIlaCAlc1wiIC0tYWJicmV2PTQwIHwgdGVlYCwgeyBjd2QgfSk7XG4gIGNvbnN0IGxpbmVzID0gc3Rkb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbilcbiAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKGxpbmVzLm1hcChhc3luYyB2ID0+IHtcbiAgICBjb25zdCBpZCA9IHYuc3Vic3RyaW5nKDAsNDApXG4gICAgY29uc3QgbWVzc2FnZSA9IHYuc3Vic3RyaW5nKDQxKVxuICAgIGNvbnN0IHsgc3Rkb3V0OnRhZ3MgfSA9IGF3YWl0IGV4ZWMoYGdpdCB0YWcgLS1wb2ludHMtYXQgJHtpZH1gLCB7IGN3ZCB9KTtcbiAgICByZXR1cm4gYCR7aWQuc3Vic3RyaW5nKDAsOCl94pSCJHsodGFncz90YWdzLnRyaW0oXCJcXG5cIik6XCJcIikucGFkRW5kKDksJyAnKX3ilIIke21lc3NhZ2V9YFxuICAgIC8vIHJldHVybiBgJHtpZC5zdWJzdHJpbmcoMCw4KX0gJHttZXNzYWdlfWBcbiAgfSkpO1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldEJyYW5jaChjd2QpIHtcbiAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4ZWMoYGdpdCBicmFuY2ggLS1zaG93LWN1cnJlbnRgLCB7IGN3ZCB9KTtcbiAgcmV0dXJuIHN0ZG91dC5zcGxpdCgnXFxuJykuZmlsdGVyKEJvb2xlYW4pO1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldEN1cnJlbnRUYWcoY3dkKSB7XG4gIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleGVjKGBnaXQgZGVzY3JpYmUgLS10YWdzIC0tZXhhY3QtbWF0Y2ggMj4vZGV2L251bGwgfHwgZWNobyBcIm5vbmVcImAsIHsgY3dkIH0pO1xuICByZXR1cm4gc3Rkb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0UmVtb3Rlcyhjd2QpIHtcbiAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4ZWMoYGdpdCByZW1vdGUgLXZgLCB7IGN3ZCB9KTtcbiAgcmV0dXJuIHN0ZG91dC5zcGxpdCgnXFxuJykuZmlsdGVyKEJvb2xlYW4pO1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldFRhZ3MoY3dkKSB7XG4gIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleGVjKGBnaXQgdGFnIHwgdGVlYCwgeyBjd2QgfSk7XG4gIHJldHVybiBzdGRvdXQuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnaXRTdGFnZShjd2QsIGZpbGVQYXRoKSB7XG4gIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleGVjKGBnaXQgYWRkIC1mIFwiJHtmaWxlUGF0aH1cImAsIHsgY3dkIH0pO1xuICByZXR1cm4gc3Rkb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2l0VW5zdGFnZShjd2QsIGZpbGVQYXRoKSB7XG4gIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleGVjKGBnaXQgcmVzdG9yZSAtLXN0YWdlZCBcIiR7ZmlsZVBhdGh9XCJgLCB7IGN3ZCB9KTtcbiAgcmV0dXJuIHN0ZG91dC5zcGxpdCgnXFxuJykuZmlsdGVyKEJvb2xlYW4pO1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdpdENvbW1pdChjd2QsY29tbWl0TWVzc2FnZSkge1xuICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXhlYyhgZ2l0IGNvbW1pdCAtbSBcIiR7Y29tbWl0TWVzc2FnZX1cImAsIHsgY3dkIH0pO1xuICByZXR1cm4gc3Rkb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2l0VGFnKGN3ZCx0YWcpIHtcbiAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4ZWMoYGdpdCB0YWcgXCIke3RhZ31cImAsIHsgY3dkIH0pO1xuICByZXR1cm4gc3Rkb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG59XG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2l0UHVzaChjd2QscmVtb3RlLGJyYW5jaCkge1xuICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXhlYyhgZ2l0IHB1c2ggXCIke3JlbW90ZX1cIiBcIiR7YnJhbmNofVwiIC0tdGFnc2AsIHsgY3dkIH0pO1xuICByZXR1cm4gc3Rkb3V0LnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG59IiwiXG5pbXBvcnQgUmVhY3QsIHt1c2VFZmZlY3QsIHVzZVJlZiwgdXNlU3RhdGV9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHtcbiAgICBMaXN0RWxlbWVudCBhcyBsaXN0LFxuICAgIEJveEVsZW1lbnQgYXMgYm94LFxuICAgIEJ1dHRvbkVsZW1lbnQgYXMgYnV0dG9uLFxuICAgIFRleHRhcmVhRWxlbWVudCBhcyB0ZXh0YXJlYSxcbiAgICBUZXh0RWxlbWVudCBhcyB0ZXh0XG59IGZyb20gJ3JlYWN0LWJsZXNzZWQnO1xuaW1wb3J0IHtTaW1wbGVUZXh0RWRpdG9yfSBmcm9tIFwiLi9TaW1wbGVUZXh0RWRpdG9yLmpzXCI7XG5pbXBvcnQge3NhZmVTdHJpbmdpZnl9IGZyb20gXCIuL3V0aWxcIjtcbmNvbnN0IGRlZmF1bHRUZXh0PVwiLi4uXCJcbiAgICAuc3BsaXQoXCIsXCIpLmpvaW4oXCJcXG5cIilcbmV4cG9ydCBmdW5jdGlvbiBTaW1wbGVUZXh0RWRpdG9yQ29tcG9uZW50KHtpbml0aWFsVGV4dCwgb25DaGFuZ2UsLi4uYm94UHJvcHN9KSB7XG4gICAgY29uc3QgYm94UmVmID0gdXNlUmVmKG51bGwpO1xuICAgIGNvbnN0IFtlZGl0b3IsIHNldEVkaXRvcl0gPSB1c2VTdGF0ZShudWxsKTtcbiAgICBjb25zdCBbbW91c2VDb29yZHMsIHNldE1vdXNlQ29vcmRzXSA9IHVzZVN0YXRlKHt4OjAseTowfSk7XG4gICAgY29uc3QgW3NpemUsIHNldFNpemVdICAgICA9IHVzZVN0YXRlKHsgcm93czogMTAsIGNvbHM6IDMwIH0pO1xuICAgIGxldCBjaGFuZ2VkVGltZW91dD0wXG4gICAgdXNlRWZmZWN0KCgpPT57XG4gICAgICAgIGxldCBuZXdFZGl0b3I9ZWRpdG9yXG4gICAgICAgIGlmKCFuZXdFZGl0b3Ipe1xuICAgICAgICAgICAgbmV3RWRpdG9yID0gbmV3IFNpbXBsZVRleHRFZGl0b3IoaW5pdGlhbFRleHR8fGRlZmF1bHRUZXh0KVxuICAgICAgICB9XG4gICAgICAgIGlmKChpbml0aWFsVGV4dHx8ZGVmYXVsdFRleHQpLnN1YnN0cmluZyhuZXdFZGl0b3IuY3Vyc29ySW5kZXgpIT09bmV3RWRpdG9yLmJ1ZmZlci5zdWJzdHJpbmcobmV3RWRpdG9yLmN1cnNvckluZGV4KSl7XG4gICAgICAgICAgICBuZXdFZGl0b3IuY3Vyc29ySW5kZXggPSAwXG4gICAgICAgICAgICBuZXdFZGl0b3Iuc2xpZGVWaWV3cG9ydFRvQ3Vyc29yKClcbiAgICAgICAgfVxuICAgICAgICBuZXdFZGl0b3IuYnVmZmVyPWluaXRpYWxUZXh0fHxkZWZhdWx0VGV4dFxuICAgICAgICBuZXdFZGl0b3Iudmlld3BvcnRIZWlnaHQgPSBzaXplLnJvd3MtMTtcbiAgICAgICAgbmV3RWRpdG9yLnZpZXdwb3J0V2lkdGggPSBzaXplLmNvbHM7XG4gICAgICAgIHNldEVkaXRvcihuZXdFZGl0b3IuY29weSgpKVxuICAgIH0sW2luaXRpYWxUZXh0XSlcblxuICAgIC8vIDIpIHVwZGF0ZSBzaXplIG9uIHJlc2l6ZVxuICAgIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgICAgIGNvbnN0IGJveCA9IGJveFJlZi5jdXJyZW50O1xuICAgICAgICBpZiAoIWJveCkgcmV0dXJuO1xuICAgICAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XG4gICAgICAgICAgICBzZXRTaXplKHsgY29sczogYm94LndpZHRoLCByb3dzOiBib3guaGVpZ2h0LTIgfSk7XG4gICAgICAgIH07XG4gICAgICAgIHVwZGF0ZSgpO1xuICAgICAgICBib3gub24oJ3Jlc2l6ZScsIHVwZGF0ZSk7XG4gICAgICAgIHJldHVybiAoKSA9PiBib3gucmVtb3ZlTGlzdGVuZXIoJ3Jlc2l6ZScsIHVwZGF0ZSk7XG4gICAgfSwgW10pO1xuICAgIC8vICQlXiYqKClcbiAgICBpZigxID09PSAxICYmIDI9PTMzKXt9XG4gICAgLy8gcnVuIG9uY2Ugb24gc2l6ZSBjaGFuZ2VcbiAgICB1c2VFZmZlY3QoKCk9PntcbiAgICAgICAgaWYoZWRpdG9yKXtcbiAgICAgICAgICAgIGVkaXRvci52aWV3cG9ydFdpZHRoID0gc2l6ZS5jb2xzO1xuICAgICAgICAgICAgZWRpdG9yLnZpZXdwb3J0SGVpZ2h0ID0gc2l6ZS5yb3dzO1xuICAgICAgICAgICAgc2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpXG4gICAgICAgIH1cbiAgICB9LCBbc2l6ZV0pO1xuXG4gICAgY29uc3QgaW50ZXJuYWxPbktleVByZXNzPShjaCxrZXkpPT57XG4gICAgICAgIGVkaXRvci5vbktleShjaCxrZXkpXG4gICAgICAgIGNsZWFyVGltZW91dChjaGFuZ2VkVGltZW91dClcbiAgICAgICAgY2hhbmdlZFRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpPT57XG4gICAgICAgICAgICBvbkNoYW5nZShlZGl0b3IpXG4gICAgICAgICAgICBzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSlcbiAgICAgICAgfSw4MClcbiAgICB9XG4gICAgY29uc3Qgc2V0Q3Vyc29yUG9zaXRpb24gPSAoc2NyZWVuRXZlbnQpID0+IHtcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qge3hpLHlpfSA9IGJveFJlZi5jdXJyZW50Lmxwb3M7XG4gICAgICAgIGNvbnN0IHt4LHl9ID0gc2NyZWVuRXZlbnQ7XG4gICAgICAgIGVkaXRvci5zZXRDdXJzb3IoeC14aS0xK2VkaXRvci52aWV3cG9ydFgseS15aS0xK2VkaXRvci52aWV3cG9ydFkpXG4gICAgICAgIHNldEVkaXRvcihlZGl0b3IuY29weSgpKVxuICAgIH07XG4gICAgY29uc3QgbW91c2VBY3Rpb249KGV2ZW50KSA9PntcbiAgICAgICAgY29uc3Qge3gseX0gPSBldmVudFxuXG4gICAgICAgIC8vIHN3aXRjaChldmVudC5hY3Rpb24pe1xuICAgICAgICAvLyAgICAgY2FzZSAnbW91c2Vtb3ZlJzpicmVhaztcbiAgICAgICAgLy8gICAgIGNhc2UgJ21vdXNlZG93bic6YnJlYWs7XG4gICAgICAgIC8vICAgICBjYXNlICdtb3VzZXVwJzpicmVhaztcbiAgICAgICAgLy8gICAgIGNhc2UgJ3doZWVsdXAnOmVkaXRvci5tb3ZlQ3Vyc29yVXAoKS5zbGlkZVZpZXdwb3J0VG9DdXJzb3IoKTtzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSk7YnJlYWs7XG4gICAgICAgIC8vICAgICBjYXNlICd3aGVlbGRvd24nOmVkaXRvci5tb3ZlQ3Vyc29yRG93bigpLnNsaWRlVmlld3BvcnRUb0N1cnNvcigpO3NldEVkaXRvcihlZGl0b3IuY29weSgpKTticmVhaztcbiAgICAgICAgLy8gICAgIGRlZmF1bHQ6IHRocm93IG5ldyBFcnJvcihzYWZlU3RyaW5naWZ5KGV2ZW50KSk7IGJyZWFrO1xuICAgICAgICAvLyB9XG4gICAgICAgIC8vIHNldE1vdXNlQ29vcmRzKHt4LHl9KTtcbiAgICB9XG4gICAgY29uc3QgcmVuZGVyTGluZXMgPSAoKSA9PiB7XG4gICAgICAgIGlmKCFlZGl0b3Ipe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHt2aWV3cG9ydFk6dnksdmlld3BvcnRIZWlnaHQ6dmh9ID0gZWRpdG9yXG4gICAgICAgIHJldHVybiBlZGl0b3IucmVuZGVyVG9MaW5lcygpXG4gICAgICAgICAgICAuZmlsdGVyKChsLHkpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gKHkgPj12eSAmJiB5IDw9ICh2eSArIHZoKSk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLm1hcCgobGluZSxpbmRleCk9PntcbiAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICB0b3A9e2luZGV4fSBsZWZ0PXswfSBoZWlnaHQ9ezF9IHdpZHRoPXtsaW5lLmxlbmd0aHx8MX1cbiAgICAgICAgICAgICAgICAgICAgICAgIGtleT17YGNvbW1pdC1lZGl0b3ItbGluZS0ke2luZGV4fWB9XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50PXtsaW5lfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgIH0pXG4gICAgfVxuICAgIGNvbnN0IHJlbmRlckN1cnNvciA9ICgpID0+IHtcbiAgICAgICAgaWYoIWVkaXRvcil7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaSA9IGVkaXRvci5jdXJzb3JJbmRleFxuICAgICAgICBjb25zdCB7eCx5fSA9IGVkaXRvci5jdXJzb3JDb29yZHMoKVxuICAgICAgICBjb25zdCB7Y3Vyc29ySW5kZXg6Y2ksdmlld3BvcnRYOnZ4LHZpZXdwb3J0WTp2eSx2aWV3cG9ydEhlaWdodDp2aCx2aWV3cG9ydFdpZHRoOnZ3fSA9IGVkaXRvcjtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGVkaXRvci5idWZmZXIuc3Vic3RyaW5nKGksaSsxKVxuICAgICAgICByZXR1cm4gKDxib3hcbiAgICAgICAgICAgIGtleT17YGVkaXRvci1jdXJzb3ItJHtEYXRlLm5vdygpfWB9XG4gICAgICAgICAgICB0b3A9e3ktdnl9XG4gICAgICAgICAgICBsZWZ0PXt4LXZ4fVxuICAgICAgICAgICAgd2lkdGg9ezF9IGhlaWdodD17MX1cbiAgICAgICAgICAgIHN0eWxlPXt7aW52ZXJzZTp0cnVlLHVuZGVybGluZTp0cnVlfX1cbiAgICAgICAgICAgIGNvbnRlbnQ9e2NvbnRlbnR9XG4gICAgICAgIC8+KVxuICAgIH1cbiAgICBjb25zdCByZW5kZXJTdGF0dXMgPSAoKSA9PiB7XG4gICAgICAgIGlmKCFlZGl0b3Ipe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHtjdXJzb3JJbmRleDpjaSx2aWV3cG9ydFg6dngsdmlld3BvcnRZOnZ5LHZpZXdwb3J0SGVpZ2h0OnZoLHZpZXdwb3J0V2lkdGg6dnd9ID0gZWRpdG9yO1xuICAgICAgICBjb25zdCB7eDpjeCx5OmN5fSA9IGVkaXRvci5jdXJzb3JDb29yZHMoKVxuICAgICAgICBjb25zdCB7eDpteCx5Om15fSA9IG1vdXNlQ29vcmRzXG4gICAgICAgIGxldCBjdXJzb3JDb250ZW50ID0gZWRpdG9yLmJ1ZmZlci5zdWJzdHJpbmcoY2ksY2krMSlcbiAgICAgICAgbGV0IGNvbnRlbnQ9Y3Vyc29yQ29udGVudFxuICAgICAgICBpZihib3hSZWYuY3VycmVudCAmJiBib3hSZWYuY3VycmVudC5scG9zKSB7XG4gICAgICAgICAgICBjb25zdCB7eGkseWl9ID0gYm94UmVmLmN1cnJlbnQubHBvcztcbiAgICAgICAgICAgIGNvbnN0IGZlZWRiYWNrPXtcbiAgICAgICAgICAgICAgICBDOmAke2N4fSwke2N5fSxbJHtjaX1dPSR7Y3Vyc29yQ29udGVudH1gLFxuICAgICAgICAgICAgICAgIEI6YCR7eGl9LCR7eWl9YCxcbiAgICAgICAgICAgICAgICBWOmAke3Z4fSwke3Z5fSwke3Z3fSwke3ZofWAsXG4gICAgICAgICAgICAgICAgTTpgQSR7bXh9LCR7bXl9UiR7bXgteGktMX0sJHtteS15aS0xfWBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnRlbnQgPSBzYWZlU3RyaW5naWZ5KGZlZWRiYWNrKS5yZXBsYWNlKC9be30gXCJdL2dpLCcnKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiAoPGJveFxuICAgICAgICAgICAga2V5PXtgZWRpdG9yLXN0YXR1cy0ke0RhdGUubm93KCl9YH1cbiAgICAgICAgICAgIHRvcD17N31cbiAgICAgICAgICAgIGxlZnQ9ezJ9XG4gICAgICAgICAgICB3aWR0aD17Y29udGVudC5sZW5ndGh9IGhlaWdodD17MX1cbiAgICAgICAgICAgIHN0eWxlPXt7aW52ZXJzZTp0cnVlLHVuZGVybGluZTp0cnVlfX1cbiAgICAgICAgICAgIGNvbnRlbnQ9e2NvbnRlbnR9XG4gICAgICAgIC8+KVxuICAgIH1cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94XG4gICAgICAgICAgICByZWY9e2JveFJlZn1cbiAgICAgICAgICAgIHsuLi5ib3hQcm9wc31cbiAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICBpbnB1dFxuICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICBmb2N1c2VkXG4gICAgICAgICAgICBib3JkZXI9e3sgdHlwZTogJ2xpbmUnIH19XG4gICAgICAgICAgICBzdHlsZT17eyBib3JkZXI6IHsgZmc6ICdjeWFuJyB9IH19XG4gICAgICAgICAgICB0YWdzPXtmYWxzZX0gICAgICAgICAgIC8vIHJhdyBBTlNJXG4gICAgICAgICAgICBzY3JvbGxhYmxlPXtmYWxzZX1cbiAgICAgICAgICAgIG9uS2V5cHJlc3M9e2ludGVybmFsT25LZXlQcmVzc31cbiAgICAgICAgICAgIG9uQ2xpY2s9e3NldEN1cnNvclBvc2l0aW9ufVxuICAgICAgICAgICAgb25Nb3VzZT17bW91c2VBY3Rpb259XG4gICAgICAgID5cbiAgICAgICAgICAgIHsvKmxhYmVsID0ge2Ake2JveFByb3BzLmxhYmVsIHx8ICdFZGl0aW5nJ30gJHtKU09OLnN0cmluZ2lmeShlZGl0b3IuY3Vyc29yQ29vcmRzKCkpfSAke2VkaXRvci5jdXJzb3JJbmRleH1gfSovfVxuICAgICAgICAgICAge3JlbmRlckxpbmVzKCl9XG4gICAgICAgICAgICB7cmVuZGVyQ3Vyc29yKCl9XG4gICAgICAgICAgICB7cmVuZGVyU3RhdHVzKCl9XG4gICAgICAgIDwvYm94Pilcbn0iLCJpbXBvcnQge3ZlcnNpb259IGZyb20gXCJ2aXRlXCI7XG5cbmV4cG9ydCBjbGFzcyBTZW12ZXIge1xuICAgIG1ham9yID0gMFxuICAgIG1pbm9yID0gMFxuICAgIHBhdGNoID0gMFxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdlxuICAgICAqIEByZXR1cm4ge1NlbXZlcn1cbiAgICAgKi9cbiAgICBzdGF0aWMgZnJvbSh2KXtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IFttYWpvciwgbWlub3IsIHBhdGNoXSA9ICh2IHx8ICcwLjAuMCcpLnNwbGl0KCcuJylcbiAgICAgICAgICAgIHJldHVybiBuZXcgU2VtdmVyKG1ham9yLCBtaW5vciwgcGF0Y2gpXG4gICAgICAgIH1jYXRjaChlKXtcbiAgICAgICAgICAgIGNvbnN0IFttYWpvciwgbWlub3IsIHBhdGNoXSA9ICcwLjAuMCcuc3BsaXQoJy4nKVxuICAgICAgICAgICAgcmV0dXJuIG5ldyBTZW12ZXIobWFqb3IsIG1pbm9yLCBwYXRjaClcbiAgICAgICAgfVxuICAgIH1cbiAgICBjb25zdHJ1Y3RvcihtYWpvcixtaW5vcixwYXRjaCkge1xuICAgICAgICB0aGlzLm1ham9yID0gbWFqb3JcbiAgICAgICAgdGhpcy5taW5vciA9IG1pbm9yXG4gICAgICAgIHRoaXMucGF0Y2ggPSBwYXRjaFxuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybiB7U2VtdmVyfVxuICAgICAqL1xuICAgIG5leHRNYWpvcigpe1xuICAgICAgICByZXR1cm4gbmV3IFNlbXZlcigocGFyc2VJbnQodGhpcy5tYWpvcikrMSkudG9TdHJpbmcoKSwgXCIwXCIsXCIwXCIpXG4gICAgfVxuICAgIHByZXZNYWpvcigpe1xuICAgICAgICBsZXQgdiA9IHBhcnNlSW50KHRoaXMubWFqb3IpXG4gICAgICAgIHY9dj4wP3YtMTp2XG4gICAgICAgIHJldHVybiBuZXcgU2VtdmVyKHYudG9TdHJpbmcoKSwgXCIwXCIsXCIwXCIpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTZW12ZXJ9XG4gICAgICovXG4gICAgbmV4dE1pbm9yKCl7XG4gICAgICAgIHJldHVybiBuZXcgU2VtdmVyKHRoaXMubWFqb3IsKHBhcnNlSW50KHRoaXMubWlub3IpKzEpLnRvU3RyaW5nKCksIFwiMFwiKVxuICAgIH1cbiAgICBwcmV2TWlub3IoKXtcbiAgICAgICAgbGV0IHYgPSBwYXJzZUludCh0aGlzLm1pbm9yKVxuICAgICAgICB2PXY+MD92LTE6dlxuICAgICAgICByZXR1cm4gbmV3IFNlbXZlcih0aGlzLm1ham9yLHYudG9TdHJpbmcoKSwgXCIwXCIpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtTZW12ZXJ9XG4gICAgICovXG4gICAgbmV4dFBhdGNoKCl7XG4gICAgICAgIHJldHVybiBuZXcgU2VtdmVyKHRoaXMubWFqb3IsdGhpcy5taW5vciwgKHBhcnNlSW50KHRoaXMucGF0Y2gpKzEpLnRvU3RyaW5nKCkpXG4gICAgfVxuICAgIHByZXZQYXRjaCgpe1xuICAgICAgICBsZXQgdiA9IHBhcnNlSW50KHRoaXMucGF0Y2gpXG4gICAgICAgIHY9dj4wP3YtMTp2XG4gICAgICAgIHJldHVybiBuZXcgU2VtdmVyKHRoaXMubWFqb3IsdGhpcy5taW5vciwgdi50b1N0cmluZygpKVxuICAgIH1cblxuXG4gICAgdG9TdHJpbmcoKXtcbiAgICAgICAgcmV0dXJuIGAke3RoaXMubWFqb3J9LiR7dGhpcy5taW5vcn0uJHt0aGlzLnBhdGNofWBcbiAgICB9XG4gICAgY29weSgpe1xuICAgICAgICByZXR1cm4gbmV3IFNlbXZlcih0aGlzLm1ham9yLHRoaXMubWlub3IsIHRoaXMucGF0Y2gpXG4gICAgfVxufSIsImltcG9ydCBSZWFjdCwge0NvbXBvbmVudCwgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlfSBmcm9tICdyZWFjdCc7XG5pbXBvcnQge1xuICAgIExpc3RFbGVtZW50IGFzIGxpc3QsXG4gICAgQm94RWxlbWVudCBhcyBib3gsXG4gICAgQnV0dG9uRWxlbWVudCBhcyBidXR0b24sXG4gICAgVGV4dGFyZWFFbGVtZW50IGFzIHRleHRhcmVhLFxuICAgIFRleHRFbGVtZW50IGFzIHRleHRcbn0gZnJvbSAncmVhY3QtYmxlc3NlZCc7XG5pbXBvcnQge1NlbXZlcn0gZnJvbSBcIi4vU2VtdmVyLmpzXCI7XG5cbi8vIGNvbW1lbnQgXG5leHBvcnQgZnVuY3Rpb24gU2VtdmVyQ29udHJvbCh7aW5pdGlhbCxvbkNoYW5nZSwuLi5ib3hQcm9wc30pe1xuICAgIGNvbnN0IFtzZW12ZXIsIHNldFNlbXZlcl0gPSB1c2VTdGF0ZShTZW12ZXIuZnJvbShpbml0aWFsKSk7XG4gICAgdXNlRWZmZWN0KCgpPT57XG4gICAgICAgIHNldFNlbXZlcihTZW12ZXIuZnJvbShpbml0aWFsKSk7XG4gICAgfSxbaW5pdGlhbF0pXG4gICAgY29uc3QgZGVjTWFqb3I9KCk9PntcbiAgICAgICAgY29uc3QgbmV3U2VtdmVyPXNlbXZlci5wcmV2TWFqb3IoKVxuICAgICAgICBvbkNoYW5nZShuZXdTZW12ZXIpXG4gICAgICAgIHNldFNlbXZlcihuZXdTZW12ZXIpXG4gICAgfVxuICAgIGNvbnN0IGluY01ham9yPSgpPT57XG4gICAgICAgIGNvbnN0IG5ld1NlbXZlcj1zZW12ZXIubmV4dE1ham9yKClcbiAgICAgICAgb25DaGFuZ2UobmV3U2VtdmVyKVxuICAgICAgICBzZXRTZW12ZXIobmV3U2VtdmVyKVxuICAgIH1cbiAgICBjb25zdCBkZWNNaW5vcj0oKT0+e1xuICAgICAgICBjb25zdCBuZXdTZW12ZXI9c2VtdmVyLnByZXZNaW5vcigpXG4gICAgICAgIG9uQ2hhbmdlKG5ld1NlbXZlcilcbiAgICAgICAgc2V0U2VtdmVyKG5ld1NlbXZlcilcbiAgICB9XG4gICAgY29uc3QgaW5jTWlub3I9KCk9PntcbiAgICAgICAgY29uc3QgbmV3U2VtdmVyPXNlbXZlci5uZXh0TWlub3IoKVxuICAgICAgICBvbkNoYW5nZShuZXdTZW12ZXIpXG4gICAgICAgIHNldFNlbXZlcihuZXdTZW12ZXIpXG4gICAgfVxuICAgIGNvbnN0IGRlY1BhdGNoPSgpPT57XG4gICAgICAgIGNvbnN0IG5ld1NlbXZlcj1zZW12ZXIucHJldlBhdGNoKClcbiAgICAgICAgb25DaGFuZ2UobmV3U2VtdmVyKVxuICAgICAgICBzZXRTZW12ZXIobmV3U2VtdmVyKVxuICAgIH1cbiAgICBjb25zdCBpbmNQYXRjaD0oKT0+e1xuICAgICAgICBjb25zdCBuZXdTZW12ZXI9c2VtdmVyLm5leHRQYXRjaCgpXG4gICAgICAgIG9uQ2hhbmdlKG5ld1NlbXZlcilcbiAgICAgICAgc2V0U2VtdmVyKG5ld1NlbXZlcilcbiAgICB9XG4gICAgcmV0dXJuICg8Ym94IHsuLi5ib3hQcm9wc30+XG4gICAgICAgIDxib3ggbW91c2UgZm9jdXNlZCBjbGlja2FibGUgb25DbGljaz17ZGVjTWFqb3J9IGhlaWdodD17MX1cbiAgICAgICAgICAgICBsZWZ0PXsxfVxuICAgICAgICAgICAgIHdpZHRoPXsxfVxuICAgICAgICAgICAgIGNvbnRlbnQ9eyd2J30vPlxuICAgICAgICA8Ym94IG1vdXNlIGZvY3VzZWQgY2xpY2thYmxlIG9uQ2xpY2s9e2luY01ham9yfSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgbGVmdD17Mn1cbiAgICAgICAgICAgICB3aWR0aD17c2VtdmVyLm1ham9yLmxlbmd0aH1cbiAgICAgICAgICAgICBjb250ZW50PXtzZW12ZXIubWFqb3J9Lz5cbiAgICAgICAgPGJveCBtb3VzZSBmb2N1c2VkIGNsaWNrYWJsZSBvbkNsaWNrPXtkZWNNaW5vcn0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgIGxlZnQ9ezIrc2VtdmVyLm1ham9yLmxlbmd0aH1cbiAgICAgICAgICAgICB3aWR0aD17MX1cbiAgICAgICAgICAgICBjb250ZW50PXsnLid9Lz5cbiAgICAgICAgPGJveCBtb3VzZSBmb2N1c2VkIGNsaWNrYWJsZSBvbkNsaWNrPXtpbmNNaW5vcn0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgIGxlZnQ9ezMrc2VtdmVyLm1ham9yLmxlbmd0aH1cbiAgICAgICAgICAgICB3aWR0aD17c2VtdmVyLm1pbm9yLmxlbmd0aH1cbiAgICAgICAgICAgICBjb250ZW50PXtzZW12ZXIubWlub3J9Lz5cbiAgICAgICAgPGJveCBtb3VzZSBmb2N1c2VkIGNsaWNrYWJsZSBvbkNsaWNrPXtkZWNQYXRjaH0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgIGxlZnQ9ezMrc2VtdmVyLm1ham9yLmxlbmd0aCtzZW12ZXIubWlub3IubGVuZ3RofVxuICAgICAgICAgICAgIHdpZHRoPXsxfVxuICAgICAgICAgICAgIGNvbnRlbnQ9eycuJ30vPlxuICAgICAgICA8Ym94IG1vdXNlIGZvY3VzZWQgY2xpY2thYmxlIG9uQ2xpY2s9e2luY1BhdGNofSBoZWlnaHQ9ezF9XG4gICAgICAgICAgICAgbGVmdD17NCtzZW12ZXIubWFqb3IubGVuZ3RoK3NlbXZlci5taW5vci5sZW5ndGh9XG4gICAgICAgICAgICAgd2lkdGg9e3NlbXZlci5wYXRjaC5sZW5ndGh9XG4gICAgICAgICAgICAgY29udGVudD17c2VtdmVyLnBhdGNofS8+XG4gICAgPC9ib3g+KVxufSIsIi8vIGNvbXBvbmVudHMvR2l0UGFuZWwuanNcbmltcG9ydCBSZWFjdCwge0NvbXBvbmVudCwgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlfSBmcm9tICdyZWFjdCc7XG5pbXBvcnQge1xuICAgIExpc3RFbGVtZW50IGFzIGxpc3QsXG4gICAgVGFibGVFbGVtZW50IGFzIHRhYmxlLFxuICAgIEJveEVsZW1lbnQgYXMgYm94LFxuICAgIEJ1dHRvbkVsZW1lbnQgYXMgYnV0dG9uLFxuICAgIFRleHRhcmVhRWxlbWVudCBhcyB0ZXh0YXJlYSxcbiAgICBUZXh0RWxlbWVudCBhcyB0ZXh0XG59IGZyb20gJ3JlYWN0LWJsZXNzZWQnO1xuaW1wb3J0IHtXb3Jrc3BhY2V9IGZyb20gXCIuL1dvcmtzcGFjZVwiO1xuaW1wb3J0IHtnZXRTdGF0dXMsZ2V0Q29tbWl0cyxnZXRCcmFuY2gsZ2V0Q3VycmVudFRhZyxnZXRSZW1vdGVzLGdldFRhZ3MsZ2l0U3RhZ2UsZ2l0VW5zdGFnZSxnaXRDb21taXQsZ2l0VGFnLGdpdFB1c2h9IGZyb20gXCIuL0dpdENvbXBvbmVudC5zZXJ2aWNlXCI7XG5pbXBvcnQgTW9kYWxEaWFsb2cgZnJvbSBcIi4vTW9kYWxEaWFsb2dcIjtcbmltcG9ydCB7U2ltcGxlVGV4dEVkaXRvckNvbXBvbmVudH0gZnJvbSBcIi4vU2ltcGxlVGV4dEVkaXRvci5qc3hcIjtcbmltcG9ydCB7U2VtdmVyQ29udHJvbH0gZnJvbSBcIi4vU2VtdmVyLmpzeFwiO1xuaW1wb3J0IHtzYWZlU3RyaW5naWZ5fSBmcm9tIFwiLi91dGlsXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBHaXRDb21wb25lbnQoe1xuICAgICAgICByb290RGlyLFxuICAgICAgICBvbkZpbGVTZWxlY3QgLFxuICAgICAgICAuLi5ib3hQcm9wc1xuICAgIH0pIHtcbiAgICBjb25zdCBbbWVzc2FnZSwgc2V0TWVzc2FnZV0gPSB1c2VTdGF0ZShmYWxzZSk7XG4gICAgY29uc3QgW2dpdFN0YXR1cywgc2V0R2l0U3RhdHVzXSA9IHVzZVN0YXRlKFtdKTtcbiAgICBjb25zdCBbZ2l0Q29tbWl0cywgc2V0R2l0Q29tbWl0c10gPSB1c2VTdGF0ZShbXSk7XG4gICAgY29uc3QgW2dpdEJyYW5jaCwgc2V0R2l0QnJhbmNoXSA9IHVzZVN0YXRlKFwiXCIpO1xuICAgIGNvbnN0IFtnaXRDdXJyZW50VGFnLCBzZXRHaXRDdXJyZW50VGFnXSA9IHVzZVN0YXRlKFwiXCIpO1xuICAgIGNvbnN0IFtnaXRUYWdzLCBzZXRHaXRUYWdzXSA9IHVzZVN0YXRlKFtdKTtcbiAgICBjb25zdCBbZ2l0UmVtb3Rlcywgc2V0R2l0UmVtb3Rlc10gPSB1c2VTdGF0ZShbXSk7XG4gICAgY29uc3QgW2NvbW1pdE1lc3NhZ2UsIHNldENvbW1pdE1lc3NhZ2VdID0gdXNlU3RhdGUobnVsbCk7XG4gICAgY29uc3QgW21vdXNlQ29vcmRzLCBzZXRNb3VzZUNvb3Jkc10gPSB1c2VTdGF0ZSh7eDowLHk6MH0pO1xuXG4gICAgY29uc3Qgc29ydEZpbGVzRm4gPSAoYSxiKSA9PiBhLnN1YnN0cmluZygzKT5iLnN1YnN0cmluZygzKT8xOihhLnN1YnN0cmluZygzKT09PWIuc3Vic3RyaW5nKDMpPzA6LTEpXG4gICAgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaEFsbCgpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICAgICAgZ2V0U3RhdHVzKHJvb3REaXIpLFxuICAgICAgICAgICAgZ2V0Q29tbWl0cyhyb290RGlyKSxcbiAgICAgICAgICAgIGdldEJyYW5jaChyb290RGlyKSxcbiAgICAgICAgICAgIGdldEN1cnJlbnRUYWcocm9vdERpciksXG4gICAgICAgICAgICBnZXRSZW1vdGVzKHJvb3REaXIpLFxuICAgICAgICAgICAgZ2V0VGFncyhyb290RGlyKSxcbiAgICAgICAgXSlcbiAgICAgICAgc2V0R2l0U3RhdHVzKEFycmF5LmZyb20ocmVzdWx0WzBdKS50b1NvcnRlZChzb3J0RmlsZXNGbikpXG4gICAgICAgIHNldEdpdENvbW1pdHMocmVzdWx0WzFdKVxuICAgICAgICBzZXRHaXRCcmFuY2gocmVzdWx0WzJdKVxuICAgICAgICBzZXRHaXRDdXJyZW50VGFnKHJlc3VsdFszXSlcbiAgICAgICAgc2V0R2l0UmVtb3RlcyhBcnJheS5mcm9tKHJlc3VsdFs0XSkubWFwKHYgPT57XG4gICAgICAgICAgICBjb25zdCB0ayA9IHYuc3BsaXQoL1xccysvZ2kpXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIG5hbWU6IHRrWzBdLFxuICAgICAgICAgICAgICAgIHVybDogdGtbMV0sXG4gICAgICAgICAgICAgICAga2luZDogdGtbMl0sXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pKVxuICAgICAgICBzZXRHaXRUYWdzKHJlc3VsdFs1XSlcbiAgICB9XG4gICAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICAgICAgcmVmcmVzaEFsbCgpXG4gICAgfSwgW10pO1xuICAgIGNvbnN0IG9uRmlsZVBhdGhTZWxlY3QgPSAoZXZlbnQpID0+IHtcbiAgICAgICAgY29uc3Qgc3RhZ2VkID0gZXZlbnQuY29udGVudC5zdWJzdHJpbmcoMCwxKVxuICAgICAgICBjb25zdCBjaGFuZ2VkID0gZXZlbnQuY29udGVudC5zdWJzdHJpbmcoMSwyKVxuICAgICAgICBjb25zdCB7eCx5fSA9IG1vdXNlQ29vcmRzXG5cbiAgICAgICAgY29uc3QgZmlsZSA9IGV2ZW50LmNvbnRlbnQuc3Vic3RyaW5nKDMpO1xuICAgICAgICBpZiAoc3RhZ2VkID09PSAnICcgfHwgc3RhZ2VkID09PSAnPycgfHwgKGNoYW5nZWQgIT09ICcgJyAmJiBzdGFnZWQgPT09IGNoYW5nZWQpKSB7XG4gICAgICAgICAgICAvLyBzZXRNZXNzYWdlKGBnaXQgc3RhZ2UgXCIke2ZpbGV9XCJgKVxuICAgICAgICAgICAgZ2l0U3RhZ2Uocm9vdERpciwgZmlsZSkudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgICAgIC8vIHNldE1lc3NhZ2UoYGdpdCBzdGFnZWQgXCIke2ZpbGV9ICgke3Jlc3VsdH0pXCJgKVxuICAgICAgICAgICAgICAgIHJldHVybiBnZXRTdGF0dXMocm9vdERpcilcbiAgICAgICAgICAgIH0pLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgICAgICBzZXRHaXRTdGF0dXMocmVzdWx0LnRvU29ydGVkKHNvcnRGaWxlc0ZuKSlcbiAgICAgICAgICAgIH0pLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICAgICAgICBzZXRNZXNzYWdlKGBnaXQgc3RhZ2UgXCIke2ZpbGV9IGVycm9yICgke2Vycm9yfSlcImApXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfWVsc2UgaWYgKGNoYW5nZWQgPT09ICcgJyB8fCBjaGFuZ2VkID09PSAnPycpIHtcbiAgICAgICAgICAgIC8vIHNldE1lc3NhZ2UoYGdpdCB1bnN0YWdlIFwiJHtmaWxlfVwiYClcbiAgICAgICAgICAgIGdpdFVuc3RhZ2Uocm9vdERpciwgZmlsZSkudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgICAgIC8vIHNldE1lc3NhZ2UoYGdpdCB1bnN0YWdlZCBcIiR7ZmlsZX0gKCR7cmVzdWx0fSlcImApXG4gICAgICAgICAgICAgICAgcmV0dXJuIGdldFN0YXR1cyhyb290RGlyKVxuICAgICAgICAgICAgfSkudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgICAgIHNldEdpdFN0YXR1cyhyZXN1bHQudG9Tb3J0ZWQoc29ydEZpbGVzRm4pKVxuICAgICAgICAgICAgfSkuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgICAgICAgIHNldE1lc3NhZ2UoYGdpdCB1bnN0YWdlZCBcIiR7ZmlsZX0gZXJyb3IgKCR7ZXJyb3J9KVwiYClcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIC8vIHNldE1lc3NhZ2UoYG1vdXNlIEAgJHt4fSwke3l9YClcbiAgICB9O1xuICAgIGNvbnN0IG9uQ29tbWl0U2VsZWN0ID0gKGV2ZW50KSA9PiB7XG4gICAgICAgIC8vIHNldE1lc3NhZ2UoYGNvbW1pdCBzZWxlY3RlZCAke2V2ZW50LmNvbnRlbnR9ICR7cHJvY2Vzcy5jd2QoKX1gKVxuICAgICAgICBjb25zdCB0YWc9ZXZlbnQuY29udGVudC5zdWJzdHJpbmcoOSwxOCkudHJpbSgpXG4gICAgICAgIGNvbnN0IG1zZz1ldmVudC5jb250ZW50LnN1YnN0cmluZygxOSlcbiAgICAgICAgc2V0Q29tbWl0TWVzc2FnZShtc2cpXG5cbiAgICAgICAgaWYodGFnLmxlbmd0aD49NSkge1xuICAgICAgICAgICAgc2V0R2l0Q3VycmVudFRhZyh0YWcpXG4gICAgICAgIH1cbiAgICB9O1xuICAgIGNvbnN0IGNvbW1pdFN0YWdlZEZpbGVzID0gKGV2ZW50KSA9PiB7XG4gICAgICAgIGlmKGNvbW1pdE1lc3NhZ2UudHJpbSgpID09PSBcIlwiKXtcbiAgICAgICAgICAgIHNldE1lc3NhZ2UoYGNvbW1pdCBtZXNzYWdlIGNhbm5vdCBiZSBlbXB0eWApXG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgZ2l0Q29tbWl0KHJvb3REaXIsIGNvbW1pdE1lc3NhZ2UpLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVmcmVzaEFsbCgpXG4gICAgICAgICAgICB9KS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgZ2l0IGNvbW1pdCAtbSBcIiR7Y29tbWl0TWVzc2FnZX1cImApXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICAgIC8vIHNldE1lc3NhZ2UoYGNvbW1pdCBzZWxlY3RlZCAke2V2ZW50LmNvbnRlbnR9ICR7cHJvY2Vzcy5jd2QoKX1gKVxuICAgIH07XG4gICAgY29uc3QgdGFnTGFzdENvbW1pdCA9IChldmVudCkgPT4ge1xuICAgICAgICBnaXRUYWcocm9vdERpciwgZ2l0Q3VycmVudFRhZykudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHJlZnJlc2hBbGwoKVxuICAgICAgICB9KS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgICAgICBzZXRNZXNzYWdlKGBnaXQgdGFnIC1tIFwiJHtnaXRDdXJyZW50VGFnfVwiYClcbiAgICAgICAgfSlcbiAgICAgICAgLy8gc2V0TWVzc2FnZShgY29tbWl0IHNlbGVjdGVkICR7ZXZlbnQuY29udGVudH0gJHtwcm9jZXNzLmN3ZCgpfWApXG4gICAgfTtcbiAgICBjb25zdCBwdXNoQ29tbWl0cyA9IChldmVudCkgPT4ge1xuICAgICAgICBzZXRNZXNzYWdlKGBnaXQgcHVzaCBcIiR7Z2l0UmVtb3Rlc1swXS5uYW1lfVwiIFwiJHtnaXRCcmFuY2h9XCJgKVxuICAgICAgICBnaXRQdXNoKHJvb3REaXIsIGdpdFJlbW90ZXNbMF0ubmFtZSxnaXRCcmFuY2gpLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgICAgIHNldE1lc3NhZ2UoYGdpdCBwdXNoIFwiJHtnaXRSZW1vdGVzWzBdLm5hbWV9XCIgXCIke2dpdEJyYW5jaH1cImApXG4gICAgICAgIH0pXG4gICAgICAgIHNldE1lc3NhZ2UoYGNvbW1pdCBzZWxlY3RlZCAke2V2ZW50LmNvbnRlbnR9ICR7cHJvY2Vzcy5jd2QoKX1gKVxuICAgIH07XG4gICAgY29uc3QgY29tbWl0TWVzc2FnZUNoYW5nZWQ9KGJ1ZmZlckVkaXRvcikgPT4ge1xuICAgICAgICBzZXRDb21taXRNZXNzYWdlKGJ1ZmZlckVkaXRvci5idWZmZXIpXG4gICAgfVxuICAgIGNvbnN0IG1vdXNlQWN0aW9uPShldmVudCkgPT57XG4gICAgICAgIGNvbnN0IHt4LHl9ID0gZXZlbnRcblxuICAgICAgICBzd2l0Y2goZXZlbnQuYWN0aW9uKXtcbiAgICAgICAgICAgIGNhc2UgJ21vdXNlbW92ZSc6YnJlYWs7XG4gICAgICAgICAgICBjYXNlICdtb3VzZWRvd24nOmJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnbW91c2V1cCc6YnJlYWs7XG4gICAgICAgICAgICBjYXNlICd3aGVlbHVwJzplZGl0b3IubW92ZUN1cnNvclVwKCkuc2xpZGVWaWV3cG9ydFRvQ3Vyc29yKCk7c2V0RWRpdG9yKGVkaXRvci5jb3B5KCkpO2JyZWFrO1xuICAgICAgICAgICAgY2FzZSAnd2hlZWxkb3duJzplZGl0b3IubW92ZUN1cnNvckRvd24oKS5zbGlkZVZpZXdwb3J0VG9DdXJzb3IoKTtzZXRFZGl0b3IoZWRpdG9yLmNvcHkoKSk7YnJlYWs7XG4gICAgICAgICAgICBkZWZhdWx0OiB0aHJvdyBuZXcgRXJyb3Ioc2FmZVN0cmluZ2lmeShldmVudCkpOyBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBzZXRNb3VzZUNvb3Jkcyh7eCx5fSk7XG4gICAgfVxuICAgIGNvbnN0IHN0YXR1cyA9IGB7Y3lhbi1mZ30keyhnaXRSZW1vdGVzWzBdfHx7fSkubmFtZX17L2N5YW4tZmd9L3tyZWQtZmd9JHtnaXRCcmFuY2h9ey9yZWQtZmd9KHt5ZWxsb3ctZmd9JHtnaXRDdXJyZW50VGFnfXsveWVsbG93LWZnfSlgXG4gICAgY29uc3Qgc3RhdHVzTGVuPWAkeyhnaXRSZW1vdGVzWzBdfHx7fSkubmFtZX0vJHtnaXRCcmFuY2h9KCR7Z2l0Q3VycmVudFRhZ30pYC5sZW5ndGhcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IHsuLi5ib3hQcm9wc30+XG4gICAgICAgICAgICA8Ym94IGxhYmVsPXtgYH0gaGVpZ2h0PXs5fSBib3JkZXI9e3sgdHlwZTogJ2xpbmUnIH19PlxuICAgICAgICAgICAgICAgIDxsaXN0XG4gICAgICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgICAgICAgICAgaW5wdXRcbiAgICAgICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgICAgICAgICAgc2Nyb2xsYmFyPXt7IGNoOiAnPScsIHRyYWNrOiB7IGZnOidibHVlJywgYmc6ICdncmV5JyB9IH19XG4gICAgICAgICAgICAgICAgICAgIGl0ZW1zPXtnaXRTdGF0dXN9XG4gICAgICAgICAgICAgICAgICAgIHN0eWxlPXt7c2VsZWN0ZWQ6IHtiZzogJ2JsdWUnfX19XG4gICAgICAgICAgICAgICAgICAgIG9uU2VsZWN0PXtvbkZpbGVQYXRoU2VsZWN0fVxuICAgICAgICAgICAgICAgICAgICBvblNlbGVjdEl0ZW09e29uRmlsZVBhdGhTZWxlY3R9XG4gICAgICAgICAgICAgICAgICAgIG9uTW91c2U9e21vdXNlQWN0aW9ufVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPGJveCB0b3A9ey0xfSBsZWZ0PXsyNX0gd2lkdGg9ezd9IGhlaWdodD17MX0gY29udGVudD17YHske21vdXNlQ29vcmRzLnh9LCR7bW91c2VDb29yZHMueX19YH0vPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8Ym94IGNvbnRlbnQ9e3N0YXR1c30gdG9wPXswfSBsZWZ0PXszfSB3aWR0aD17c3RhdHVzTGVufSBoZWlnaHQ9ezF9IHRhZ3M9e3RydWV9Lz5cbiAgICAgICAgICAgIDxib3ggY29udGVudD17cm9vdERpcn0gdG9wPXs4fSBsZWZ0PXszfSB3aWR0aD17cm9vdERpci5sZW5ndGh9IGhlaWdodD17MX0vPlxuICAgICAgICAgICAgPFNpbXBsZVRleHRFZGl0b3JDb21wb25lbnRcbiAgICAgICAgICAgICAgICB0b3A9ezl9ICBoZWlnaHQ9ezl9XG4gICAgICAgICAgICAgICAgbGFiZWw9eydNZXNzYWdlJ31cbiAgICAgICAgICAgICAgICBpbml0aWFsVGV4dD17Y29tbWl0TWVzc2FnZX1cbiAgICAgICAgICAgICAgICBib3JkZXI9e3sgdHlwZTogJ2xpbmUnIH19XG4gICAgICAgICAgICAgICAgb25DaGFuZ2U9e2NvbW1pdE1lc3NhZ2VDaGFuZ2VkfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDxTZW12ZXJDb250cm9sXG4gICAgICAgICAgICAgICAgdG9wPXs5fSBsZWZ0PXszMX0gd2lkdGg9ezl9IGhlaWdodD17MX1cbiAgICAgICAgICAgICAgICBpbml0aWFsPXtnaXRDdXJyZW50VGFnfVxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsocykgPT4ge1xuICAgICAgICAgICAgICAgICAgICBzZXRHaXRDdXJyZW50VGFnKHMudG9TdHJpbmcoKSlcbiAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICB0b3A9ezE4fSBsZWZ0PXsnMCUnfSBoZWlnaHQ9ezN9IHdpZHRoPXsnMzAlJ31cbiAgICAgICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgICAgIGtleXNcbiAgICAgICAgICAgICAgICBpbnB1dFxuICAgICAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgICAgIGZvY3VzZWRcbiAgICAgICAgICAgICAgICB2YWxpZ249eydtaWRkbGUnfVxuICAgICAgICAgICAgICAgIGFsaWduPXsnY2VudGVyJ31cbiAgICAgICAgICAgICAgICBzdHlsZT17e2JnOicjZmZhYTAwJyxmZzonIzMzMzMzMycsaG92ZXI6e2JnOicjZmZkZDg4JyxmZzonIzMzMzMzMyd9fX1cbiAgICAgICAgICAgICAgICBvbkNsaWNrPXtjb21taXRTdGFnZWRGaWxlc31cbiAgICAgICAgICAgICAgICBjb250ZW50PXsnXFxuY29tbWl0XFxuJ31cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgdG9wPXsxOH0gbGVmdD17JzM1JSd9IGhlaWdodD17M30gd2lkdGg9eyczMCUnfVxuICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgICAgIHZhbGlnbj17J21pZGRsZSd9XG4gICAgICAgICAgICAgICAgYWxpZ249eydjZW50ZXInfVxuICAgICAgICAgICAgICAgIHN0eWxlPXt7Ymc6JyNmZmFhMDAnLGZnOicjMzMzMzMzJyxob3Zlcjp7Ymc6JyNmZmRkODgnLGZnOicjMzMzMzMzJ319fVxuICAgICAgICAgICAgICAgIG9uQ2xpY2s9e3RhZ0xhc3RDb21taXR9XG4gICAgICAgICAgICAgICAgY29udGVudD17YFxcbnRhZyAke2dpdEN1cnJlbnRUYWd9XFxuYH1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgdG9wPXsxOH0gbGVmdD17JzcwJSd9IGhlaWdodD17M30gd2lkdGg9eyczMCUnfVxuICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgZm9jdXNlZFxuICAgICAgICAgICAgICAgIHZhbGlnbj17J21pZGRsZSd9XG4gICAgICAgICAgICAgICAgYWxpZ249eydjZW50ZXInfVxuICAgICAgICAgICAgICAgIHN0eWxlPXt7Ymc6JyNmZmFhMDAnLGZnOicjMzMzMzMzJyxob3Zlcjp7Ymc6JyNmZmRkODgnLGZnOicjMzMzMzMzJ319fVxuICAgICAgICAgICAgICAgIG9uQ2xpY2s9e3B1c2hDb21taXRzfVxuICAgICAgICAgICAgICAgIGNvbnRlbnQ9eydcXG5wdXNoXFxuJ31cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8Ym94IGxhYmVsPXsnQ29tbWl0cyd9IHRvcD17MjF9IGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX0gb25Nb3VzZT17KGV2ZW50KT0+e1xuICAgICAgICAgICAgICAgIGNvbnN0IHt4LHl9PWV2ZW50O1xuICAgICAgICAgICAgICAgIHNldENvbW1pdE1lc3NhZ2Uoc2FmZVN0cmluZ2lmeSh7eCx5fSkpXG4gICAgICAgICAgICB9fT5cbiAgICAgICAgICAgICAgICA8bGlzdFxuICAgICAgICAgICAgICAgICAgICBtb3VzZVxuICAgICAgICAgICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICAgICAgICAgIGlucHV0XG4gICAgICAgICAgICAgICAgICAgIGNsaWNrYWJsZVxuICAgICAgICAgICAgICAgICAgICBmb2N1c2VkXG4gICAgICAgICAgICAgICAgICAgIHNjcm9sbGJhcj17eyBjaDogJz0nLCB0cmFjazogeyBmZzonYmx1ZScsIGJnOiAnZ3JleScgfSB9fVxuICAgICAgICAgICAgICAgICAgICBpdGVtcz17Z2l0Q29tbWl0c31cbiAgICAgICAgICAgICAgICAgICAgc3R5bGU9e3tzZWxlY3RlZDoge2JnOiAnYmx1ZSd9fX1cbiAgICAgICAgICAgICAgICAgICAgb25TZWxlY3Q9e29uQ29tbWl0U2VsZWN0fVxuICAgICAgICAgICAgICAgICAgICBvblNlbGVjdEl0ZW09e29uQ29tbWl0U2VsZWN0fVxuICAgICAgICAgICAgICAgICAgICBsYWJlbD17J1N0YXR1cyd9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAge21lc3NhZ2UgJiYgKFxuICAgICAgICAgICAgICAgIDxNb2RhbERpYWxvZ1xuICAgICAgICAgICAgICAgICAgICB0aXRsZT1cIk1lc3NhZ2VcIlxuICAgICAgICAgICAgICAgICAgICBvbkNsb3NlPXsoKSA9PiBzZXRNZXNzYWdlKGZhbHNlKX1cbiAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgIDx0ZXh0PnttZXNzYWdlfTwvdGV4dD5cbiAgICAgICAgICAgICAgICA8L01vZGFsRGlhbG9nPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9ib3g+XG4gICAgKTtcbn1cbiIsImltcG9ydCBSZWFjdCBmcm9tICdyZWFjdCdcblxuZXhwb3J0IGZ1bmN0aW9uIEVycm9yRmFsbGJhY2soeyBlcnJvciwgcmVzZXRFcnJvckJvdW5kYXJ5IH0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94XG4gICAgICAgICAgICB0b3A9XCJjZW50ZXJcIlxuICAgICAgICAgICAgbGVmdD1cImNlbnRlclwiXG4gICAgICAgICAgICB3aWR0aD1cIjc1JVwiXG4gICAgICAgICAgICBoZWlnaHQ9XCI3NSVcIlxuICAgICAgICAgICAgYm9yZGVyPXt7IHR5cGU6ICdsaW5lJyB9fVxuICAgICAgICAgICAgc3R5bGU9e3sgZmc6ICdyZWQnIH19XG4gICAgICAgID5cbiAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICByaWdodD17MH0gdG9wPXswfSB3aWR0aD17OX0gaGVpZ2h0PXsxfVxuICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgb25QcmVzcz17cmVzZXRFcnJvckJvdW5kYXJ5fVxuICAgICAgICAgICAgICAgIHZhbGlnbj17J21pZGRsZSd9XG4gICAgICAgICAgICAgICAgYWxpZ249eydjZW50ZXInfVxuICAgICAgICAgICAgICAgIHN0eWxlPXt7Ymc6JyNmZmFhMDAnLGZnOicjMzMzMzMzJyxob3Zlcjp7Ymc6JyNmZmRkODgnLGZnOicjMzMzMzMzJ319fVxuICAgICAgICAgICAgICAgIGNvbnRlbnQ9eydjbG9zZSd9Lz5cbiAgICAgICAgICAgIDxib3ggdG9wPXsyfSBsZWZ0PXswfT57YFNvbWV0aGluZyB3ZW50IHdyb25nOlxcbiR7ZXJyb3IubWVzc2FnZX1cXG4ke2Vycm9yLnN0YWNrfWB9PC9ib3g+XG4gICAgICAgIDwvYm94PlxuICAgIClcbn0iLCIvLyBBcHAuanNcbmltcG9ydCBSZWFjdCwge0NvbXBvbmVudCwgdXNlU3RhdGUsIHVzZUVmZmVjdCwgdXNlUmVmfSBmcm9tICdyZWFjdCc7XG5pbXBvcnQge1dvcmtzcGFjZSxJTm9kZX0gZnJvbSAnLi9Xb3Jrc3BhY2UnO1xuaW1wb3J0IE1vZGFsRGlhbG9nIGZyb20gJy4vTW9kYWxEaWFsb2cuanN4JztcbmltcG9ydCB7IEJveEVsZW1lbnQgYXMgYm94LCBUZXh0RWxlbWVudCBhcyB0ZXh0LExpc3RFbGVtZW50IGFzIGxpc3QsQnV0dG9uRWxlbWVudCBhcyBidXR0b24gfSBmcm9tICdyZWFjdC1ibGVzc2VkJztcbmltcG9ydCB7IEdyaWQsR3JpZEl0ZW0gfSBmcm9tICdyZWFjdC1ibGVzc2VkLWNvbnRyaWItMTcnXG5pbXBvcnQgRm9sZGVyUGlja2VyRGlhbG9nIGZyb20gXCIuL0ZvbGRlclBpY2tlckRpYWxvZ1wiO1xuaW1wb3J0IHtUYWIsIFZUYWJzfSBmcm9tIFwiLi9WVGFic1wiO1xuaW1wb3J0IHtDb2RlQnVmZmVyRWRpdG9yQ29tcG9uZW50fSBmcm9tICcuL0NvZGVCdWZmZXJFZGl0b3IuanN4J1xuaW1wb3J0IHtHaXRDb21wb25lbnR9IGZyb20gXCIuL0dpdENvbXBvbmVudFwiO1xuaW1wb3J0IHsgRXJyb3JCb3VuZGFyeSB9IGZyb20gJ3JlYWN0LWVycm9yLWJvdW5kYXJ5J1xuaW1wb3J0IHtFcnJvckZhbGxiYWNrfSBmcm9tICcuL0Vycm9yRmFsbGJhY2snO1xuaW1wb3J0IEZpbGVUcmVlIGZyb20gXCIuL0ZpbGVUcmVlXCI7XG5pbXBvcnQge0xpc3RDb21wb25lbnR9IGZyb20gXCIuL0xpc3RDb21wb25lbnRcIjtcbmltcG9ydCB7IHNhZmVTdHJpbmdpZnkgfSBmcm9tICcuL3V0aWwuanMnO1xuLy8gaW1wb3J0IHtwYXJzZXJzfSBmcm9tIFwiLi9ncmFtbWFyc1wiO1xuY29uc3QgbGlzdGluZ1Rva2VuaXplckRlZmluaXRpb249e1xuICAgIG5hbWU6J2xpc3RpbmcnLFxuICAgIGZsYWdzOidtZycsXG4gICAgZGVmaW5pdGlvbnM6e1xuICAgICAgICBcIldoaXRlc3BhY2VcIjogICAgIHtzdHlsZToge2ZnOid3aGl0ZSd9LHBhdHRlcm46L1xccysvbWdpfSxcbiAgICAgICAgXCJDbG9zZUJ1dHRvblwiOiAgIHtzdHlsZToge2ZnOidyZWQnfSxwYXR0ZXJuOi9cXFt4XS9tZ2l9LFxuICAgICAgICBcIk5vZGVOYW1lXCI6ICAgICAgIHtzdHlsZToge2ZnOidncmVlbid9LHBhdHRlcm46L1svYS16QS1aMC05Xz17fVxcW1xcXSUqKCltLC46OyE/QH4tXSsvbWdpfSxcbiAgICAgICAgXCJXb3JkXCI6ICAgICAgICAgICB7c3R5bGU6IHtmZzoneWVsbG93J30scGF0dGVybjovXFxzLis/XFxzL21naX0sXG4gICAgfVxufVxuZXhwb3J0IGZ1bmN0aW9uIEFwcChwcm9wcyl7XG4gIC8vIFNvbWUgQ29tZW50XG4gIGNvbnN0IG9wZW5lZEZpbGVzUmVmPXVzZVJlZihudWxsKTtcbiAgY29uc3QgW21lc3NhZ2UsIHNldE1lc3NhZ2VdID0gdXNlU3RhdGUoZmFsc2UpO1xuICBjb25zdCBbcGlja0ZvbGRlciwgc2V0UGlja0ZvbGRlcl0gPSB1c2VTdGF0ZShmYWxzZSk7XG4gIGNvbnN0IFtjdXJyZW50RWRpdG9yVGV4dCwgc2V0Q3VycmVudEVkaXRvclRleHRdID0gdXNlU3RhdGUoJycpO1xuICBjb25zdCBbc2VsZWN0ZWRGaWxlLCBzZXRTZWxlY3RlZEZpbGVdID0gdXNlU3RhdGUobnVsbCk7XG4gIGNvbnN0IFtvcGVuZWRGaWxlcywgc2V0T3BlbmVkRmlsZXNdID0gdXNlU3RhdGUoe30pO1xuICBjb25zdCBbZmlsZUNvbnRlbnQsIHNldEZpbGVDb250ZW50XSAgID0gdXNlU3RhdGUoJycpO1xuICBjb25zdCBbcm9vdERpciwgc2V0Um9vdERpcl0gICA9IHVzZVN0YXRlKHByb2Nlc3MuY3dkKCkpO1xuICBjb25zdCBbZ2l0U3RhdHVzLCBzZXRHaXRTdGF0dXNdID0gdXNlU3RhdGUoW10pO1xuXG5cbiAgY29uc3Qgb25GaWxlUGF0aFNlbGVjdCA9IChldmVudCkgPT4ge1xuICAgIHNldE1lc3NhZ2UoYGZpbGUgcGF0aCBzZWxlY3RlZCAke2V2ZW50LmNvbnRlbnR9ICR7cHJvY2Vzcy5jd2QoKX1gKVxuICB9O1xuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtJTm9kZX0gbm9kZVxuICAgICAqL1xuICBjb25zdCBzZWxlY3RGaWxlID0gKG5vZGUpID0+IHtcbiAgICBzZXRTZWxlY3RlZEZpbGUobm9kZS5mdWxsUGF0aClcbiAgICBjb25zdCBuZXdPcGVuZWRGaWxlcz17Li4ub3BlbmVkRmlsZXN9XG4gICAgbmV3T3BlbmVkRmlsZXNbbm9kZS5mdWxsUGF0aC5yZXBsYWNlKHJvb3REaXIsJycpXSA9IG5vZGVcbiAgICBzZXRPcGVuZWRGaWxlcyhuZXdPcGVuZWRGaWxlcylcbiAgICBzZXRGaWxlQ29udGVudChgTG9hZGluZyAke25vZGUucmVsUGF0aH1gKVxuICAgIG5vZGUucmVhZEZpbGUobm9kZS5mdWxsUGF0aCkudGhlbihzZXRGaWxlQ29udGVudCk7XG4gIH07XG4gIC8qKlxuICAgKlxuICAgKiBAcGFyYW0ge0lOb2RlfSBkaXJcbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBjb25zdCBzZWxlY3REaXIgPSBhc3luYyAoZGlyKSA9PiB7XG4gICAgc2V0TWVzc2FnZShgZGlyIHNlbGVjdGVkICR7T2JqZWN0LmtleXMoZGlyKX1gKVxuICB9O1xuICBjb25zdCBvblRleHRFZGl0b3JTYXZlID0gKGEsYixjKT0+IHtcbiAgICAgIHNldE1lc3NhZ2UoSlNPTi5zdHJpbmdpZnkoe2EsYixjfSkpXG4gIH1cbiAgY29uc3Qgb25UZXh0RWRpdG9yQ2FuY2VsID0gKGEsYixjKT0+IHtcbiAgICAgIHNldE1lc3NhZ2UoSlNPTi5zdHJpbmdpZnkoe2EsYixjfSkpXG4gIH1cbiAgY29uc3Qgb25DdXJyZW50RWRpdG9yQ2hhbmdlID0gKHtlZGl0b3IsY2gsa2V5LHNjcmVlbkV2ZW50LHZpZXdwb3J0fSk9PiB7XG4gICAgc2V0Q3VycmVudEVkaXRvclRleHQoc2FmZVN0cmluZ2lmeSh7ZWRpdG9yOiB7Y3Vyc29yczplZGl0b3IuY3Vyc29yc30sdmlld3BvcnQsY2gsa2V5LHNjcmVlbkV2ZW50fSkpXG4gIH1cbiAgY29uc3Qgb25Db2RlRWRpdEtleVByZXNzID0gKGNoLGtleSk9PiB7XG4gICAgLy8gc2V0Q3VycmVudEVkaXRvclRleHQoSlNPTi5zdHJpbmdpZnkoe2NoLGtleX0pKVxuICB9XG4gIGNvbnN0IGRlYnVnVmlldz0oKT0+e1xuICAgICAgY29uc3QgY29udGVudCA9IGBEZWJ1ZzpcXG4keygncGFyc2VkIHNvbWUgdGV4dCcpfWBcbiAgICAgIHJldHVybiA8Ym94IGNvbnRlbnQ9e2NvbnRlbnR9Lz5cbiAgfVxuICBjb25zdCBsaXN0T3BlbmVkRmlsZXM9KCk9PntcbiAgICAgIGlmKG9wZW5lZEZpbGVzUmVmID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgICAgaWYob3BlbmVkRmlsZXNSZWYuY3VycmVudCA9PT0gbnVsbCkge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxwb3MgPSBvcGVuZWRGaWxlc1JlZi5jdXJyZW50Lmxwb3NcbiAgICAgIHJldHVybiBPYmplY3Qua2V5cyhvcGVuZWRGaWxlcykubWFwKFxuICAgICAgICAgIGsgPT4ge1xuICAgICAgICAgICAgICByZXR1cm4gay5wYWRFbmQobHBvcy53aWR0aC02LCcgJykrJ1t4XSdcbiAgICAgICAgICB9XG4gICAgICApXG4gIH1cblxuICAgIGNvbnN0IG9uVG9rZW5DbGljaz0oZXZlbnREYXRhKT0+e1xuICAgICAgICBjb25zdCB0cmVlRGF0YSA9IGxpc3RPcGVuZWRGaWxlcygpXG4gICAgICAgIGNvbnN0IHtsaW5lcywgdmlzaWJsZUxpbmVzLCBsaW5lLCBjdXJzb3I6e3gseX0sY3Vyc29yU2NyZWVuLCBidWZmZXIsIHZpc2libGVCdWZmZXIsIGluZGV4LHRva2Vucyx0b2tlblVuZGVyQ3Vyc29yLHBocmFzZX0gPSBldmVudERhdGFcblxuICAgICAgICBsZXQgayA9IE9iamVjdC5rZXlzKG9wZW5lZEZpbGVzKVt5XVxuICAgICAgICBsZXQgbm9kZSA9IG9wZW5lZEZpbGVzW2tdO1xuICAgICAgICAvLyB0aHJvdyBKU09OLnN0cmluZ2lmeSh7bm9kZSx5fSxudWxsLCAnICcpXG4gICAgICAgIC8vIGlmIChub2RlLnR5cGUuaW5kZXhPZignZCcpPi0xKSB7XG4gICAgICAgIHN3aXRjaChwaHJhc2UuZmlsdGVyKHYgPT4gdiE9PSdXaGl0ZXNwYWNlJykuam9pbihcIixcIikpe1xuICAgICAgICAgICAgY2FzZSBcIldoaXRlc3BhY2UsTm9kZU5hbWVcIjpcbiAgICAgICAgICAgIGNhc2UgXCJOb2RlTmFtZSxDbG9zZUJ1dHRvblwiOlxuICAgICAgICAgICAgICAgIHN3aXRjaCgodG9rZW5VbmRlckN1cnNvcnx8e3R5cGU6J3VuZGVmaW5lZCd9KS50eXBlKXtcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBcIk5vZGVOYW1lXCI6XG4gICAgICAgICAgICAgICAgICAgICAgICBzZWxlY3RGaWxlKG5vZGUpXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzZXRDdXJzb3JEYXRhKHtjdXJzb3I6e3g6MCx5fSxjdXJzb3JTY3JlZW46e3g6dG9rZW5VbmRlckN1cnNvci5zdGFydCx5OmN1cnNvclNjcmVlbi55fSxjb250ZW50OnRva2VuVW5kZXJDdXJzb3IudGV4dCxzdHlsZTp0b2tlblVuZGVyQ3Vyc29yLnN0eWxlfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBjYXNlIFwiQ2xvc2VCdXR0b25cIjpcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld09wZW5lZEZpbGVzPXsuLi5vcGVuZWRGaWxlc31cbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBuZXdPcGVuZWRGaWxlc1trXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldE9wZW5lZEZpbGVzKG5ld09wZW5lZEZpbGVzKVxuICAgICAgICAgICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgQ2xvc2VcXG4ke25vZGUuZnVsbFBhdGh9IHNlbGVjdGVkRmlsZToke3NlbGVjdGVkRmlsZX0gbm9kZS5mdWxsUGF0aDoke25vZGUuZnVsbFBhdGh9IGApXG4gICAgICAgICAgICAgICAgICAgICAgICBpZihzZWxlY3RlZEZpbGUgPT09IG5vZGUuZnVsbFBhdGgpe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGsgPSBPYmplY3Qua2V5cyhvcGVuZWRGaWxlcylbeS0xXVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5vZGUgPSBvcGVuZWRGaWxlc1trXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXRTZWxlY3RlZEZpbGUobm9kZS5mdWxsUGF0aClcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc2V0Q3Vyc29yRGF0YSh7Y3Vyc29yOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseX0sY3Vyc29yU2NyZWVuOnt4OnRva2VuVW5kZXJDdXJzb3Iuc3RhcnQseTpjdXJzb3JTY3JlZW4ueX0sY29udGVudDp0b2tlblVuZGVyQ3Vyc29yLnRleHQsc3R5bGU6dG9rZW5VbmRlckN1cnNvci5zdHlsZX0pXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBwaHJhc2UgU3RydWN0dXJlICcke3BocmFzZX0nYClcbiAgICAgICAgfVxuICAgIH1cbiAgcmV0dXJuIChcbiAgICAgIDw+XG4gICAgICA8R3JpZCByb3dzPXs4fSBjb2xzPXsxNX0gaGlkZUJvcmRlcj5cbiAgICAgICAgICA8VlRhYnMgcm93PXswfSBjb2w9ezB9IHJvd1NwYW49ezh9IGNvbFNwYW49ezV9PlxuICAgICAgICAgICAgICA8VGFiIG5hbWU9J1Byb2plY3QnPlxuICAgICAgICAgICAgICAgICAgPEdyaWQgcm93cz17OH0gY29scz17MX0+XG4gICAgICAgICAgICAgICAgICA8Ym94IGtleT17MX0gcm93PXswfSBjb2w9ezB9IHJvd1NwYW49ezN9IGNvbFNwYW49ezF9XG4gICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXsnb3BlbmVkIEZpbGVzJ30gIHJlZj17b3BlbmVkRmlsZXNSZWZ9PlxuICAgICAgICAgICAgICAgICAgICAgIDxMaXN0Q29tcG9uZW50XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGxpbmVzPXtsaXN0T3BlbmVkRmlsZXMoKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdFRleHQ9eycnfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBrZXlzIG1vdXNlIHNjcm9sbCBzdHlsZT17eyBzZWxlY3RlZDogeyBiZzogJ2JsdWUnIH0gfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgc2Nyb2xsYmFyPXt7IGNoOiAnPScsIHRyYWNrOiB7IGZnOidibHVlJywgYmc6ICdncmV5JyB9IH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgIG9uVG9rZW5DbGljaz17b25Ub2tlbkNsaWNrfVxuICAgICAgICAgICAgICAgICAgICAgICAgICB0b2tlbml6ZXJEZWY9e2xpc3RpbmdUb2tlbml6ZXJEZWZpbml0aW9ufVxuICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgIDxib3gga2V5PXsyfVxuICAgICAgICAgICAgICAgICAgICAgICByb3c9ezN9IGNvbD17MH0gcm93U3Bhbj17NX0gY29sU3Bhbj17MX1cbiAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9eydQcm9qZWN0J30+XG5cbiAgICAgICAgICAgICAgICAgICAgICA8RmlsZVRyZWVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdG9wPXswfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBib3R0b209ezB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJvb3REaXI9e3Jvb3REaXJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIG9uRGlyU2VsZWN0PXtzZWxlY3REaXJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIG9uRmlsZVNlbGVjdD17c2VsZWN0RmlsZX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9eydQcm9qZWN0J31cbiAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vdXNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBrZXlzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnB1dFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xpY2thYmxlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmb2N1c2VkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBib3R0b209ezB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZWlnaHQ9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249eydtaWRkbGUnfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWxpZ249eydjZW50ZXInfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3R5bGU9e3tiZzonI2ZmYWEwMCcsZmc6JyMzMzMzMzMnLGhvdmVyOntiZzonI2ZmZGQ4OCcsZmc6JyMzMzMzMzMnfX19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0UGlja0ZvbGRlcih0cnVlKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ9eyd3b3Jrc3BhY2UnfS8+XG4gICAgICAgICAgICAgICAgICAgICAgPC9GaWxlVHJlZT5cbiAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgPC9HcmlkPlxuICAgICAgICAgICAgICA8L1RhYj5cbiAgICAgICAgICAgICAgPFRhYiBuYW1lPSdHaXQnPlxuICAgICAgICAgICAgICAgICAgPEdpdENvbXBvbmVudCByb290RGlyPXtyb290RGlyfSByb3c9ezB9IGNvbD17MX0gcm93U3Bhbj17MX0gY29sU3Bhbj17NX0vPlxuICAgICAgICAgICAgICA8L1RhYj5cbiAgICAgICAgICAgICAgPFRhYiBuYW1lPXsnRGVidWcnfT5cbiAgICAgICAgICAgICAgICAgIDxib3g+XG4gICAgICAgICAgICAgICAgICAgICAge2RlYnVnVmlldygpfVxuICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgIDwvVGFiPlxuICAgICAgICAgICAgICA8VGFiIG5hbWU9eydRdWl0J30gb25UYWJDbGljaz17KCk9Pntwcm9jZXNzLmV4aXQoMCl9fT5cbiAgICAgICAgICAgICAgICAgIDxib3ggb25UYWJDbGljaz17KCk9Pntwcm9jZXNzLmV4aXQoMCl9fT5cbiAgICAgICAgICAgICAgICAgICAgICB7ZGVidWdWaWV3KCl9XG4gICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgPC9UYWI+XG4gICAgICAgICAgPC9WVGFicz5cbiAgICAgICAgICB7LyogQ2VudGVyIHBhbmVsICovfVxuICAgICAgICAgIDxDb2RlQnVmZmVyRWRpdG9yQ29tcG9uZW50IHJvdz17MH0gY29sPXs1fSByb3dTcGFuPXs2fSBjb2xTcGFuPXsxMH1cbiAgICAgICAgICAgICAgICAgICAgICBib3JkZXI9e3sgdHlwZTogJ2xpbmUnIH19XG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw9eyhzZWxlY3RlZEZpbGUgfHwgJ05vIGZpbGUgc2VsZWN0ZWQnKS5yZXBsYWNlKHJvb3REaXIsJycpfVxuICAgICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoPXtzZWxlY3RlZEZpbGV8fG51bGx9XG4gICAgICAgICAgICAgICAgICAgICAgb25LZXlwcmVzcz17b25Db2RlRWRpdEtleVByZXNzfVxuICAgICAgICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXtvbkN1cnJlbnRFZGl0b3JDaGFuZ2V9XG4gICAgICAgICAgICAgICAgICAgICAgb25FdmVudD17b25DdXJyZW50RWRpdG9yQ2hhbmdlfVxuICAgICAgICAgIC8+XG4gICAgICAgICAgPGJveFxuICAgICAgICAgICAgICByb3c9ezZ9IGNvbD17NX0gcm93U3Bhbj17Mn0gY29sU3Bhbj17MTB9XG4gICAgICAgICAgICAgIGJvcmRlcj17eyB0eXBlOiAnbGluZScgfX1cbiAgICAgICAgICAgICAgc2Nyb2xsYWJsZVxuICAgICAgICAgICAgICBjbGlja2FibGVcbiAgICAgICAgICAgICAgbW91c2VcbiAgICAgICAgICAgICAga2V5c1xuICAgICAgICAgICAgICBsYWJlbD17J1Rlcm1pbmFsJ31cbiAgICAgICAgICAgICAgb3ZlcmZsb3c9eydzY3JvbGwnfVxuICAgICAgICAgID5cbiAgICAgICAgICAgICAge2N1cnJlbnRFZGl0b3JUZXh0fVxuICAgICAgICAgIDwvYm94PlxuICAgICAgICAgIHsvKjxMYXlvdXRDYXRjaGVyICByb3c9ezB9IGNvbD17NX0gcm93U3Bhbj17Nn0gY29sU3Bhbj17MTB9Lz4qL31cbiAgICAgICAgPC9HcmlkPlxuICAgICAgICB7bWVzc2FnZSAmJiAoXG4gICAgICAgICAgICA8TW9kYWxEaWFsb2dcbiAgICAgICAgICAgICAgICBsYWJlbD17J01lc3NhZ2UnfVxuICAgICAgICAgICAgICAgIHRpdGxlPVwiTWVzc2FnZVwiXG4gICAgICAgICAgICAgICAgb25DbG9zZT17KCkgPT4gc2V0TWVzc2FnZShmYWxzZSl9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgIDx0ZXh0PnttZXNzYWdlfTwvdGV4dD5cbiAgICAgICAgICAgIDwvTW9kYWxEaWFsb2c+XG4gICAgICAgICl9XG4gICAgICAgIHtwaWNrRm9sZGVyICYmXG4gICAgICAgICAgICAoPEVycm9yQm91bmRhcnlcbiAgICAgICAgICAgICAgICBGYWxsYmFja0NvbXBvbmVudD17RXJyb3JGYWxsYmFja31cbiAgICAgICAgICAgICAgICBvblJlc2V0PXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNldFBpY2tGb2xkZXIoZmFsc2UpXG4gICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICBvbkNsb3NlPXsoKSA9PiBzZXRQaWNrRm9sZGVyKGZhbHNlKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgIDxGb2xkZXJQaWNrZXJEaWFsb2dcbiAgICAgICAgICAgICAgICB0aXRsZT1cIlBpY2sgRm9sZGVyXCJcbiAgICAgICAgICAgICAgICBvbkZvbGRlclNlbGVjdD17KGlub2RlKT0+e1xuICAgICAgICAgICAgICAgICAgICBzZXRQaWNrRm9sZGVyKGZhbHNlKVxuICAgICAgICAgICAgICAgICAgICBpZihpbm9kZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc2V0TWVzc2FnZShgc2VsZWN0ZWQgZm9sZGVyICR7aW5vZGUuZnVsbFBhdGh9YClcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldFJvb3REaXIoaW5vZGUuZnVsbFBhdGgpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvRXJyb3JCb3VuZGFyeT4pXG4gICAgICAgIH1cbiAgICA8Lz5cbiAgKTtcbn1cbiIsIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAncmFmL3BvbHlmaWxsJztcbmltcG9ydCBibGVzc2VkIGZyb20gJ25lby1ibGVzc2VkJ1xuaW1wb3J0IHsgcmVuZGVyIH0gZnJvbSAncmVhY3QtYmxlc3NlZCc7XG5pbXBvcnQge0FwcH0gZnJvbSAnLi9zcmMvQXBwJztcbmltcG9ydCBmcyBmcm9tICdmcydcbmltcG9ydCBcIm5lby1ibGVzc2VkL2xpYi93aWRnZXRzL25vZGVcIjsgICAgICAgLy8gbGl0ZXJhbCBwYXRoIHNvIHRyZWUtc2hha2VyIGtlZXBzIGl0XG5pbXBvcnQgXCJuZW8tYmxlc3NlZC9saWIvd2lkZ2V0cy9lbGVtZW50XCI7ICAgIC8vIGFkZCBvdGhlcnMgaWYgeW91ciBjb2RlIHJlYWNoZXMgdGhlbVxuaW1wb3J0IFwibmVvLWJsZXNzZWQvbGliL3dpZGdldHMvc2NyZWVuXCI7ICAgICAgIC8vIGxpdGVyYWwgcGF0aCBzbyB0cmVlLXNoYWtlciBrZWVwcyBpdFxuaW1wb3J0IFwibmVvLWJsZXNzZWQvbGliL2JsZXNzZWRcIjsgICAgLy8gYWRkIG90aGVycyBpZiB5b3VyIGNvZGUgcmVhY2hlcyB0aGVtXG5pbXBvcnQgdmVyc2lvbiBmcm9tICcuL3ZlcnNpb24uanNvbidcblxuY29uc3Qgc2NyZWVuID0gYmxlc3NlZC5zY3JlZW4oe1xuICBzbWFydENTUjogdHJ1ZSxcbiAgYXV0b1BhZGRpbmc6IHRydWUsXG4gIHRpdGxlOiBgRURZIHYke3ZlcnNpb24udGFnfSAoJHt2ZXJzaW9uLmJyYW5jaH0ke3ZlcnNpb24uY29tbWl0LnN1YnN0cmluZygwLDgpfSkgdCAke3ZlcnNpb24udGltZX1gLFxuICBkdW1wOiAndGVybWluYWwtZHVtcC5sb2cnXG59KTtcblxuLy8gcXVpdCBvbiBDdHJsK0MgLy8gXG5zY3JlZW4ua2V5KFtcIkMtcVwiLCAnZjEyJ10sICgpID0+IHByb2Nlc3MuZXhpdCgwKSk7XG5zY3JlZW4ua2V5KFtcIkMtc1wiLCBcIkMtUy1zXCIsICdmOCddLCAoKSA9PiB7XG4gIC8vIGFmdGVyIHlvdeKAmXZlIGNyZWF0ZWQgeW91ciBzY3JlZW7igKZcbiAgY29uc3QgZHVtcCA9IHNjcmVlbi5zY3JlZW5zaG90KCk7ICAgICAgLy8gd2hvbGUgc2NyZWVuXG4vLyBvciBsaW1pdCB0byBhIHJlZ2lvbjogc2NyZWVuc2hvdCh4MSwgeDIsIHkxLCB5MilcbiAgZnMud3JpdGVGaWxlU3luYygnYnVmZmVyLnNncicsIGR1bXAsICd1dGY4Jyk7XG4gIGNvbnNvbGUubG9nKCdXcm90ZSBTR1IgZHVtcCB0byBidWZmZXIuc2dyJyk7XG4gIC8vIG5ldyBNZXNzYWdlKCkuZGlzcGxheSgnQnVmZmVyIHNhdmVkIScsIDEsICgpID0+IHNjcmVlbi5yZW5kZXIoKSk7XG59KTtcbnNjcmVlbi5lbmFibGVNb3VzZSgpXG5cbnJlbmRlcig8QXBwIC8+LCBzY3JlZW4pOyJdLCJuYW1lcyI6WyJmcyIsInVzZVJlZiIsInVzZUVmZmVjdCIsImpzeHMiLCJqc3giLCJkZWZhdWx0VGV4dCIsImVkaXRvciIsInNldEVkaXRvciIsInVzZVN0YXRlIiwiYm94IiwibGlzdGluZ1Rva2VuaXplckRlZmluaXRpb24iLCJsaW5lcyIsIndrIiwiY3Vyc29yIiwiRnJhZ21lbnQiLCJHcmlkIiwiY3AiLCJjbGlwYm9hcmRDb3B5IiwidGFnIiwiYnJhbmNoIiwiRXJyb3JCb3VuZGFyeSIsInJlbmRlciJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBTUEsTUFBTSxjQUFZLENBQUMsU0FBUTtBQUN6QixRQUFNLFVBQVE7QUFBQSxJQUNaLEtBQUk7QUFBQTtBQUFBLElBQ0osS0FBSTtBQUFBO0FBQUEsSUFDSixLQUFJO0FBQUE7QUFBQSxJQUNKLEtBQUk7QUFBQTtBQUFBLElBQ0osS0FBSTtBQUFBO0FBQUEsSUFDSixLQUFJO0FBQUE7QUFBQSxJQUNKLEtBQUk7QUFBQTtBQUFBLEVBQ1I7QUFDRSxRQUFNLEtBQUcsS0FBSyxLQUFLLFFBQVEsT0FBTSxFQUFFO0FBQ25DLFNBQU8sR0FBRyxLQUFLLGlCQUFpQixNQUFNLEdBQUcsRUFBRSxJQUFJLFFBQU0sS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLEdBQUcsQ0FBQyxJQUFJLFFBQVEsRUFBRSxDQUFDLElBQUksS0FBSyxJQUFJO0FBQ3ZHO0FBQ0EsTUFBTSxnQkFBYyxDQUFDLElBQUcsT0FBTztBQUM3QixRQUFNLEtBQUssWUFBWSxFQUFFO0FBQ3pCLFFBQU0sS0FBRyxZQUFZLEVBQUU7QUFDdkIsU0FBTyxLQUFHLEtBQUcsS0FBSSxPQUFLLEtBQUksSUFBRTtBQUM5QjtBQUVPLE1BQU0sTUFBSztBQUFBLEVBQ2hCLEtBQUc7QUFBQTtBQUFBLEVBQ0gsT0FBSztBQUFBO0FBQUEsRUFDTCxPQUFLO0FBQUE7QUFBQSxFQUNMLFdBQVM7QUFBQTtBQUFBLEVBQ1QsVUFBUTtBQUFBO0FBQUEsRUFDUixTQUFPO0FBQUE7QUFBQSxFQUNQLFdBQVMsQ0FBQTtBQUFBO0FBQUEsRUFDVCxVQUFRLENBQUE7QUFBQTtBQUFBLEVBRVIsTUFBTSxXQUFXO0FBQ2YsV0FBT0EsR0FBQUEsU0FBRyxTQUFTLEtBQUssVUFBVSxNQUFNO0FBQUEsRUFDMUM7QUFBQSxFQUNBLFFBQU87QUFDTCxXQUFPLEtBQUssU0FBUyxNQUFNLEdBQUcsRUFBRTtBQUFBLEVBQ2xDO0FBQUEsRUFDQSxpQkFBZ0I7QUFDZCxXQUFPLEtBQUssU0FBUyxRQUFRLElBQUksS0FBSyxJQUFJLElBQUcsRUFBRTtBQUFBLEVBQ2pEO0FBQUEsRUFDQSxTQUFRO0FBRUcsU0FBSyxLQUFLLFFBQVEsT0FBTSxFQUFFO0FBQ25DLFVBQU0sU0FBUyxLQUFLLEtBQUssUUFBUSxHQUFHLElBQUUsS0FDakMsS0FBSyxTQUFTLFNBQVMsU0FFeEI7QUFDSixXQUFPLEdBQUcsSUFBSSxPQUFPLEtBQUssTUFBSyxJQUFHLENBQUMsQ0FBQyxHQUFHLE1BQU0sSUFBSSxLQUFLLElBQUk7QUFBQSxFQUM1RDtBQUFBLEVBQ0EsVUFBUztBQUNQLFdBQU8sWUFBWSxJQUFJO0FBQUEsRUFDekI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTUEsVUFBVTtBQUNSLFFBQUksTUFBSyxDQUFBO0FBQ1QsUUFBSSxLQUFLLElBQUk7QUFDYixRQUFJLEtBQUssUUFBUTtBQUNmLFlBQU0sSUFBSSxLQUFLLFNBQVMsUUFBUSxXQUFTLE1BQU0sU0FBUztBQUN4RCxRQUFFLFFBQVEsT0FBSyxJQUFJLEtBQUssQ0FBQyxDQUFDO0FBQUEsSUFDNUI7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFTQSxNQUFNLEtBQUssU0FBUyxJQUFJLGFBQVk7QUFDbEMsU0FBSyxXQUFTO0FBQ2QsUUFBSSxPQUFPLE1BQU1BLEdBQUFBLFNBQUcsS0FBSyxLQUFLLFFBQVE7QUFDdEMsU0FBSyxLQUFHLEtBQUs7QUFDYixTQUFLLE9BQUs7QUFBQSxNQUNSLEtBQUssZ0JBQWMsTUFBSTtBQUFBLE1BQ3ZCLEtBQUssV0FBUyxNQUFJO0FBQUEsTUFDbEIsS0FBSyxtQkFBaUIsTUFBSTtBQUFBLE1BQzFCLEtBQUssa0JBQWdCLE1BQUk7QUFBQSxNQUN6QixLQUFLLHNCQUFvQixNQUFJO0FBQUEsTUFDN0IsS0FBSyxXQUFTLE1BQUk7QUFBQSxNQUNsQixLQUFLLGFBQVcsTUFBSTtBQUFBLElBQzFCLEVBQU0sS0FBSyxFQUFFO0FBQ1QsU0FBSyxPQUFPLEtBQUssU0FBUyxLQUFLLFFBQVE7QUFDdkMsU0FBSyxVQUFVLEtBQUssU0FBUyxTQUFTLEtBQUssUUFBUTtBQUNuRCxTQUFLLFNBQU87QUFDWixTQUFLLFdBQVMsQ0FBQTtBQUNkLFFBQUcsS0FBSyxLQUFLLFFBQVEsR0FBRyxJQUFFLElBQUc7QUFDM0IsVUFBRztBQUNELGFBQUssVUFBVSxNQUFNQSxHQUFBQSxTQUFHLFFBQVEsS0FBSyxRQUFRO0FBQUEsTUFDL0MsU0FBTyxLQUFJO0FBQ1QsYUFBSyxVQUFRLENBQUE7QUFBQSxNQUNmO0FBQUEsSUFDRixPQUFPO0FBQ0wsV0FBSyxVQUFRLENBQUE7QUFBQSxJQUNmO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQVFBLE1BQU0sS0FBSyxTQUFRLElBQUc7QUFDcEIsU0FBSyxTQUFPO0FBQ1osU0FBSyxZQUFVLE1BQU0sUUFBUTtBQUFBLE1BQ3pCLEtBQUssUUFBUSxJQUFJLFdBQVM7QUFDeEIsWUFBRztBQUNELGdCQUFNLFNBQVMsSUFBSSxNQUFLO0FBQ3hCLGlCQUFPLFdBQVcsS0FBSyxLQUFLLEtBQUssVUFBVSxLQUFLO0FBQ2hELGlCQUFPLE9BQU8sS0FBSyxTQUFTLElBQUksT0FBTyxRQUFRO0FBQUEsUUFDakQsU0FBTyxLQUFJO0FBQ1QsaUJBQU8sUUFBUSxRQUFRLElBQUk7QUFBQSxRQUM3QjtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ1QsR0FBTyxPQUFPLE9BQUssTUFBTSxJQUFJO0FBQ3pCLFNBQUssU0FBUyxLQUFLLGFBQWE7QUFDaEMsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUNBLE1BQU0sTUFBTSxTQUFRLElBQUc7QUFDckIsU0FBSyxTQUFPO0FBQ1osU0FBSyxXQUFTLENBQUE7QUFBQSxFQUNoQjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFRQSxNQUFNLFFBQVEsU0FBUSxJQUFHO0FBRXZCLFNBQUssT0FBTyxLQUFLLFNBQVMsS0FBSyxRQUFRO0FBQ3ZDLFNBQUssVUFBVSxLQUFLLFNBQVMsU0FBUyxLQUFLLFFBQVE7QUFHbkQsUUFBSSxLQUFLLFlBQVksR0FBRyxRQUFRLEtBQUssT0FBTyxLQUFLLEtBQUssU0FBUyxTQUFTO0FBQ3RFLGFBQU87QUFBQSxJQUNUO0FBSUEsUUFBSSxLQUFLLEtBQUssUUFBUSxHQUFHLElBQUUsSUFBSTtBQUM3QixZQUFNLFVBQVUsTUFBTUEsR0FBQUEsU0FBRyxRQUFRLEtBQUssUUFBUTtBQUM5QyxXQUFLLFVBQVE7QUFDYixVQUFJLFlBQVksTUFBTSxRQUFRO0FBQUEsUUFDNUIsUUFBUSxJQUFJLFdBQVM7QUFDbkIsY0FBRztBQUNELGtCQUFNLFNBQVMsSUFBSSxNQUFLO0FBQ3hCLG1CQUFPLFdBQVcsS0FBSyxLQUFLLEtBQUssVUFBVSxLQUFLO0FBQ2hELG1CQUFPLEtBQUssU0FBUyxJQUFJLEtBQUssUUFBUTtBQUN0QyxtQkFBTyxPQUFPLFFBQVEsU0FBUyxFQUFFO0FBQUEsVUFDbkMsU0FBUSxHQUFHO0FBQ1QsbUJBQU8sUUFBUSxRQUFRLElBQUk7QUFBQSxVQUM3QjtBQUFBLFFBQ0YsQ0FBQztBQUFBLE1BQ1QsR0FBUyxPQUFRLE9BQUssTUFBSSxJQUFJO0FBQ3hCLGlCQUFTLFNBQVMsT0FBTyxPQUFLLE1BQUssSUFBSSxFQUNwQyxLQUFLLGFBQWE7QUFDckIsV0FBSyxXQUFTO0FBQUEsSUFDaEI7QUFDQSxXQUFPO0FBQUEsRUFFVDtBQUNGO0FBSU8sTUFBTSxVQUFTO0FBQUEsRUFDcEIsVUFBUTtBQUFBLEVBQ1IsV0FBUyxJQUFJLE1BQUs7QUFBQSxFQUNsQixhQUFXLENBQUMsT0FBTSxPQUFNLE9BQU0sV0FBUztBQUFDLFdBQU87QUFBQSxFQUFJO0FBQUEsRUFDbkQsWUFBWSxhQUFXLENBQUMsT0FBTSxPQUFNLE9BQU0sV0FBUztBQUFBLEVBQUMsR0FBRTtBQUNwRCxTQUFLLGFBQVc7QUFBQSxFQUNsQjtBQUFBLEVBQ0EsTUFBTSxhQUFhO0FBQ2pCLFVBQU0sS0FBSyxPQUFNO0FBQ2pCLFFBQUk7QUFDRixZQUFNLFlBQVksTUFBTUEsWUFBRyxTQUFTLEtBQUssS0FBSyxLQUFLLFNBQVMsWUFBWSxHQUFHLE1BQU07QUFDakYsU0FBRyxJQUFJLFVBQVUsTUFBTSxPQUFPLENBQUM7QUFBQSxJQUNqQyxTQUFTLEdBQUc7QUFBQSxJQUVaO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNQSxNQUFNLEtBQUssU0FBUztBQUNsQixTQUFLLEtBQUssTUFBTSxLQUFLLFdBQVU7QUFDL0IsU0FBSyxVQUFRO0FBQ2IsU0FBSyxTQUFTLFdBQVc7QUFDekIsVUFBTSxLQUFLLFNBQVMsS0FBSyxLQUFLLFNBQVEsS0FBSyxJQUFHLEtBQUssT0FBTztBQUMxRCxVQUFNLEtBQUssU0FBUyxRQUFRLEtBQUssU0FBUSxLQUFLLEVBQUU7QUFDaEQsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUNBLE1BQU0sVUFBUztBQUNiLFVBQU0sS0FBSyxTQUFTLFFBQVEsS0FBSyxTQUFRLEtBQUssRUFBRTtBQUFBLEVBQ2xEO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTUEsTUFBTSxLQUFLLE1BQUs7QUFDZCxTQUFLLFNBQU87QUFDWixTQUFLLFdBQVMsTUFBTSxRQUFRO0FBQUEsTUFDeEIsS0FBSyxRQUFRLElBQUksV0FBUztBQUN4QixjQUFNLFNBQVEsSUFBSSxNQUFLO0FBQ3ZCLGVBQU8sV0FBUyxLQUFLLEtBQUssS0FBSyxVQUFVLEtBQUs7QUFDOUMsZUFBTyxPQUFPLEtBQUssS0FBSyxTQUFTLEtBQUssSUFBSSxPQUFPLFFBQVE7QUFBQSxNQUMzRCxDQUFDO0FBQUEsSUFDVDtBQUNJLFNBQUssV0FBUyxLQUFLLFNBQVMsT0FBTyxDQUFDLEdBQUUsR0FBRSxNQUFLO0FBQzNDLGFBQU8sS0FBSyxXQUFXLEdBQUUsR0FBRSxHQUFFLElBQUk7QUFBQSxJQUNuQyxDQUFDO0FBQ0QsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUNBLFVBQVM7QUFHUCxRQUFJLE9BQU8sS0FBSyxTQUFTLFFBQU87QUFDaEMsU0FBSyxLQUFLLGFBQWE7QUFDdkIsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNQSxPQUFNO0FBQ0osUUFBSSxNQUFNLElBQUksVUFBUztBQUN2QixRQUFJLFVBQVEsS0FBSztBQUNqQixRQUFJLFdBQVMsS0FBSztBQUNsQixRQUFJLEtBQUcsS0FBSztBQUNaLFFBQUksYUFBVyxLQUFLO0FBQ3BCLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUN0UEEsU0FBd0IsWUFBWTtBQUFBLEVBQ2hDLFFBQVE7QUFBQSxFQUNSLFFBQVE7QUFBQSxFQUNSLFNBQVM7QUFBQSxFQUNUO0FBQUEsRUFDQTtBQUNKLEdBQUc7QUFDQyxRQUFNLFNBQVNDLE1BQUFBLE9BQUE7QUFHZkMsUUFBQUEsVUFBVSxNQUFNO0FBQ1osVUFBTSxPQUFPLE9BQU87QUFDcEIsUUFBSSxXQUFXLE1BQUE7QUFBQSxFQUNuQixHQUFHLENBQUEsQ0FBRTtBQUVMLFNBQ0lDLDhCQUFBQTtBQUFBQSxJQUFDO0FBQUEsSUFBQTtBQUFBLE1BQ0csS0FBSztBQUFBLE1BQ0wsS0FBSTtBQUFBLE1BQ0osTUFBSztBQUFBLE1BQ0w7QUFBQSxNQUNBO0FBQUEsTUFDQSxRQUFRLEVBQUUsTUFBTSxPQUFBO0FBQUEsTUFDaEIsT0FBTyxFQUFFLElBQUksU0FBUyxJQUFJLFFBQUE7QUFBQSxNQUMxQixNQUFJO0FBQUEsTUFDSixPQUFLO0FBQUEsTUFDTCxXQUFTO0FBQUEsTUFFVCxPQUFPLENBQUMsSUFBSSxRQUFRO0FBQ2hCLFlBQUksSUFBSSxTQUFTLFNBQVUsU0FBQTtBQUFBLE1BQy9CO0FBQUEsTUFHQSxVQUFBO0FBQUEsUUFBQUEsOEJBQUFBLEtBQUMsT0FBQSxFQUFJLFFBQVEsR0FBRyxPQUFNLFFBQU8sT0FBTyxFQUFFLElBQUksUUFBQSxHQUN0QyxVQUFBO0FBQUEsVUFBQUEsOEJBQUFBLEtBQUMsUUFBQSxFQUFLLE1BQUksTUFBRSxVQUFBO0FBQUEsWUFBQSxJQUFJLEtBQUs7QUFBQSxZQUFHO0FBQUEsVUFBQSxHQUFDO0FBQUEsVUFDekJDLDhCQUFBQTtBQUFBQSxZQUFDO0FBQUEsWUFBQTtBQUFBLGNBQ0csT0FBTztBQUFBLGNBQ1AsT0FBSztBQUFBLGNBQ0wsV0FBUztBQUFBLGNBQ1QsV0FBUztBQUFBLGNBQ1QsU0FBUztBQUFBLGNBQ1osVUFBQTtBQUFBLFlBQUE7QUFBQSxVQUFBO0FBQUEsUUFBRyxHQUNSO0FBQUEsMENBR0MsT0FBQSxFQUFJLEtBQUssR0FBRyxNQUFNLEdBQUcsT0FBTyxHQUFHLFFBQVEsR0FBRyxZQUFVLE1BQUMsTUFBSSxNQUFDLE9BQUssTUFBQyxjQUFZLE1BQ3hFLFNBQUEsQ0FDTDtBQUFBLE1BQUE7QUFBQSxJQUFBO0FBQUEsRUFBQTtBQUdaO0FDdERPLFNBQVMsY0FBYyxLQUFJLFFBQU0sUUFBVztBQUMvQyxRQUFNLE9BQU8sb0JBQUksUUFBTztBQUN4QixTQUFPLEtBQUssVUFBVSxLQUFLLENBQUMsS0FBSyxVQUFVO0FBQ3ZDLFlBQU8sS0FBRztBQUFBO0FBQUEsTUFFTixLQUFLO0FBQVUsZUFBTztBQUFBLE1BQ3RCLEtBQUs7QUFBVSxlQUFPO0FBQUEsTUFDdEIsS0FBSztBQUFTLGVBQU87QUFBQSxNQUNyQixLQUFLO0FBQVksZUFBTztBQUFBLElBQ3BDO0FBQ00sUUFBSSxPQUFPLFVBQVUsWUFBWSxVQUFVLE1BQU07QUFDL0MsVUFBSSxLQUFLLElBQUksS0FBSyxHQUFHO0FBQ25CO0FBQUEsTUFDRjtBQUNBLFdBQUssSUFBSSxLQUFLO0FBQUEsSUFDaEI7QUFDQSxXQUFPO0FBQUEsRUFDVCxHQUFFLEtBQUs7QUFDVDtBQUVPLFNBQVMsU0FBUyxhQUFZLE9BQU0sUUFBTztBQUNoRCxNQUFJLFFBQVEsWUFBWSxVQUFVLEdBQUUsS0FBSztBQUV6QyxNQUFJLE9BQU8sWUFBWSxVQUFVLFFBQU0sT0FBTyxNQUFNO0FBQ3BELFVBQVEsUUFBTSxTQUFPLE1BQU0sVUFBVSxHQUFFLFlBQVksTUFBTTtBQUMzRDtBQ0NLLE1BQU0sZUFBYztBQUFBLEVBQ3ZCLGdCQUFjO0FBQUEsRUFDZCxPQUFLO0FBQUEsRUFDTCxRQUFNLENBQUE7QUFBQSxFQUNOLFFBQU07QUFBQSxFQUNOLE1BQUk7QUFBQSxFQUNKLElBQUU7QUFBQSxFQUNGLElBQUU7QUFBQSxFQUNGLE9BQUs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQVFMLE9BQU8sZ0JBQWdCLEdBQUUsY0FBYSxlQUFjLFlBQVc7QUFDM0QsVUFBTSxTQUFTLEVBQUU7QUFDakIsVUFBTSxPQUFPLE9BQU8sS0FBSyxNQUFNLEVBQUUsS0FBSyxTQUFPLE9BQU8sR0FBRyxNQUFNLE1BQVM7QUFDdEUsVUFBTSxXQUFXLGFBQWEsWUFBWSxJQUFJO0FBQzlDLFVBQU0sS0FBSyxJQUFJLGVBQWM7QUFDN0IsT0FBRyxnQkFBYztBQUNqQixPQUFHLE9BQU0sRUFBRSxDQUFDO0FBQ1osT0FBRyxPQUFLO0FBQ1IsT0FBRyxRQUFNLFNBQVM7QUFDbEIsT0FBRyxRQUFNLEVBQUU7QUFDWCxPQUFHLE1BQUksRUFBRSxRQUFNLEVBQUUsQ0FBQyxFQUFFO0FBQ3BCLE9BQUcsSUFBRTtBQUNMLE9BQUcsSUFBRSxHQUFHO0FBQ1IsV0FBTztBQUFBLEVBQ1g7QUFDSjtBQUtPLE1BQU0sa0JBQWdCO0FBQUEsRUFDekIsS0FBSSxFQUFDLE1BQUssT0FBTSxhQUFZO0FBQUEsSUFDeEIsUUFBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLE1BQUssR0FBRSxTQUFRLG1CQUFrQjtBQUFBLElBQzNELFlBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFPLEdBQUUsU0FBUSxrQkFBaUI7QUFBQSxJQUM1RCxRQUFjLEVBQUMsT0FBTyxFQUFDLElBQUcsU0FBUSxHQUFFLFNBQVEscUNBQW9DO0FBQUEsSUFDaEYsVUFBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLE9BQU0sR0FBRSxTQUFRLDRCQUEyQjtBQUFBLElBQ3JFLGFBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxPQUFNLEdBQUUsU0FBUSx1QkFBc0I7QUFBQSxJQUNoRSxZQUFjLEVBQUMsT0FBTyxFQUFDLElBQUcsUUFBTyxHQUFFLFNBQVEsU0FBUTtBQUFBLElBQ25ELFFBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFPLEdBQUUsU0FBUSxTQUFRO0FBQUEsRUFDM0QsRUFBSztBQUFBLEVBQ0QsSUFBRyxFQUFDLE1BQUssTUFBSyxPQUFNLE1BQUssYUFBWTtBQUFBLElBQ2pDLFNBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxVQUFTLEdBQUUsU0FBUSwyS0FBMEs7QUFBQSxJQUN2TixRQUFjLEVBQUMsT0FBTyxFQUFDLElBQUcsTUFBSyxHQUFFLFNBQVEsbUJBQWtCO0FBQUEsSUFDM0QsU0FBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLFVBQVMsR0FBRSxTQUFRLGFBQVk7QUFBQTtBQUFBLElBRXpELFFBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxTQUFRLEdBQUUsU0FBUSxxQ0FBb0M7QUFBQSxJQUNoRixVQUFjLEVBQUMsT0FBTyxFQUFDLElBQUcsT0FBTSxHQUFFLFNBQVEsZ0NBQStCO0FBQUEsSUFDekUsYUFBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLE1BQUssR0FBRSxTQUFRLHlCQUF3QjtBQUFBLElBQ2pFLFlBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFPLEdBQUUsU0FBUSxVQUFTO0FBQUEsSUFDcEQsWUFBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLFFBQU8sR0FBRSxTQUFRLGtCQUFpQjtBQUFBLElBQzVELFFBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFPLEdBQUUsU0FBUSxVQUFTO0FBQUEsRUFDNUQsRUFBSztBQUFBLEVBQ0QsTUFBSyxFQUFDLE1BQUssUUFBTyxPQUFNLE1BQUssYUFBWTtBQUFBLElBQ3JDLFVBQVksRUFBQyxPQUFPLEVBQUMsSUFBRyxVQUFTLEdBQUUsU0FBUSxnQkFBZTtBQUFBLElBQzFELGVBQWUsRUFBQyxPQUFPLEVBQUMsSUFBRyxPQUFNLEdBQUUsU0FBUSxvQkFBbUI7QUFBQSxJQUM5RCxPQUFPLEVBQUMsT0FBTyxFQUFDLElBQUcsVUFBUyxHQUFFLFNBQVEsTUFBSztBQUFBLElBQzNDLFVBQVcsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFPLEdBQUUsU0FBUSxhQUFZLGNBQWEsS0FBSTtBQUFBLElBQ3JFLGdCQUFtQixFQUFDLE9BQU8sRUFBQyxJQUFHLFNBQVEsR0FBRSxTQUFRLFdBQVU7QUFBQSxJQUMzRCxZQUFjLEVBQUMsT0FBTyxFQUFDLElBQUcsUUFBTyxHQUFFLFNBQVEsU0FBUTtBQUFBLElBQ25ELFFBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFPLEdBQUUsU0FBUSxTQUFRO0FBQUEsRUFDM0QsRUFBSztBQUFBLEVBQ0QsS0FBSSxFQUFDLE1BQUssT0FBTSxPQUFNLE1BQUssYUFBWTtBQUFBLElBQ25DLFlBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxVQUFTLEdBQUUsU0FBUSx3QkFBdUI7QUFBQSxJQUNwRSxTQUFjLEVBQUMsT0FBTyxFQUFDLElBQUcsVUFBUyxHQUFFLFNBQVEsMEpBQXlKO0FBQUEsSUFDdE0sV0FBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLFNBQVEsR0FBRSxTQUFRLG9CQUFtQjtBQUFBLElBQy9ELGFBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxTQUFRLEdBQUUsU0FBUSxzQkFBcUIsY0FBYSxPQUFNO0FBQUEsSUFDcEYsU0FBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLFVBQVMsR0FBRSxTQUFRLGFBQVk7QUFBQTtBQUFBLElBRXpELFFBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxNQUFLLEdBQUUsU0FBUSxtQkFBa0I7QUFBQSxJQUMzRCxhQUFjLEVBQUMsT0FBTyxFQUFDLElBQUcsTUFBSyxHQUFFLFNBQVEseUJBQXdCO0FBQUEsSUFDakUsVUFBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLE9BQU0sR0FBRSxTQUFRLDRCQUEyQjtBQUFBLElBQ3JFLFlBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFPLEdBQUUsU0FBUSxTQUFRO0FBQUEsSUFDbkQsWUFBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLFFBQU8sR0FBRSxTQUFRLGtCQUFpQjtBQUFBLElBQzVELFFBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFPLEdBQUUsU0FBUSxTQUFRO0FBQUEsRUFDM0QsRUFBSztBQUFBLEVBQ0QsR0FBRSxFQUFDLE1BQUssS0FBSSxPQUFNLE1BQUssYUFBWTtBQUFBLElBQy9CLFNBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxVQUFTLEdBQUUsU0FBUSxtRkFBa0Y7QUFBQSxJQUMvSCxRQUFjLEVBQUMsT0FBTyxFQUFDLElBQUcsTUFBSyxHQUFFLFNBQVEsbUJBQWtCO0FBQUEsSUFDM0QsU0FBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLFVBQVMsR0FBRSxTQUFRLGFBQVk7QUFBQTtBQUFBLElBRXpELFFBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxTQUFRLEdBQUUsU0FBUSxxQ0FBb0M7QUFBQSxJQUNoRixVQUFjLEVBQUMsT0FBTyxFQUFDLElBQUcsT0FBTSxHQUFFLFNBQVEsNEJBQTJCO0FBQUEsSUFDckUsYUFBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLE9BQU0sR0FBRSxTQUFRLDRCQUEyQjtBQUFBLElBQ3JFLFlBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFPLEdBQUUsU0FBUSxTQUFRO0FBQUEsSUFDbkQsWUFBYyxFQUFDLE9BQU8sRUFBQyxJQUFHLFFBQU8sR0FBRSxTQUFRLGtCQUFpQjtBQUFBLElBQzVELFFBQWMsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFPLEdBQUUsU0FBUSxTQUFRO0FBQUEsRUFDM0QsRUFBSztBQUFBLEVBQ0QsT0FBTSxFQUFDLE1BQUssS0FBSSxPQUFNLE1BQUssYUFBWTtBQUFBLElBQ25DLFlBQWtCLEVBQUMsT0FBTyxFQUFDLElBQUcsTUFBSyxHQUFFLFNBQVEsU0FBUTtBQUFBLElBQ3JELE1BQWtCLEVBQUMsT0FBTyxFQUFDLElBQUcsUUFBTyxHQUFFLFNBQVEsYUFBWTtBQUFBLEVBQ25FLEVBQUs7QUFDTDtBQU9PLFNBQVMsa0JBQWtCLE1BQU07QUFDcEMsUUFBTSxlQUFlLGdCQUFnQixJQUFJLEtBQUcsZ0JBQWdCLEtBQUs7QUFDakUsU0FBTyxhQUFhLFlBQVk7QUFDcEM7QUFNTyxTQUFTLGFBQWEsY0FBYztBQUN2QyxlQUFhLEtBQUssSUFBRSxFQUFDLE9BQU8sRUFBQyxJQUFHLFVBQVMsR0FBRSxTQUFRLHNCQUFxQjtBQUN4RSxRQUFNLGFBQWEsSUFBSTtBQUFBLElBQ25CLE9BQU8sUUFBUSxhQUFhLFdBQVcsRUFDbEMsSUFBSSxDQUFDLENBQUMsTUFBTSxVQUFVLE1BQU0sTUFBTSxJQUFJLElBQUksV0FBVyxRQUFRLE1BQU0sR0FBRyxFQUN0RSxLQUFLLEdBQUc7QUFBQSxJQUNiLGFBQWEsU0FBTztBQUFBLEVBQzVCO0FBS0ksU0FBTyxTQUFTLFVBQVUsTUFBSyxZQUFXO0FBQ3RDLFVBQU0sU0FBTyxDQUFBO0FBQ2IsZUFBVyxLQUFNLEtBQU8sU0FBUyxVQUFVLEdBQUc7QUFDMUMsWUFBTSxTQUFTLEVBQUU7QUFDakIsWUFBTSxPQUFPLE9BQU8sS0FBSyxNQUFNLEVBQUUsS0FBSyxTQUFPLE9BQU8sR0FBRyxNQUFNLE1BQVM7QUFDckQsbUJBQWEsWUFBWSxJQUFJO0FBQzlDLFlBQU0sS0FBSyxlQUFlLGdCQUFnQixHQUFFLGNBQWEsYUFBYSxNQUFLLFVBQVU7QUFXakYsYUFBTyxLQUFLLEVBQUU7QUFBQSxJQUV0QjtBQUNBLFdBQU87QUFBQSxFQUNYO0FBQ0o7QUN6R08sTUFBTSxpQkFBaUI7QUFBQSxFQUMxQixTQUFPO0FBQUEsRUFDUCxjQUFZO0FBQUEsRUFDWixpQkFBZTtBQUFBLEVBQ2YsWUFBVSxFQUFDLGlCQUFnQixDQUFBLEdBQUcsaUJBQWdCLENBQUEsRUFBRTtBQUFBLEVBQ2hELGlCQUFlO0FBQUEsRUFDZixnQkFBYztBQUFBLEVBQ2QsWUFBVTtBQUFBLEVBQ1YsWUFBVTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNVixZQUFZLFFBQVE7QUFDaEIsU0FBSyxTQUFTLFVBQVE7QUFBQSxFQUMxQjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLEdBQUcsV0FBVSxVQUFTO0FBQ2xCLFNBQUssVUFBVSxTQUFTLElBQUU7QUFBQSxFQUM5QjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU9BLGdCQUFnQixXQUFVLFNBQVE7QUFDOUIsVUFBTSxTQUFPLENBQUE7QUFDYixhQUFRLFlBQVksS0FBSyxVQUFVLFNBQVMsR0FBRTtBQUMxQyxVQUFHO0FBQ0MsY0FBTSxjQUFZLFNBQVMsT0FBTztBQUNsQyxZQUFHLE9BQU8sZ0JBQWlCLFlBQVc7QUFDbEMsc0JBQVc7QUFBQSxRQUNmLE9BQUs7QUFDRCxpQkFBTyxLQUFLLFFBQVE7QUFBQSxRQUN4QjtBQUFBLE1BQ0osU0FBTyxLQUFJO0FBQUEsTUFFWDtBQUFBLElBQ0o7QUFDQSxTQUFLLFVBQVUsU0FBUyxJQUFFO0FBQUEsRUFDOUI7QUFBQSxFQUNBLHdCQUF1QjtBQUNuQixRQUFJLEVBQUMsR0FBRSxFQUFDLElBQUksS0FBSyxhQUFZO0FBQzdCLFFBQUksRUFBQyxnQkFBZSxJQUFJLGVBQWMsSUFBSSxXQUFVLElBQUksV0FBVSxHQUFFLElBQUU7QUFDdEUsUUFBSSxJQUFFLElBQUc7QUFDTCxXQUFHO0FBQUEsSUFDUDtBQUNBLFFBQUcsSUFBRyxLQUFHLElBQUk7QUFDVCxZQUFJO0FBQUEsSUFDUjtBQUNBLFNBQUssWUFBVTtBQUFBLEVBQ25CO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUtBLGNBQWMsUUFBTSxHQUFFLFFBQU87QUFDekIsVUFBTSxRQUFRLEtBQUssT0FBTyxNQUFNLElBQUk7QUFDcEMsVUFBTSxJQUFFLFNBQU8sVUFBUSxNQUFNO0FBQzdCLFdBQU8sTUFBTSxNQUFNLE9BQU0sQ0FBQztBQUFBLEVBQzlCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLGVBQWM7QUFDVixXQUFPLEtBQUssb0JBQW9CLEtBQUssV0FBVztBQUFBLEVBQ3BEO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUtBLGtCQUFpQjtBQUNiLFdBQU8sS0FBSyxvQkFBb0IsS0FBSyxjQUFjO0FBQUEsRUFDdkQ7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNQSxvQkFBb0IsT0FBTTtBQUN0QixVQUFNLFVBQVEsS0FBSyxPQUFPLFVBQVUsR0FBRSxTQUFTLEtBQUssQ0FBQyxFQUFFLE1BQU0sSUFBSTtBQUVqRSxXQUFPO0FBQUEsTUFDSCxHQUFFLFFBQVEsU0FBTztBQUFBLE1BQ2pCLEdBQUUsUUFBUSxRQUFRLFNBQU8sQ0FBQyxFQUFFO0FBQUEsSUFDeEM7QUFBQSxFQUNJO0FBQUEsRUFDQSxVQUFVLEdBQUUsR0FBRTtBQUNWLFNBQUssY0FBWSxLQUFLLG9CQUFvQixFQUFDLEdBQUUsRUFBQyxDQUFDO0FBQUEsRUFDbkQ7QUFBQSxFQUNBLGFBQWEsR0FBRSxHQUFFO0FBQ2IsU0FBSyxpQkFBZSxLQUFLLG9CQUFvQixFQUFDLEdBQUUsRUFBQyxDQUFDO0FBQUEsRUFDdEQ7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFPQSxvQkFBb0IsUUFBTztBQUN2QixVQUFNLEVBQUMsR0FBRSxFQUFDLElBQUk7QUFDZCxVQUFNLFFBQU0sS0FBSyxPQUFPLE1BQU0sSUFBSSxFQUFFLE1BQU0sR0FBRSxDQUFDO0FBRTdDLFdBQU8sTUFBTSxPQUFPLENBQUMsR0FBRSxNQUFJLElBQUUsSUFBRSxFQUFFLFFBQU8sQ0FBQyxJQUFJO0FBQUEsRUFDakQ7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQVFBLE1BQU0sSUFBRyxLQUFJO0FBQ1QsWUFBUSxJQUFJLE1BQUk7QUFBQSxNQUNaLEtBQUs7QUFBVyxhQUFLLGFBQVk7QUFBSztBQUFBLE1BQ3RDLEtBQUs7QUFBVyxhQUFLLGVBQWM7QUFBSztBQUFBLE1BQ3hDLEtBQUs7QUFBVyxhQUFLLGVBQWM7QUFBSztBQUFBLE1BQ3hDLEtBQUs7QUFBVyxhQUFLLGdCQUFlO0FBQUk7QUFBQSxNQUN4QyxLQUFLO0FBQVcsYUFBSztBQUFXO0FBQUEsTUFDaEMsS0FBSztBQUFZLGFBQUs7QUFBVTtBQUFBLE1BQ2hDLEtBQUs7QUFBYSxhQUFLLFVBQVM7QUFBSztBQUFBLE1BQ3JDLEtBQUs7QUFBYSxhQUFLLE9BQU07QUFBSztBQUFBLE1BQ2xDLEtBQUs7QUFBYSxhQUFLLE9BQU8sSUFBSTtBQUFFLGFBQUssZUFBYztBQUFJO0FBQUEsTUFDM0QsS0FBSztBQUFVLGFBQUssT0FBTyxHQUFJO0FBQUk7QUFBQSxNQUNuQztBQUNJLFlBQUksTUFBTSxHQUFHLFNBQVMsR0FBRTtBQUNwQixjQUFHLElBQUksUUFBUSxJQUFJLEtBQUssV0FBVyxHQUFHO0FBQ2xDLGlCQUFLLE9BQU8sSUFBSSxRQUFRO0FBQUEsVUFDNUIsT0FBTztBQUNILGlCQUFLLE9BQU8sRUFBRTtBQUFBLFVBQ2xCO0FBQUEsUUFDSjtBQUFBLElBQ2hCO0FBQ1EsU0FBSyxzQkFBcUI7QUFDMUIsV0FBTztBQUFBLEVBQ1g7QUFBQSxFQUNBLGlCQUFpQixHQUFFLEdBQUUsV0FBVTtBQUMzQixVQUFNLFFBQVEsS0FBSyxjQUFhO0FBQ2hDLFVBQU0sT0FBTyxNQUFNLENBQUM7QUFDcEIsVUFBTSxTQUFTLFVBQVUsTUFBSyxDQUFDO0FBQ2hCLFdBQU8sSUFBSSxPQUFHLEVBQUUsSUFBSTtBQUNuQyxVQUFNLG1CQUFtQixPQUFPLEtBQUssQ0FBQyxHQUFFLEdBQUUsTUFBSTtBQUMxQyxhQUFPLEVBQUUsU0FBTyxLQUFLLEVBQUUsT0FBSztBQUFBLElBQ2hDLENBQUM7QUFDRCxXQUFPO0FBQUEsRUFDWDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFRQSxTQUFTLE1BQUssYUFBWSxXQUFXO0FBQ2pDLFVBQU0sRUFBQyxJQUFHLEdBQUUsSUFBSTtBQUNoQixVQUFNLEVBQUMsR0FBRSxFQUFDLElBQUk7QUFDZCxVQUFNLFNBQVMsS0FBSyxhQUFZO0FBQ2hDLFVBQU0sUUFBUSxLQUFLLGNBQWE7QUFDaEMsVUFBTSxPQUFPLE1BQU0sT0FBTyxDQUFDO0FBQzNCLFVBQU0sU0FBUyxVQUFVLE1BQUssQ0FBQztBQUMvQixVQUFNLFNBQVMsT0FBTyxJQUFJLE9BQUcsRUFBRSxJQUFJO0FBQ25DLFVBQU0sbUJBQW1CLE9BQU8sS0FBSyxDQUFDLEdBQUUsR0FBRSxNQUFJO0FBQzFDLGFBQU8sRUFBRSxTQUFPLE9BQU8sS0FBSyxFQUFFLE9BQUssT0FBTztBQUFBLElBQzlDLENBQUM7QUFFRCxXQUFPO0FBQUEsTUFDSCxPQUFNO0FBQUEsTUFDTixXQUFVLEVBQUMsR0FBRSxJQUFHLEdBQUUsR0FBRTtBQUFBLE1BQ3BCO0FBQUEsTUFDQTtBQUFBLE1BQ0EsY0FBYTtBQUFBLE1BQ2I7QUFBQSxNQUNBLGNBQWEsRUFBQyxHQUFFLE9BQU8sSUFBRSxLQUFLLFdBQVUsR0FBRSxPQUFPLElBQUUsS0FBSyxVQUFTO0FBQUEsTUFDakUsUUFBTyxLQUFLO0FBQUEsTUFDWixlQUFjLEtBQUs7QUFBQSxNQUNuQixPQUFNLEtBQUs7QUFBQSxNQUNYO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNaO0FBQUEsRUFDSTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNQSxlQUFjO0FBQ1YsUUFBSSxFQUFDLEdBQUUsRUFBQyxJQUFJLEtBQUssb0JBQW9CLEtBQUssV0FBVztBQUNyRCxRQUFJLElBQUUsR0FBRztBQUNMLFdBQUssY0FBWSxLQUFLLG9CQUFvQixFQUFDLEdBQUksR0FBRSxJQUFFLEVBQUMsQ0FBQztBQUNyRCxXQUFLLGdCQUFnQixpQkFBZ0IsSUFBSTtBQUFBLElBQzdDO0FBQ0EsV0FBTztBQUFBLEVBQ1g7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTUEsaUJBQWdCO0FBQ1osUUFBSSxFQUFDLEdBQUUsRUFBQyxJQUFJLEtBQUssb0JBQW9CLEtBQUssV0FBVztBQUNyRCxVQUFNLFFBQU0sS0FBSyxPQUFPLE1BQU0sSUFBSTtBQUNsQyxRQUFJLElBQUcsTUFBTSxTQUFPLEdBQUk7QUFDcEIsV0FBSyxjQUFZLEtBQUssb0JBQW9CLEVBQUMsR0FBSSxHQUFFLElBQUUsRUFBQyxDQUFDO0FBQ3JELFdBQUssZ0JBQWdCLGlCQUFnQixJQUFJO0FBQUEsSUFDN0M7QUFDQSxXQUFPO0FBQUEsRUFDWDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNQSxpQkFBZ0I7QUFDWixRQUFHLEtBQUssY0FBWSxHQUFFO0FBQ2xCLFdBQUssZUFBYTtBQUNsQixXQUFLLGdCQUFnQixpQkFBZ0IsSUFBSTtBQUFBLElBQzdDO0FBQ0EsV0FBTztBQUFBLEVBQ1g7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTUEsa0JBQWlCO0FBQ2IsUUFBRyxLQUFLLGNBQVksS0FBSyxPQUFPLFFBQU87QUFDbkMsV0FBSyxlQUFhO0FBQ2xCLFdBQUssZ0JBQWdCLGlCQUFnQixJQUFJO0FBQUEsSUFDN0M7QUFDQSxXQUFPO0FBQUEsRUFDWDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNQSxTQUFRO0FBQ0osUUFBSSxFQUFDLEdBQUUsRUFBQyxJQUFJLEtBQUssb0JBQW9CLEtBQUssV0FBVztBQUNyRCxTQUFLLGNBQVksS0FBSyxvQkFBb0IsRUFBQyxHQUFFLEdBQUUsRUFBRyxDQUFDO0FBQ25ELFNBQUssZ0JBQWdCLGlCQUFnQixJQUFJO0FBQ3pDLFdBQU87QUFBQSxFQUNYO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLFFBQU87QUFDSCxRQUFJLEVBQUMsR0FBRSxFQUFDLElBQUksS0FBSyxvQkFBb0IsS0FBSyxXQUFXO0FBQ3JELFVBQU0sT0FBSyxLQUFLLE9BQU8sTUFBTSxJQUFJLEVBQUUsQ0FBQztBQUNwQyxTQUFLLGNBQVksS0FBSyxvQkFBb0IsRUFBQyxHQUFFLEtBQUssUUFBTyxFQUFHLENBQUM7QUFDN0QsU0FBSyxnQkFBZ0IsaUJBQWdCLElBQUk7QUFDekMsV0FBTztBQUFBLEVBQ1g7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTUEsWUFBVztBQUNQLFFBQUcsS0FBSyxjQUFZLEdBQUU7QUFDbEIsV0FBSyxlQUFlO0FBQ3BCLFdBQUssZ0JBQWdCLGlCQUFpQixJQUFJO0FBQzFDLFlBQU0sU0FBTyxLQUFLLE9BQU8sVUFBVSxHQUFFLEtBQUssV0FBVztBQUNyRCxZQUFNLFFBQU0sS0FBSyxPQUFPLFVBQVUsS0FBSyxjQUFZLENBQUM7QUFDcEQsV0FBSyxTQUFPLFNBQU87QUFDbkIsV0FBSyxnQkFBZ0IsaUJBQWdCLElBQUk7QUFBQSxJQUM3QztBQUNBLFdBQU87QUFBQSxFQUNYO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUtBLFNBQVE7QUFDSixVQUFNLFNBQU8sS0FBSyxPQUFPLFVBQVUsR0FBRSxLQUFLLGNBQVksQ0FBQztBQUN2RCxVQUFNLFFBQU0sS0FBSyxPQUFPLFVBQVUsS0FBSyxjQUFZLENBQUM7QUFDcEQsU0FBSyxTQUFPLFNBQU87QUFDbkIsU0FBSyxnQkFBZ0IsaUJBQWdCLElBQUk7QUFDekMsV0FBTztBQUFBLEVBQ1g7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBS0EsT0FBTyxJQUFHO0FBQ04sU0FBSyxlQUFhO0FBQ2xCLFVBQU0sU0FBTyxLQUFLLE9BQU8sVUFBVSxHQUFFLEtBQUssY0FBWSxDQUFDO0FBQ3ZELFVBQU0sUUFBTSxLQUFLLE9BQU8sVUFBVSxLQUFLLGNBQVksQ0FBQztBQUNwRCxTQUFLLFNBQU8sU0FBTyxLQUFHO0FBQ3RCLFNBQUssZ0JBQWdCLGlCQUFnQixJQUFJO0FBQ3pDLFNBQUssZ0JBQWdCLGlCQUFnQixJQUFJO0FBQ3pDLFdBQU87QUFBQSxFQUNYO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLE9BQU07QUFDRixVQUFNLHNCQUFxQixJQUFJLGlCQUFnQjtBQUMvQyx3QkFBb0IsU0FBUyxLQUFLO0FBQ2xDLHdCQUFvQixjQUFjLEtBQUs7QUFDdkMsd0JBQW9CLGlCQUFpQixLQUFLO0FBQzFDLHdCQUFvQixpQkFBZSxLQUFLO0FBQ3hDLHdCQUFvQixnQkFBYyxLQUFLO0FBQ3ZDLHdCQUFvQixZQUFVLEtBQUs7QUFDbkMsd0JBQW9CLFlBQVUsS0FBSztBQUNuQyxXQUFPO0FBQUEsRUFDWDtBQUNKO0FDdldPLFNBQVMsY0FBYztBQUFBLEVBQzVCO0FBQUEsRUFDQSxXQUFXO0FBQUEsRUFDWCxhQUFBQyxlQUFZO0FBQUEsRUFDWixjQUFZLENBQUMsZ0JBQWM7QUFBQSxFQUFDO0FBQUEsRUFDNUIsZUFBYSxDQUFDLGdCQUFjO0FBQUEsRUFBQztBQUFBLEVBQzdCLGNBQVksQ0FBQyxnQkFBYztBQUFBLEVBQUM7QUFBQSxFQUM1QixlQUFhLENBQUMsZ0JBQWM7QUFBQSxFQUFDO0FBQUEsRUFDN0I7QUFBQSxFQUNBO0FBQUEsRUFDQSxHQUFHO0FBQ0wsR0FBRztBQUNDLFFBQU0sU0FBU0osTUFBQUEsT0FBTyxJQUFJO0FBQzFCLFFBQU0sQ0FBQ0ssU0FBUUMsVUFBUyxJQUFJQyxNQUFBQSxTQUFTLElBQUk7QUFDekMsUUFBTSxDQUFDLE1BQU0sT0FBTyxJQUFRQSxNQUFBQSxTQUFTLEVBQUUsTUFBTSxJQUFJLE1BQU0sSUFBSTtBQUUzRCxNQUFJLGlCQUFlO0FBQ25CTixRQUFBQSxVQUFVLE1BQUk7QUFDVixRQUFJLFlBQVVJO0FBQ2QsUUFBRyxDQUFDLFdBQVU7QUFDVixrQkFBWSxJQUFJLGlCQUFpQixNQUFNLEtBQUssSUFBSSxLQUFHRCxZQUFXO0FBQUEsSUFDbEU7QUFDQSxTQUFJLE1BQU0sS0FBSyxJQUFJLEtBQUdBLGNBQWEsVUFBVSxVQUFVLFdBQVcsTUFBSSxVQUFVLE9BQU8sVUFBVSxVQUFVLFdBQVcsR0FBRTtBQUNwSCxnQkFBVSxzQkFBQTtBQUFBLElBQ2Q7QUFDQSxjQUFVLFNBQU8sTUFBTSxLQUFLLElBQUksS0FBR0E7QUFDbkMsY0FBVSxpQkFBaUIsS0FBSyxPQUFLO0FBQ3JDLGNBQVUsZ0JBQWdCLEtBQUs7QUFDL0IsSUFBQUUsV0FBVSxVQUFVLE1BQU07QUFBQSxFQUM5QixHQUFFLENBQUMsS0FBSyxDQUFDO0FBR1RMLFFBQUFBLFVBQVUsTUFBTTtBQUNaLFVBQU1PLE9BQU0sT0FBTztBQUNuQixRQUFJLENBQUNBLEtBQUs7QUFDVixVQUFNLFNBQVMsTUFBTTtBQUNqQixjQUFRLEVBQUUsTUFBTUEsS0FBSSxPQUFPLE1BQU1BLEtBQUksU0FBTyxHQUFHO0FBQUEsSUFDbkQ7QUFDQSxXQUFBO0FBQ0FBLFNBQUksR0FBRyxVQUFVLE1BQU07QUFDdkIsV0FBTyxNQUFNQSxLQUFJLGVBQWUsVUFBVSxNQUFNO0FBQUEsRUFDcEQsR0FBRyxDQUFBLENBQUU7QUFHTFAsUUFBQUEsVUFBVSxNQUFJO0FBQ1YsUUFBR0ksU0FBTztBQUNOLE1BQUFBLFFBQU8sZ0JBQWdCLEtBQUs7QUFDNUIsTUFBQUEsUUFBTyxpQkFBaUIsS0FBSztBQUM3QixNQUFBQyxXQUFVRCxRQUFPLE1BQU07QUFBQSxJQUMzQjtBQUFBLEVBQ0osR0FBRyxDQUFDLElBQUksQ0FBQztBQUVULFFBQU0scUJBQW1CLENBQUMsSUFBRyxRQUFNO0FBQy9CLFFBQUcsVUFBVTtBQUNULE1BQUFBLFFBQU8sTUFBTSxJQUFJLEdBQUc7QUFDcEIsbUJBQWEsY0FBYztBQUMzQix1QkFBaUIsV0FBVyxNQUFNO0FBRTlCLFFBQUFDLFdBQVVELFFBQU8sTUFBTTtBQUFBLE1BQzNCLEdBQUcsRUFBRTtBQUFBLElBQ1QsV0FBVyxPQUFPLENBQUMsTUFBSyxNQUFNLEdBQUc7QUFDN0IsTUFBQUEsUUFBTyxNQUFNLElBQUksR0FBRztBQUNwQix1QkFBaUIsV0FBVyxNQUFNO0FBRTlCLFFBQUFDLFdBQVVELFFBQU8sTUFBTTtBQUFBLE1BQzNCLEdBQUcsRUFBRTtBQUFBLElBQ1Q7QUFBQSxFQUNKO0FBQ0EsUUFBTSxXQUFXLENBQUMsZ0JBQWdCO0FBQzlCLFFBQUcsQ0FBQ0EsU0FBTztBQUNQO0FBQUEsSUFDSjtBQUNBLFVBQU0sWUFBVSxhQUFhLGdCQUFjO0FBQUEsTUFDdkMsTUFBSztBQUFBLE1BQ0wsT0FBTTtBQUFBLE1BQ04sYUFBWTtBQUFBLFFBQ1IsWUFBa0IsRUFBQyxPQUFPLEVBQUMsSUFBRyxNQUFBLEdBQU8sU0FBUSxRQUFBO0FBQUEsUUFDN0MsTUFBa0IsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFBLEdBQVMsU0FBUSxZQUFBO0FBQUEsTUFBVztBQUFBLElBQzlELENBQ0g7QUFDRCxVQUFNLE1BQU1BLFFBQU8sU0FBUyxPQUFPLFFBQVEsTUFBSyxhQUFZLFNBQVM7QUFHckUsV0FBTztBQUFBLEVBQ1g7QUFRQSxRQUFNLGNBQVksQ0FBQyxnQkFBZTtBQUU5QixZQUFPLFlBQVksUUFBQTtBQUFBLE1BQ2YsS0FBSztBQUFhO0FBQ1YsZ0JBQU0sV0FBVyxTQUFTLFdBQVc7QUFDckMsVUFBQUEsUUFBTyxhQUFhLFNBQVMsYUFBYSxJQUFJQSxRQUFPLFdBQVcsU0FBUyxhQUFhLElBQUlBLFFBQU8sU0FBUztBQUMxRyxVQUFBQyxXQUFVRCxRQUFPLE1BQU07QUFDdkIscUJBQVcsTUFBSTtBQUNYLHdCQUFZLFFBQVE7QUFDcEIseUJBQWEsUUFBUTtBQUFBLFVBQ3pCLEdBQUUsQ0FBQztBQUFBLFFBQ1A7QUFDQTtBQUFBLE1BQ0osS0FBSztBQUFhO0FBQ1YsZ0JBQU0sV0FBVyxTQUFTLFdBQVc7QUFDckMscUJBQVcsTUFBTTtBQUNiLFlBQUFBLFFBQU8sVUFBVSxZQUFZLElBQUUsT0FBTyxRQUFRLEtBQUssS0FBR0EsUUFBTyxXQUFVLFlBQVksSUFBRSxPQUFPLFFBQVEsS0FBSyxLQUFHQSxRQUFPLFNBQVM7QUFDNUgsWUFBQUEsUUFBTyxhQUFhLFNBQVMsYUFBYSxJQUFJQSxRQUFPLFdBQVcsU0FBUyxhQUFhLElBQUlBLFFBQU8sU0FBUztBQUMxRyxZQUFBQyxXQUFVRCxRQUFPLE1BQU07QUFBQSxVQUMzQixHQUFHLENBQUM7QUFBQSxRQUNSO0FBQ0E7QUFBQSxNQUNKLEtBQUs7QUFBVztBQUNSLGdCQUFNLFdBQVcsU0FBUyxXQUFXO0FBQ3JDLGdCQUFNLEVBQUMsR0FBRSxFQUFBLElBQUs7QUFFZCxxQkFBVyxNQUFJO0FBQ1gsWUFBQUEsUUFBTyxhQUFhLElBQUk7QUFDeEIsWUFBQUEsUUFBTyxVQUFVLFlBQVksSUFBRSxPQUFPLFFBQVEsS0FBSyxLQUFHQSxRQUFPLFdBQVUsWUFBWSxJQUFFLE9BQU8sUUFBUSxLQUFLLEtBQUdBLFFBQU8sU0FBUztBQUM1SCxZQUFBQSxRQUFPLGFBQWEsU0FBUyxhQUFhLElBQUlBLFFBQU8sV0FBVyxTQUFTLGFBQWEsSUFBSUEsUUFBTyxTQUFTO0FBQzFHLHdCQUFZLFFBQVE7QUFDcEIseUJBQWEsUUFBUTtBQUNyQixZQUFBQyxXQUFVRCxRQUFPLE1BQU07QUFBQSxVQUMzQixHQUFFLENBQUM7QUFBQSxRQUNQO0FBQ0E7QUFBQSxNQUNKLEtBQUs7QUFBVztBQUNTLG1CQUFTLFdBQVc7QUFDckMsVUFBQUEsUUFBTyxhQUFBLEVBQWUsc0JBQUE7QUFDdEIscUJBQVcsTUFBSTtBQUNYLFlBQUFBLFFBQU8sYUFBYSxJQUFJO0FBRXhCLFlBQUFDLFdBQVVELFFBQU8sTUFBTTtBQUFBLFVBQzNCLEdBQUUsQ0FBQztBQUFBLFFBQ1A7QUFDQTtBQUFBLE1BQ0osS0FBSztBQUFhO0FBQ08sbUJBQVMsV0FBVztBQUNyQyxVQUFBQSxRQUFPLGVBQUEsRUFBaUIsc0JBQUE7QUFDeEIscUJBQVcsTUFBSTtBQUNYLFlBQUFBLFFBQU8sYUFBYSxJQUFJO0FBRXhCLFlBQUFDLFdBQVVELFFBQU8sTUFBTTtBQUFBLFVBQzNCLEdBQUUsQ0FBQztBQUFBLFFBQ1A7QUFDQTtBQUFBLE1BQ0o7QUFBUyxjQUFNLElBQUksTUFBTSxjQUFjLFdBQVcsQ0FBQztBQUFBLElBQUc7QUFBQSxFQUU5RDtBQUNBLFFBQU0sY0FBYyxNQUFNO0FBQ3RCLFFBQUcsQ0FBQ0EsU0FBTztBQUNQO0FBQUEsSUFDSjtBQUNBLFVBQU0sRUFBQyxXQUFVLElBQUcsZ0JBQWUsT0FBTUE7QUFDekMsV0FBT0EsUUFBTyxjQUFBLEVBQ1QsT0FBTyxDQUFDLEdBQUUsTUFBTTtBQUNiLGFBQVEsS0FBSSxNQUFNLEtBQU0sS0FBSztBQUFBLElBQ2pDLENBQUMsRUFDQSxRQUFRLENBQUMsTUFBSyxPQUFNLFFBQU07QUFDdkIsWUFBTSxjQUFjO0FBQUEsUUFDaEJGLDhCQUFBQTtBQUFBQSxVQUFDO0FBQUEsVUFBQTtBQUFBLFlBRUcsS0FBSztBQUFBLFlBQU8sTUFBTTtBQUFBLFlBQUcsUUFBUTtBQUFBLFlBQUcsT0FBTyxLQUFLLFVBQVE7QUFBQSxZQUNwRCxTQUFTO0FBQUEsVUFBQTtBQUFBLFVBRkosY0FBYyxLQUFLLElBQUksS0FBSyxHQUFHO0FBQUEsUUFBQTtBQUFBLE1BR3hDO0FBRUosWUFBTSxZQUFVLGFBQWEsZ0JBQWM7QUFBQSxRQUN2QyxNQUFLO0FBQUEsUUFDTCxPQUFNO0FBQUEsUUFDTixhQUFZO0FBQUEsVUFDUixZQUFrQixFQUFDLE9BQU8sRUFBQyxJQUFHLE1BQUEsR0FBTyxTQUFRLFNBQUE7QUFBQSxVQUM3QyxNQUFrQixFQUFDLE9BQU8sRUFBQyxJQUFHLFFBQUEsR0FBUyxTQUFRLGFBQUE7QUFBQSxRQUFZO0FBQUEsTUFDL0QsQ0FDSDtBQUNELFlBQU0sU0FBUyxVQUFVLE1BQUssS0FBSztBQUNuQyxhQUFPLFFBQVEsQ0FBQyxPQUFNLE1BQUk7QUFDdEIsb0JBQVk7QUFBQSxVQUNSQSw4QkFBQUE7QUFBQUEsWUFBQztBQUFBLFlBQUE7QUFBQSxjQUVHLEtBQUs7QUFBQSxjQUFPLE1BQU0sTUFBTTtBQUFBLGNBQU8sUUFBUTtBQUFBLGNBQUcsT0FBTyxNQUFNLEtBQUssVUFBUTtBQUFBLGNBQ3BFLFNBQVMsTUFBTTtBQUFBLGNBQU0sT0FBTyxNQUFNO0FBQUEsWUFBQTtBQUFBLFlBRjdCLGNBQWMsS0FBSyxVQUFVLENBQUMsSUFBSSxLQUFLLEdBQUc7QUFBQSxVQUFBO0FBQUEsUUFHbkQ7QUFBQSxNQUNSLENBQUM7QUFDRCxhQUFPO0FBQUEsSUFDWCxDQUFDO0FBQUEsRUFDVDtBQUNBLFFBQU0sZUFBZSxNQUFNO0FBQ3ZCLFFBQUcsQ0FBQ0UsU0FBTztBQUNQO0FBQUEsSUFDSjtBQUNBLFVBQU0sSUFBSUEsUUFBTztBQUNqQixVQUFNLEVBQUMsR0FBRSxNQUFLQSxRQUFPLGFBQUE7QUFDckIsVUFBTSxFQUFDLGFBQVksSUFBRyxXQUFVLElBQUcsV0FBVSxJQUFHLGdCQUFlLElBQUcsZUFBYyxHQUFBLElBQU1BO0FBQ3RGLFdBQVFGLDhCQUFBQTtBQUFBQSxNQUFDO0FBQUEsTUFBQTtBQUFBLFFBRUwsS0FBSyxJQUFFO0FBQUEsUUFDUCxNQUFNLElBQUU7QUFBQSxRQUNSLE9BQU87QUFBQSxRQUFHLFFBQVE7QUFBQSxRQUNsQixPQUFPLEVBQUMsU0FBUSxLQUFBO0FBQUEsUUFDaEIsU0FBU0UsUUFBTyxPQUFPLFVBQVUsR0FBRSxJQUFFLENBQUM7QUFBQSxNQUFBO0FBQUEsTUFMakMsaUJBQWlCLEtBQUssS0FBSztBQUFBLElBQUE7QUFBQSxFQU94QztBQUNBLFFBQU0sa0JBQWdCLE1BQUk7QUFDdEIsUUFBRyxDQUFDQSxTQUFPO0FBQ1A7QUFBQSxJQUNKO0FBQ1UsSUFBQUEsUUFBTztBQUNqQixVQUFNLEVBQUMsR0FBRSxNQUFLQSxRQUFPLGdCQUFBO0FBQ3JCLFVBQU0sRUFBQyxhQUFZLElBQUcsV0FBVSxJQUFHLFdBQVUsSUFBRyxnQkFBZSxJQUFHLGVBQWMsR0FBQSxJQUFNQTtBQUN0RixVQUFNLFlBQVUsYUFBYSxnQkFBYztBQUFBLE1BQ3ZDLE1BQUs7QUFBQSxNQUNMLE9BQU07QUFBQSxNQUNOLGFBQVk7QUFBQSxRQUNSLFlBQWtCLEVBQUMsT0FBTyxFQUFDLElBQUcsTUFBQSxHQUFPLFNBQVEsU0FBQTtBQUFBLFFBQzdDLE1BQWtCLEVBQUMsT0FBTyxFQUFDLElBQUcsUUFBQSxHQUFTLFNBQVEsYUFBQTtBQUFBLE1BQVk7QUFBQSxJQUMvRCxDQUNIO0FBQ0QsVUFBTSxtQkFBaUJBLFFBQU8saUJBQWlCLEdBQUUsR0FBRSxTQUFTO0FBQzVELFFBQUcsa0JBQWtCO0FBQ2pCLGFBQVFGLDhCQUFBQTtBQUFBQSxRQUFDO0FBQUEsUUFBQTtBQUFBLFVBRUwsS0FBSyxJQUFJO0FBQUEsVUFDVCxNQUFNLGlCQUFpQjtBQUFBLFVBQ3ZCLE9BQU8saUJBQWlCLEtBQUs7QUFBQSxVQUFRLFFBQVE7QUFBQSxVQUM3QyxPQUFPLEVBQUMsR0FBRyxpQkFBaUIsT0FBTyxTQUFTLEtBQUE7QUFBQSxVQUM1QyxTQUFTLGlCQUFpQjtBQUFBLFFBQUE7QUFBQSxRQUxyQixvQkFBb0IsS0FBSyxLQUFLO0FBQUEsTUFBQTtBQUFBLElBTzNDLE9BQU87QUFDSCxhQUFPLENBQUE7QUFBQSxJQUNYO0FBQUEsRUFDSjtBQUNBLFFBQU0sa0JBQWtCLE1BQU07QUFDMUIsVUFBTSxjQUFhLENBQUVBLDhCQUFBQTtBQUFBQSxNQUFDO0FBQUEsTUFBQTtBQUFBLFFBRWxCLE9BQU87QUFBQSxRQUNQLE9BQU87QUFBQSxRQUNQLE9BQUs7QUFBQSxRQUNMLE1BQUk7QUFBQSxRQUNKLE9BQUs7QUFBQSxRQUNMLFdBQVM7QUFBQSxRQUNULFNBQU87QUFBQSxRQUNQLE9BQU8sRUFBQyxJQUFJLFFBQU8sSUFBSSxPQUFBO0FBQUEsTUFBTTtBQUFBLE1BUnhCLGdCQUFnQixLQUFLLEtBQUs7QUFBQSxJQUFBLENBU2hDO0FBQ0gsUUFBRyxDQUFDRSxTQUFPO0FBQ1AsYUFBTztBQUFBLElBQ1g7QUFDQSxVQUFNLEtBQUdBLFFBQU8sY0FBQSxFQUFnQjtBQUVoQyxVQUFNLEVBQUMsYUFBWSxJQUFHLFdBQVUsSUFBRyxXQUFVLElBQUcsZ0JBQWUsSUFBRyxlQUFjLEdBQUEsSUFBTUE7QUFDdEYsVUFBTSxLQUFHLEtBQUssTUFBTSxLQUFHLEtBQUcsRUFBRSxJQUFFO0FBQzlCLFVBQU0sS0FBRyxLQUFLLE1BQU0sS0FBRyxLQUFHLEVBQUUsSUFBRTtBQUM5QixnQkFBWSxLQUFNRiw4QkFBQUE7QUFBQUEsTUFBQztBQUFBLE1BQUE7QUFBQSxRQUVmLE9BQU87QUFBQSxRQUNQLE9BQU87QUFBQSxRQUNQLEtBQUs7QUFBQSxRQUNMLFFBQVE7QUFBQSxRQUNSLE9BQUs7QUFBQSxRQUNMLE1BQUk7QUFBQSxRQUNKLE9BQUs7QUFBQSxRQUNMLFdBQVM7QUFBQSxRQUNULFNBQU87QUFBQSxRQUNQLE9BQU8sRUFBQyxJQUFJLFFBQU8sSUFBSSxPQUFBO0FBQUEsTUFBTTtBQUFBLE1BVnhCLGlCQUFpQixLQUFLLEtBQUs7QUFBQSxJQUFBLENBV2pDO0FBQ0gsV0FBTztBQUFBLEVBQ1g7QUFDQSxRQUFNLGVBQWEsTUFBSTtBQUNuQixRQUFHLENBQUNFLFNBQU87QUFDUDtBQUFBLElBQ0o7QUFDQSxVQUFNLEVBQUMsV0FBVSxJQUFHLFdBQVUsSUFBRyxnQkFBZSxJQUFHLGVBQWMsR0FBQSxJQUFNQTtBQUN2RSxVQUFNLElBQUUsS0FBSyxVQUFVQSxRQUFPLGNBQWMsRUFBRSxRQUFRLE9BQU0sRUFBRTtBQUM5RCxXQUFRRiw4QkFBQUE7QUFBQUEsTUFBQztBQUFBLE1BQUE7QUFBQSxRQUNMLE9BQUs7QUFBQSxRQUFDLE1BQUk7QUFBQSxRQUVWLEtBQUs7QUFBQSxRQUNMLE1BQU0sS0FBRztBQUFBLFFBQ1QsT0FBTyxFQUFFO0FBQUEsUUFBUSxRQUFRO0FBQUEsUUFDekIsT0FBTyxFQUFDLFNBQVEsS0FBQTtBQUFBLFFBQ2hCLFNBQVM7QUFBQSxNQUFBO0FBQUEsTUFMSixpQkFBaUIsS0FBSyxLQUFLO0FBQUEsSUFBQTtBQUFBLEVBT3hDO0FBQ0EsU0FDSUQsOEJBQUFBO0FBQUFBLElBQUM7QUFBQSxJQUFBO0FBQUEsTUFDRyxLQUFLO0FBQUEsTUFDSixHQUFHO0FBQUEsTUFDSixPQUFLO0FBQUEsTUFDTCxNQUFJO0FBQUEsTUFDSixPQUFLO0FBQUEsTUFDTCxXQUFTO0FBQUEsTUFDVCxTQUFPO0FBQUEsTUFDUCxPQUFPLEVBQUUsUUFBUSxFQUFFLElBQUksU0FBTztBQUFBLE1BQzlCLE1BQU07QUFBQSxNQUNOLFlBQVk7QUFBQSxNQUNaLFlBQVk7QUFBQSxNQUNaLFNBQVM7QUFBQSxNQUdSLFVBQUE7QUFBQSxRQUFBLFlBQUE7QUFBQSxRQUNBLGFBQUE7QUFBQSxRQUNBLGdCQUFBO0FBQUEsUUFDQSxZQUFVLENBQUE7QUFBQSxRQUNWLGdCQUFBO0FBQUEsUUFDQSxhQUFBO0FBQUEsTUFBYTtBQUFBLElBQUE7QUFBQSxFQUFBO0FBRTFCO0FDeFVBLE1BQU1PLCtCQUEyQjtBQUFBLEVBQzdCLE1BQUs7QUFBQSxFQUNMLE9BQU07QUFBQSxFQUNOLGFBQVk7QUFBQSxJQUNSLGNBQWtCLEVBQUMsT0FBTyxFQUFDLElBQUcsUUFBQSxHQUFTLFNBQVEsU0FBQTtBQUFBLElBQy9DLFVBQWtCLEVBQUMsT0FBTyxFQUFDLElBQUcsUUFBQSxHQUFTLFNBQVEscUNBQUEsRUFBQTtBQUFBLElBQy9DLGNBQWtCLEVBQUMsT0FBTyxFQUFDLElBQUcsU0FBQSxHQUFVLFNBQVEsV0FBQTtBQUFBLElBQ2hELGVBQWtCLEVBQUMsT0FBTyxFQUFDLElBQUcsU0FBQSxHQUFVLFNBQVEsVUFBQTtBQUFBLElBQ2hELGdCQUFrQixFQUFDLE9BQU8sRUFBQyxJQUFHLE9BQUEsR0FBUSxTQUFRLFlBQUE7QUFBQSxJQUM5QyxpQkFBa0IsRUFBQyxPQUFPLEVBQUMsSUFBRyxVQUFBLEdBQVcsU0FBUSxZQUFBO0FBQUEsSUFDakQsZ0JBQWtCLEVBQUMsT0FBTyxFQUFDLElBQUcsT0FBQSxHQUFRLFNBQVEsVUFBQTtBQUFBLElBQzlDLGdCQUFrQixFQUFDLE9BQU8sRUFBQyxJQUFHLE1BQUEsR0FBTyxTQUFRLFVBQUE7QUFBQSxJQUM3QyxZQUFrQixFQUFDLE9BQU8sRUFBQyxJQUFHLFFBQUEsR0FBUyxTQUFRLHdDQUFBO0FBQUEsSUFDL0MsUUFBa0IsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFBLEdBQVMsU0FBUSxhQUFBO0FBQUEsRUFBWTtBQUVuRTtBQVNBLFNBQXdCLFNBQVM7QUFBQSxFQUM3QjtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBLGNBQVksQ0FBQyxPQUFNLE9BQU0sT0FBTSxXQUFTO0FBQUMsV0FBTztBQUFBLEVBQUk7QUFBQSxFQUNwRCxTQUFPO0FBQUEsRUFDUCxHQUFHO0FBQ1AsR0FBRTtBQUNFLFFBQU0sU0FBU1QsTUFBQUEsT0FBQTtBQUNmLFFBQU0sQ0FBQyxTQUFTLFVBQVUsSUFBSSxNQUFNLFNBQVMsS0FBSztBQUNsRCxRQUFNLENBQUMsVUFBVSxXQUFXLElBQUksTUFBTSxTQUFTLElBQUk7QUFDbkQsUUFBTSxDQUFDLFlBQVksYUFBYSxJQUFJLE1BQU0sU0FBUyxJQUFJO0FBQ3ZELFFBQU0sQ0FBQyxXQUFVLFlBQVksSUFBSU8sTUFBQUEsU0FBUyxJQUFJLFVBQVUsV0FBVyxDQUFDO0FBS3BFTixRQUFBQSxVQUFVLE1BQU07QUFDWixVQUFNLE9BQU8sT0FBTztBQUNwQixRQUFJLFdBQVcsTUFBQTtBQUNmLGNBQVUsS0FBSyxPQUFPLEVBQ2pCLEtBQUssQ0FBQSxPQUFNLFVBQVUsS0FBSyxVQUFVLFFBQVEsQ0FBQyxFQUM3QyxLQUFLLENBQUEsT0FBTTtBQUNSLGlCQUFXLE1BQUk7QUFDWCxxQkFBYSxHQUFHLE1BQU07QUFBQSxNQUMxQixHQUFFLEdBQUc7QUFBQSxJQUlULENBQUM7QUFBQSxFQUVULEdBQUcsQ0FBQyxPQUFPLENBQUM7QUFDWixNQUFJLFlBQVUsUUFBUSxNQUFNLEdBQUcsRUFBRSxTQUFPO0FBQ3hDLE1BQUksWUFBVSxHQUFHO0FBQ2QsZ0JBQVksWUFBVTtBQUFBLEVBQ3pCO0FBQ0EsTUFBSSxRQUFRLE1BQU07QUFDZCxRQUFHO0FBQ0MsWUFBTSxPQUFPLE9BQU8sUUFBUTtBQUM1QixZQUFNLFdBQVcsVUFBVSxRQUFBLEVBQVUsT0FBTyxXQUFXO0FBRXZELGNBQVEsWUFBWSxJQUFJLElBQUksQ0FBQyxHQUFHLEdBQUcsTUFBTTtBQUNyQyxjQUFNLGFBQWEsSUFBSSxPQUFPLEtBQUssS0FBSztBQUN4QyxjQUFNLElBQUksRUFBRSxPQUFBLEVBQVMsVUFBVSxTQUFTO0FBQ3hDLFlBQUksS0FBSyxTQUFTLFlBQVcsR0FBRSxDQUFDO0FBQ2hDLGdCQUFRLEVBQUUsS0FBSyxVQUFVLEdBQUcsQ0FBQyxHQUFBO0FBQUEsVUFDekIsS0FBSztBQUNELGlCQUFHLFNBQVMsSUFBRyxLQUFLLFFBQU0sSUFBRyxnQkFBZ0I7QUFDN0MsbUJBQU87QUFBQSxVQUNYO0FBQ0ksaUJBQUcsU0FBUyxJQUFHLEtBQUssUUFBTSxHQUFFLFFBQVE7QUFDcEMsbUJBQU87QUFBQSxRQUFBO0FBQUEsTUFFbkIsQ0FBQztBQUFBLElBQ0wsU0FBTyxLQUFJO0FBQ1AsYUFBTyxDQUFBO0FBQUEsSUFDWDtBQUFBLEVBQ0o7QUFDQSxRQUFNLGVBQWEsQ0FBQyxjQUFZO0FBQzVCLFVBQU0sV0FBVyxVQUFVLFFBQUEsRUFBVSxPQUFPLFdBQVc7QUFDdkQsVUFBTSxFQUFDLE9BQUFTLFFBQU8sY0FBYyxNQUFNLFFBQU8sRUFBQyxHQUFFLEVBQUEsR0FBRyxjQUFjLFFBQVEsZUFBZSxPQUFNLFFBQU8sa0JBQWlCLFdBQVU7QUFDNUgsVUFBTSxPQUFPLFNBQVMsQ0FBQztBQUd2QixZQUFPLE9BQU8sT0FBTyxDQUFBLE1BQUssTUFBSSxZQUFZLEVBQUUsS0FBSyxHQUFHLEdBQUE7QUFBQSxNQUNoRCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQ0QsaUJBQVEsb0JBQWtCLEVBQUMsTUFBSyxZQUFBLEdBQWMsTUFBQTtBQUFBLFVBQzFDLEtBQUs7QUFDRCx3QkFBWSxJQUFJO0FBQ2hCLHlCQUFhLElBQUk7QUFFakI7QUFBQSxVQUNKLEtBQUs7QUFDRCx1QkFBVztBQUFBLEVBQVcsS0FBSyxRQUFRLEVBQUU7QUFFckM7QUFBQSxVQUNKLEtBQUs7QUFDRCx1QkFBVztBQUFBLEVBQVcsS0FBSyxRQUFRLEVBQUU7QUFFckM7QUFBQSxRQUFBO0FBRVI7QUFBQSxNQUNKLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFDRCxpQkFBUSxvQkFBa0IsRUFBQyxNQUFLLFlBQUEsR0FBYyxNQUFBO0FBQUEsVUFDMUMsS0FBSztBQUNELGlCQUFLLEtBQUssVUFBVSxTQUFRLFVBQVUsRUFBRSxFQUFFLEtBQUssQ0FBQSxNQUFLO0FBQ2hELG9CQUFNQyxNQUFHLFVBQVUsS0FBQTtBQUNSQSxrQkFBRyxVQUFVLE9BQU8sV0FBVztBQUMxQywyQkFBYUEsR0FBRTtBQUFBLFlBRW5CLENBQUM7QUFDRDtBQUFBLFVBQ0osS0FBSztBQUNELGlCQUFLLE1BQUE7QUFDTCxrQkFBTSxLQUFHLFVBQVUsS0FBQTtBQUNSLGVBQUcsVUFBVSxPQUFPLFdBQVc7QUFDMUMseUJBQWEsRUFBRTtBQUVmO0FBQUEsVUFDSixLQUFLO0FBQ0Qsd0JBQVksSUFBSTtBQUNoQix3QkFBWSxJQUFJO0FBRWhCO0FBQUEsVUFDSixLQUFLO0FBQ0QsdUJBQVc7QUFBQSxFQUFXLEtBQUssUUFBUSxFQUFFO0FBRXJDO0FBQUEsVUFDSixLQUFLO0FBQ0QsdUJBQVc7QUFBQSxFQUFZLEtBQUssUUFBUSxFQUFFO0FBRXRDO0FBQUEsVUFDSixLQUFLO0FBQ0QsdUJBQVc7QUFBQSxFQUFXLEtBQUssUUFBUSxFQUFFO0FBRXJDO0FBQUEsVUFDSixLQUFLO0FBQ0QsdUJBQVc7QUFBQSxFQUFXLEtBQUssUUFBUSxFQUFFO0FBRXJDO0FBQUEsUUFBQTtBQUVSO0FBQUEsTUFDSjtBQUNJLGNBQU0sSUFBSSxNQUFNLGdDQUFnQyxNQUFNLEdBQUc7QUFBQSxJQUFBO0FBQUEsRUFFckU7QUFDQSxRQUFNLGNBQVksTUFBSTtBQUNsQixRQUFHLENBQUMsV0FBWSxRQUFPUiw4QkFBQUEsSUFBQyxTQUFJLEtBQUssR0FBRyxNQUFNLEdBQUcsT0FBTyxHQUFHLFFBQVEsR0FBRyxTQUFTLEtBQUk7QUFDL0UsVUFBTSxFQUFDLFFBQUFTLFNBQU8sY0FBYSxZQUFXO0FBQ3RDLFdBQU9ULDhCQUFBQTtBQUFBQSxNQUFDO0FBQUEsTUFBQTtBQUFBLFFBQ0osS0FBSyxhQUFhO0FBQUEsUUFBRyxNQUFNLGFBQWE7QUFBQSxRQUN4QyxPQUFPLFFBQVE7QUFBQSxRQUFRLFFBQVE7QUFBQSxRQUMvQixPQUFPLEVBQUMsU0FBUyxLQUFBO0FBQUEsUUFDakI7QUFBQSxNQUFBO0FBQUEsTUFKYSxXQUFXLEtBQUssT0FBQSxDQUFRLElBQUksS0FBSyxLQUFLO0FBQUEsSUFBQTtBQUFBLEVBTTNEO0FBQ0EsU0FDSUQsOEJBQUFBLEtBQUFXLHdCQUFBLEVBQ0EsVUFBQTtBQUFBLElBQUFYLDhCQUFBQSxLQUFDLE9BQUEsRUFBSyxHQUFHLFVBQVUsS0FBSyxRQUNwQixVQUFBO0FBQUEsTUFBQUMsOEJBQUFBO0FBQUFBLFFBQUM7QUFBQSxRQUFBO0FBQUEsVUFDRyxXQUFXLEVBQUUsSUFBSSxLQUFLLE9BQU8sRUFBRSxJQUFHLFFBQVEsSUFBSSxTQUFPO0FBQUEsVUFDckQsS0FBSztBQUFBLFVBQ0wsUUFBUTtBQUFBLFVBQ1IsT0FBTyxNQUFBO0FBQUEsVUFDUCxNQUFJO0FBQUEsVUFBQyxPQUFLO0FBQUEsVUFDVixPQUFPLEVBQUUsVUFBVSxFQUFFLElBQUksU0FBTztBQUFBLFVBQ2hDO0FBQUEsVUFDQSxjQUFjTTtBQUFBQSxRQUFBO0FBQUEsTUFBQTtBQUFBLE1BR2pCLFlBQVUsQ0FBQTtBQUFBLE1BQ1YsU0FBTyxZQUFBLElBQWMsQ0FBQTtBQUFBLElBQUMsR0FDM0I7QUFBQSxJQUNDLFdBQ0dOLDhCQUFBQTtBQUFBQSxNQUFDO0FBQUEsTUFBQTtBQUFBLFFBQ0csT0FBTztBQUFBLFFBQ1AsT0FBTTtBQUFBLFFBQ04sU0FBUyxNQUFNLFdBQVcsS0FBSztBQUFBLFFBRS9CLFVBQUFBLDhCQUFBQSxJQUFDLFVBQU0sVUFBQSxRQUFBLENBQVE7QUFBQSxNQUFBO0FBQUEsSUFBQTtBQUFBLEVBQ25CLEdBRVI7QUFFSjtBQ25NQSxTQUF3QixtQkFBbUI7QUFBQSxFQUN2QyxRQUFRO0FBQUEsRUFDUixRQUFRO0FBQUEsRUFDUixTQUFTO0FBQUEsRUFDVDtBQUNKLEdBQUc7QUFDQyxRQUFNLENBQUMsVUFBVSxXQUFXLElBQUksTUFBTSxTQUFTLElBQUk7QUFFbkQsU0FDSUQsOEJBQUFBO0FBQUFBLElBQUM7QUFBQSxJQUFBO0FBQUEsTUFDRyxLQUFJO0FBQUEsTUFDSixNQUFLO0FBQUEsTUFDTCxRQUFRLEVBQUUsTUFBTSxPQUFBO0FBQUEsTUFDaEIsT0FBTyxFQUFFLElBQUksU0FBUyxJQUFJLFFBQUE7QUFBQSxNQUMxQixNQUFJO0FBQUEsTUFDSixPQUFLO0FBQUEsTUFDTCxXQUFTO0FBQUEsTUFFVCxPQUFPLENBQUMsSUFBSSxRQUFRO0FBQ2hCLFlBQUksSUFBSSxTQUFTLFNBQVUsZ0JBQWUsSUFBSTtBQUFBLE1BQ2xEO0FBQUEsTUFDQSxPQUFPLFdBQVMsU0FBUyxXQUFTO0FBQUEsTUFDbEMsU0FBUztBQUFBLE1BQ1QsYUFBYSxDQUFDLE9BQU0sT0FBTSxPQUFNLFdBQVM7QUFBQyxlQUFPLE1BQU0sS0FBSyxRQUFRLEdBQUcsSUFBRTtBQUFBLE1BQUU7QUFBQSxNQUMzRSxhQUFhLENBQUMsY0FBYztBQUV4QixvQkFBWSxTQUFTO0FBQUEsTUFDekI7QUFBQSxNQUNBLGNBQWMsTUFBSTtBQUFBLE1BQUM7QUFBQSxNQUVuQixVQUFBO0FBQUEsUUFBQUMsOEJBQUFBO0FBQUFBLFVBQUM7QUFBQSxVQUFBO0FBQUEsWUFDRyxPQUFLO0FBQUEsWUFDTCxNQUFJO0FBQUEsWUFDSixPQUFLO0FBQUEsWUFDTCxXQUFTO0FBQUEsWUFDVCxTQUFPO0FBQUEsWUFDUCxNQUFNO0FBQUEsWUFDTixRQUFRO0FBQUEsWUFDUixRQUFRO0FBQUEsWUFDUixPQUFPO0FBQUEsWUFDUCxRQUFRO0FBQUEsWUFDUixPQUFPO0FBQUEsWUFDUCxPQUFPLEVBQUMsSUFBRyxXQUFVLElBQUcsV0FBVSxPQUFNLEVBQUMsSUFBRyxXQUFVLElBQUcsVUFBQSxFQUFTO0FBQUEsWUFDbEUsU0FBUyxNQUFNO0FBRVgsNkJBQWUsUUFBUTtBQUFBLFlBQzNCO0FBQUEsWUFDQSxTQUFTO0FBQUEsVUFBQTtBQUFBLFFBQUE7QUFBQSxRQUViQSw4QkFBQUE7QUFBQUEsVUFBQztBQUFBLFVBQUE7QUFBQSxZQUNPLE9BQUs7QUFBQSxZQUNMLE1BQUk7QUFBQSxZQUNKLE9BQUs7QUFBQSxZQUNMLFdBQVM7QUFBQSxZQUNULFNBQU87QUFBQSxZQUNQLE9BQU87QUFBQSxZQUNQLFFBQVE7QUFBQSxZQUNSLFFBQVE7QUFBQSxZQUNSLFFBQVE7QUFBQSxZQUNSLE9BQU87QUFBQSxZQUNQLE9BQU87QUFBQSxZQUNQLE9BQU8sRUFBQyxJQUFHLFdBQVUsSUFBRyxXQUFVLE9BQU0sRUFBQyxJQUFHLFdBQVUsSUFBRyxVQUFBLEVBQVM7QUFBQSxZQUNwRSxTQUFTLE1BQU07QUFDWCw2QkFBZSxJQUFJO0FBQUEsWUFDdkI7QUFBQSxZQUNFLFNBQVM7QUFBQSxVQUFBO0FBQUEsUUFBQTtBQUFBLE1BQ2pCO0FBQUEsSUFBQTtBQUFBLEVBQUE7QUFHWjtBQ2hFTyxTQUFTLE1BQU0sRUFBRSxVQUFVLEdBQUcsWUFBVztBQUM1QyxRQUFNLE9BQU8sTUFBTSxTQUFTLFFBQVEsUUFBUSxFQUN2QyxPQUFPLENBQUEsVUFBUyxNQUFNLGVBQWUsS0FBSyxLQUFLLE1BQU0sTUFBTSxJQUFJO0FBRXBFLFFBQU0sQ0FBQyxhQUFhLGNBQWMsSUFBSUksTUFBQUEsU0FBUyxDQUFDO0FBQ2hELFFBQU0sbUJBQWlCLEVBQUMsSUFBRyxXQUFVLElBQUcsV0FBVSxPQUFNLEVBQUMsSUFBRyxXQUFVLElBQUcsVUFBQSxFQUFTO0FBRWxGLFNBQ0lKLDhCQUFBQSxJQUFDLE9BQUEsRUFBSyxHQUFHLFVBQ1QsVUFBQUQsOEJBQUFBLEtBQUNZLHNCQUFBQSxNQUFBLEVBQUssTUFBTSxHQUFHLE1BQU0sR0FBRyxZQUFVLE1BRTlCLFVBQUE7QUFBQSxJQUFBWCw4QkFBQUEsSUFBQyxPQUFBLEVBQUksS0FBSyxHQUFHLEtBQUssR0FBRyxTQUFTLEdBQUcsU0FBUyxHQUNyQyxVQUFBLEtBQUssSUFBSSxDQUFDLEtBQUssTUFBTTtBQUNsQixhQUNJQSw4QkFBQUE7QUFBQUEsUUFBQztBQUFBLFFBQUE7QUFBQSxVQUVHLEtBQUssSUFBSTtBQUFBLFVBQ1QsUUFBUTtBQUFBLFVBQ1IsTUFBTTtBQUFBLFVBQ04sT0FBSztBQUFBLFVBQ0wsV0FBUztBQUFBLFVBQ1QsU0FBUyxNQUFNO0FBQ1gsMkJBQWUsQ0FBQztBQUNoQixnQkFBRztBQUNDLG1CQUFLLENBQUMsRUFBRSxNQUFNLFdBQUE7QUFBQSxZQUNsQixTQUFPLEtBQUk7QUFBQSxZQUFDO0FBQUEsVUFDaEI7QUFBQSxVQUNBLE9BQU8sRUFBQyxHQUFHLGtCQUFrQixTQUFVLGVBQWUsRUFBQTtBQUFBLFVBQ3RELFNBQVMsUUFBTSxJQUFJLE1BQU07QUFBQSxRQUFBO0FBQUEsUUFicEIsSUFBSSxNQUFNO0FBQUEsTUFBQTtBQUFBLElBZ0IzQixDQUFDLEVBQUEsQ0FDTDtBQUFBLElBR0FBLDhCQUFBQSxJQUFDLE9BQUEsRUFBSSxLQUFLLEdBQUcsS0FBSyxHQUFHLFNBQVMsR0FBRyxTQUFTLEdBQ3JDLFVBQUEsS0FBSyxXQUFXLEVBQUUsTUFBTSxTQUFBLENBQzdCO0FBQUEsRUFBQSxFQUFBLENBQ0osRUFBQSxDQUNBO0FBRVI7QUFLTyxTQUFTLElBQUksRUFBRSxZQUFZO0FBQzlCLHFFQUFVLFVBQVM7QUFDdkI7QUNuRE8sTUFBTSxVQUFVO0FBQUEsRUFDckIsSUFBSTtBQUFBLEVBQUksSUFBSTtBQUFBLEVBQUksSUFBSTtBQUFBLEVBQUksSUFBSTtBQUFBO0FBQUEsRUFFNUIsWUFBWSxHQUFHLEdBQUcsR0FBRyxHQUFHO0FBQUUsU0FBSyxJQUFJO0FBQUcsU0FBSyxJQUFJO0FBQUcsU0FBSyxJQUFJO0FBQUcsU0FBSyxJQUFJO0FBQUEsRUFBRztBQUFBO0FBQUEsRUFFMUUsT0FBTyxXQUFXRSxTQUFRO0FBQ3hCLFdBQU8sSUFBSSxVQUFVQSxRQUFPLFdBQVdBLFFBQU8sV0FBV0EsUUFBTyxlQUFlQSxRQUFPLGNBQWM7QUFBQSxFQUN0RztBQUNGO0FBRU8sTUFBTSxZQUFZO0FBQUEsRUFDdkIsSUFBSTtBQUFBLEVBQUksSUFBSTtBQUFBLEVBQUksT0FBTztBQUFBLEVBQUssUUFBUSxDQUFBO0FBQUEsRUFDcEMsWUFBWSxHQUFHLEdBQUcsTUFBTSxPQUFPO0FBQzdCLFNBQUssSUFBSSxPQUFPLE1BQU0sV0FBVyxJQUFJO0FBQ3JDLFNBQUssSUFBSSxPQUFPLE1BQU0sV0FBVyxJQUFJO0FBQ3JDLFNBQUssT0FBTyxPQUFPLFNBQVMsV0FBVyxPQUFPO0FBQzlDLFNBQUssUUFBUSxTQUFTLENBQUE7QUFBQSxFQUN4QjtBQUFBO0FBQUEsRUFFQSxVQUFVLGFBQWE7QUFDckIsV0FDSSxLQUFLLEtBQUssWUFBWSxLQUFLLEtBQUssS0FBTSxZQUFZLElBQUksWUFBWSxLQUNsRSxLQUFLLEtBQUssWUFBWSxLQUFLLEtBQUssS0FBTSxZQUFZLElBQUksWUFBWTtBQUFBLEVBRXhFO0FBQUEsRUFDQSxPQUFPO0FBQ0wsVUFBTVUsTUFBSyxJQUFJLFlBQVc7QUFDMUIsSUFBQUEsSUFBRyxJQUFJLEtBQUs7QUFBRyxJQUFBQSxJQUFHLElBQUksS0FBSztBQUFHLElBQUFBLElBQUcsT0FBTyxLQUFLO0FBQU0sSUFBQUEsSUFBRyxRQUFRLEVBQUUsR0FBRyxLQUFLLE1BQUs7QUFDN0UsV0FBT0E7QUFBQSxFQUNUO0FBQ0Y7QUFFTyxNQUFNLDBCQUEwQjtBQUFBO0FBQUEsRUFDVixRQUFRLElBQUksWUFBVztBQUFBO0FBQUEsRUFDdkIsTUFBTSxJQUFJLFlBQVc7QUFBQTtBQUFBLEVBRWhELFlBQVksT0FBTztBQUFFLFNBQUssUUFBUSxNQUFNLEtBQUk7QUFBQSxFQUFJO0FBQUE7QUFBQSxFQUVoRCxVQUFVLGFBQWE7QUFBRSxXQUFPLEtBQUssTUFBTSxVQUFVLFdBQVcsS0FBSyxLQUFLLElBQUksVUFBVSxXQUFXO0FBQUEsRUFBRztBQUFBO0FBQUEsRUFFdEcsT0FBTyxLQUFLO0FBQUUsU0FBSyxNQUFNO0FBQUssV0FBTztBQUFBLEVBQU07QUFBQSxFQUMzQyxPQUFPO0FBQUUsVUFBTUEsTUFBSyxJQUFJLDBCQUEwQixLQUFLLE1BQU0sS0FBSSxDQUFFO0FBQUcsSUFBQUEsSUFBRyxPQUFPLEtBQUssR0FBRztBQUFHLFdBQU9BO0FBQUEsRUFBSTtBQUN4RztBQUtPLE1BQU0saUJBQWlCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUs1QixZQUFZLFVBQVUsWUFBWTtBQUNoQyxTQUFLLFdBQVc7QUFDaEIsU0FBSyxZQUFZO0FBQUcsU0FBSyxZQUFZO0FBQ3JDLFNBQUssaUJBQWlCLFdBQVc7QUFBTSxTQUFLLGdCQUFnQixXQUFXO0FBQ3ZFLFNBQUssUUFBUSxDQUFBO0FBRWIsU0FBSyxTQUFTLENBQUE7QUFDZCxTQUFLLFlBQVksU0FBVSxNQUFNLFlBQVk7QUFBRSxhQUFPLEtBQUssTUFBTSxHQUFHLEVBQUUsUUFBUSxPQUFLLENBQUMsR0FBRyxHQUFHLENBQUM7QUFBQSxJQUFHO0FBQzlGLFNBQUssZUFBZTtBQUNwQixTQUFLLFNBQVM7QUFFZSxTQUFLLFVBQVUsQ0FBQTtBQUNJLFNBQUssY0FBYztBQUN4QixTQUFLLGFBQWEsQ0FBQTtBQUU3RCxTQUFLLFlBQVksUUFBUTtBQUFBLEVBQzNCO0FBQUE7QUFBQSxFQUdBLFlBQVksVUFBVTtBQUNwQixTQUFLLFdBQVc7QUFDaEIsVUFBTSxPQUFPLFNBQVMsTUFBTSxHQUFHLEVBQUUsSUFBRyxLQUFNLElBQUksWUFBVztBQUN6RCxTQUFLLFlBQVksa0JBQWtCLEdBQUc7QUFDdEMsU0FBSyxRQUFRLEdBQUcsYUFBYSxVQUFVLEVBQUUsVUFBVSxRQUFPLENBQUUsRUFBRSxNQUFNLElBQUk7QUFDeEUsU0FBSyxhQUFZO0FBQUEsRUFDbkI7QUFBQSxFQUVBLE9BQU87QUFDTCxpQkFBYSxLQUFLLFlBQVk7QUFDOUIsU0FBSyxlQUFlLFdBQVcsTUFBTTtBQUNuQyxTQUFHLGNBQWMsS0FBSyxVQUFVLEtBQUssTUFBTSxLQUFLLElBQUksQ0FBQztBQUNyRCxXQUFLLFNBQVMsVUFBUyxvQkFBSSxLQUFJLEdBQUcsWUFBVyxDQUFFO0FBQUEsSUFDakQsR0FBRyxHQUFJO0FBQUEsRUFDVDtBQUFBO0FBQUEsRUFHQSxpQkFBaUIsWUFBWTtBQUMzQixRQUFJLGFBQWEsS0FBSyxjQUFjLEtBQUssTUFBTSxPQUFRO0FBQ3ZELFNBQUssT0FBTyxVQUFVLElBQUksS0FBSyxVQUFVLEtBQUssTUFBTSxVQUFVLEdBQUcsVUFBVSxLQUFLLENBQUE7QUFBQSxFQUNsRjtBQUFBLEVBRUEsZUFBZTtBQUNiLFNBQUssU0FBUyxLQUFLLE1BQU0sSUFBSSxDQUFDLE1BQU0sTUFBTSxLQUFLLFVBQVUsTUFBTSxDQUFDLEtBQUssQ0FBQSxDQUFFO0FBQUEsRUFDekU7QUFBQTtBQUFBLEVBR0EsZUFBZSxHQUFHO0FBQ2hCLFVBQU0sT0FBTyxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sU0FBUyxLQUFLLGNBQWM7QUFDaEUsU0FBSyxZQUFZLE1BQU0sS0FBSyxZQUFZLEdBQUcsR0FBRyxJQUFJO0FBQUEsRUFDcEQ7QUFBQSxFQUVBLG9CQUFvQixRQUFRO0FBQzFCLFFBQUksT0FBTyxJQUFJLEtBQUssVUFBVyxNQUFLLFlBQVksT0FBTztBQUFBLGFBQzlDLE9BQU8sS0FBTSxLQUFLLFlBQVksS0FBSyxlQUFpQixNQUFLLFlBQVksT0FBTyxJQUFJLEtBQUssaUJBQWlCO0FBRS9HLFFBQUksT0FBTyxJQUFJLEtBQUssVUFBVyxNQUFLLFlBQVksT0FBTztBQUFBLGFBQzlDLE9BQU8sS0FBSyxLQUFLLFlBQVksS0FBSyxjQUFlLE1BQUssWUFBWSxPQUFPLElBQUksS0FBSyxnQkFBZ0I7QUFBQSxFQUM3RztBQUFBLEVBRUEsb0JBQW9CO0FBRWxCLFdBQU8sS0FBSyxLQUFLLEtBQUssTUFBTSxLQUFLLElBQUksR0FBRyxLQUFLLGlCQUFpQixLQUFLLFNBQVMsQ0FBQyxDQUFDLElBQUk7QUFBQSxFQUNwRjtBQUFBLEVBRUEsZ0JBQWdCLGFBQWEsa0JBQWtCO0FBQzdDLFVBQU0sRUFBRSxJQUFJLEdBQUUsSUFBSztBQUNuQixVQUFNLE1BQU0sS0FBSyxrQkFBaUI7QUFDbEMsVUFBTSxLQUFNLFlBQVksSUFBSSxLQUFLLE1BQU0sSUFBSyxLQUFLO0FBQ2pELFVBQU0sS0FBTSxZQUFZLElBQUksS0FBSyxJQUFLLEtBQUs7QUFDM0MsV0FBTyxLQUFLLFVBQVUsRUFBRSxHQUFHLElBQUksR0FBRyxJQUFJO0FBQUEsRUFDeEM7QUFBQTtBQUFBO0FBQUEsRUFJQSxVQUFVLEVBQUUsR0FBRyxLQUFLO0FBQ2xCLFVBQU0sT0FBTyxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sU0FBUyxDQUFDO0FBQzlDLFFBQUksTUFBTSxTQUFTLEtBQUssR0FBRyxFQUFFLEdBQUcsR0FBRyxJQUFJO0FBQ3ZDLFVBQU0sT0FBTyxLQUFLLE1BQU0sQ0FBQyxLQUFLO0FBQzlCLFFBQUksTUFBTSxTQUFTLEtBQUssR0FBRyxFQUFFLEdBQUcsR0FBRyxLQUFLLE1BQU07QUFFOUMsVUFBTSxNQUFNLElBQUksWUFBWSxHQUFHLEdBQUcsS0FBSyxDQUFDLEtBQUssR0FBRztBQUNoRCxVQUFNLGFBQWMsS0FBSyxPQUFPLENBQUMsS0FBSyxDQUFBO0FBR3RDLFVBQU0sS0FBSyxXQUFXO0FBQUEsTUFBSyxPQUN2QixLQUFLLE9BQU8sRUFBRSxVQUFVLGVBQWUsT0FBTyxFQUFFLFFBQVEsZUFBZSxLQUFLLENBQUMsRUFBRSxTQUFTLEtBQUssQ0FBQyxFQUFFO0FBQUEsSUFDeEc7QUFFSSxRQUFJLFFBQVEsTUFBTSxHQUFHLFFBQVEsR0FBRyxRQUFRLEVBQUUsSUFBSSxXQUFXLElBQUksVUFBUztBQUN0RSxXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUEsRUFHQSxpQkFBaUI7QUFDZixVQUFNLE1BQU0sQ0FBQTtBQUNaLFVBQU0sS0FBSyxLQUFLLFdBQVcsS0FBSyxLQUFLLFlBQVksS0FBSztBQUN0RCxhQUFTLElBQUksSUFBSSxLQUFLLEtBQUssSUFBSSxJQUFJLEtBQUssTUFBTSxTQUFTLENBQUMsR0FBRyxJQUFLLEtBQUksQ0FBQyxJQUFJLEtBQUssT0FBTyxDQUFDO0FBQ3RGLFdBQU87QUFBQSxFQUNUO0FBQUE7QUFBQSxFQUdBLFFBQVEsYUFBYSxrQkFBa0I7QUFDckMsUUFBSSxhQUFhO0FBQ2pCLFFBQUksYUFBYTtBQUNqQixVQUFNLFNBQVMsTUFBTSxLQUFLLFlBQVksT0FBTyxDQUFBLENBQUUsRUFBRSxPQUFPLE9BQUssTUFBTSxFQUFFLEVBQUU7QUFFdkUsWUFBUSxZQUFZLFFBQU07QUFBQSxNQUN4QixLQUFLLGFBQWE7QUFDaEIsY0FBTSxNQUFNLEtBQUssZ0JBQWdCLGFBQWEsZ0JBQWdCO0FBQzlELGFBQUssY0FBYyxJQUFJLDBCQUEwQixHQUFHO0FBQ3BELGFBQUssWUFBWSxPQUFPLEdBQUc7QUFDM0IsWUFBSSxZQUFZLEtBQU0sTUFBSyxRQUFRLEtBQUssR0FBRztBQUFBLFlBQVEsTUFBSyxVQUFVLENBQUMsR0FBRztBQUN0RSxxQkFBYTtBQUNiO0FBQUEsTUFDRjtBQUFBLE1BQ0EsS0FBSyxhQUFhO0FBQ2hCLFlBQUksS0FBSyxZQUFhLE1BQUssWUFBWSxPQUFPLEtBQUssZ0JBQWdCLGFBQWEsZ0JBQWdCLENBQUM7QUFDakcscUJBQWE7QUFDYjtBQUFBLE1BQ0Y7QUFBQSxNQUNBLEtBQUssV0FBVztBQUNkLFlBQUksS0FBSyxhQUFhO0FBQ3BCLGNBQUksWUFBWSxLQUFNLE1BQUssV0FBVyxLQUFLLEtBQUssWUFBWSxNQUFNO0FBQUEsY0FDN0QsTUFBSyxhQUFhLENBQUMsS0FBSyxZQUFZLEtBQUksQ0FBRTtBQUFBLFFBQ2pEO0FBQ0EscUJBQWE7QUFDYixhQUFLLGNBQWM7QUFDbkI7QUFBQSxNQUNGO0FBQUEsTUFDQSxLQUFLO0FBQVcsYUFBSyxlQUFlLENBQUMsTUFBTTtBQUFHLHFCQUFhO0FBQU07QUFBQSxNQUNqRSxLQUFLO0FBQWEsYUFBSyxlQUFlLENBQUMsTUFBTTtBQUFHLHFCQUFhO0FBQU07QUFBQSxNQUNuRTtBQUFTLGNBQU0sSUFBSSxNQUFNLGNBQWMsV0FBVyxDQUFDO0FBQUEsSUFDekQ7QUFDSSxXQUFPLENBQUMsWUFBWSxVQUFVO0FBQUEsRUFDaEM7QUFBQTtBQUFBLEVBR0EsTUFBTSxJQUFJLEtBQUssV0FBVyxNQUFNO0FBQUEsRUFBRSxHQUFHO0FBQ25DLFFBQUksYUFBYTtBQUNqQixRQUFJLGFBQWE7QUFFakIsVUFBTSxVQUFVLFFBQU07QUFBRSxXQUFLLFVBQVUsS0FBSyxRQUFRLElBQUksU0FBTyxHQUFHLEdBQUcsQ0FBQztBQUFBLElBQUc7QUFFekUsWUFBUSxJQUFJLE1BQUk7QUFBQSxNQUNkLEtBQUs7QUFBTSxnQkFBUSxTQUFPLEtBQUssYUFBYSxHQUFHLENBQUM7QUFBRyxZQUFJLENBQUMsSUFBSSxLQUFNLE1BQUssY0FBYztBQUFNLHFCQUFhO0FBQU07QUFBQSxNQUM5RyxLQUFLO0FBQVEsZ0JBQVEsU0FBTyxLQUFLLGVBQWUsR0FBRyxDQUFDO0FBQUcsWUFBSSxDQUFDLElBQUksS0FBTSxNQUFLLGNBQWM7QUFBTSxxQkFBYTtBQUFNO0FBQUEsTUFDbEgsS0FBSztBQUNILFlBQUksSUFBSSxLQUFNLFNBQVEsU0FBTyxLQUFLLFVBQVUsR0FBRyxDQUFDO0FBQUEsWUFBUSxTQUFRLFNBQU8sS0FBSyxlQUFlLEdBQUcsQ0FBQztBQUMvRixZQUFJLENBQUMsSUFBSSxLQUFNLE1BQUssY0FBYztBQUFNLHFCQUFhO0FBQU07QUFBQSxNQUM3RCxLQUFLO0FBQ0gsWUFBSSxJQUFJLEtBQU0sU0FBUSxTQUFPLEtBQUssV0FBVyxHQUFHLENBQUM7QUFBQSxZQUFRLFNBQVEsU0FBTyxLQUFLLGdCQUFnQixHQUFHLENBQUM7QUFDakcsWUFBSSxDQUFDLElBQUksS0FBTSxNQUFLLGNBQWM7QUFBTSxxQkFBYTtBQUFNO0FBQUEsTUFDN0QsS0FBSztBQUFRLGdCQUFRLFNBQU8sS0FBSyxVQUFVLEVBQUUsR0FBRyxHQUFHLEdBQUcsSUFBSSxFQUFDLENBQUUsQ0FBQztBQUFHLHFCQUFhO0FBQU07QUFBQSxNQUNwRixLQUFLO0FBQU8sZ0JBQVEsU0FBTyxLQUFLLFVBQVUsRUFBRSxHQUFHLEtBQUssTUFBTSxJQUFJLENBQUMsRUFBRSxRQUFRLEdBQUcsSUFBSSxFQUFDLENBQUUsQ0FBQztBQUFHLHFCQUFhO0FBQU07QUFBQSxNQUMxRyxLQUFLO0FBQVUsYUFBSyxlQUFlLENBQUMsS0FBSyxjQUFjO0FBQUcscUJBQWE7QUFBTTtBQUFBLE1BQzdFLEtBQUs7QUFBWSxhQUFLLGVBQWUsQ0FBQyxLQUFLLGNBQWM7QUFBRyxxQkFBYTtBQUFNO0FBQUEsTUFFL0UsS0FBSztBQUFhLGFBQUssUUFBUSxRQUFRLFNBQU8sS0FBSyxVQUFVLEdBQUcsQ0FBQztBQUFHLHFCQUFhO0FBQU07QUFBQSxNQUN2RixLQUFLO0FBQVUsYUFBSyxRQUFRLFFBQVEsU0FBTyxLQUFLLE9BQU8sR0FBRyxDQUFDO0FBQUcscUJBQWE7QUFBTTtBQUFBLE1BRWpGLEtBQUs7QUFDSCxhQUFLLHFCQUFxQixDQUFDLEtBQUssTUFBTTtBQUFFLGNBQUksS0FBSztBQUFHLGVBQUssT0FBTyxNQUFNLEdBQUc7QUFBRyxjQUFJLEtBQUs7QUFBRyxjQUFJLElBQUk7QUFBQSxRQUFHLENBQUM7QUFDcEcscUJBQWE7QUFBTTtBQUFBLE1BRXJCLEtBQUs7QUFDSCxhQUFLLHFCQUFxQixTQUFPO0FBQUUsZUFBSyxPQUFPLEtBQU0sR0FBRztBQUFBLFFBQUcsQ0FBQztBQUM1RCxxQkFBYTtBQUFNO0FBQUEsTUFFckIsS0FBSyxPQUFPO0FBQ1YsY0FBTSxPQUFPLEtBQUssV0FBVyxRQUFRLE9BQUs7QUFDeEMsZ0JBQU0sUUFBUSxDQUFBO0FBQ2QsZ0JBQU0sS0FBSyxLQUFLLElBQUksRUFBRSxNQUFNLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRyxLQUFLLEtBQUssSUFBSSxFQUFFLE1BQU0sR0FBRyxFQUFFLElBQUksQ0FBQztBQUN6RSxnQkFBTSxLQUFLLEtBQUssSUFBSSxFQUFFLE1BQU0sR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHLEtBQUssS0FBSyxJQUFJLEVBQUUsTUFBTSxHQUFHLEVBQUUsSUFBSSxDQUFDO0FBQ3pFLG1CQUFTLElBQUksSUFBSSxLQUFLLElBQUksS0FBSztBQUM3QixrQkFBTSxPQUFPLEtBQUssTUFBTSxDQUFDLEtBQUs7QUFDOUIsa0JBQU0sT0FBUSxNQUFNLEtBQU0sS0FBSztBQUMvQixrQkFBTSxLQUFNLE1BQU0sS0FBTSxLQUFLLElBQUksS0FBSztBQUN0QyxrQkFBTSxLQUFLLEtBQUssVUFBVSxNQUFNLEVBQUUsQ0FBQztBQUFBLFVBQ3JDO0FBQ0EsaUJBQU87QUFBQSxRQUNULENBQUMsRUFBRSxLQUFLLElBQUk7QUFDWkMsdUJBQWMsTUFBTSxNQUFNO0FBQUEsUUFBQyxDQUFDO0FBQzVCO0FBQUEsTUFDRjtBQUFBLE1BQ0EsS0FBSyxPQUFPO0FBQUUsY0FBTSxJQUFJLE1BQU0saUNBQWlDO0FBQUEsTUFBRztBQUFBLE1BQ2xFLFNBQVM7QUFDUCxjQUFNLFlBQWEsSUFBSSxZQUFZLElBQUksU0FBUyxXQUFXLElBQUssSUFBSSxXQUM3RCxJQUFJLFFBQVEsSUFBSSxLQUFLLFdBQVcsSUFBSyxJQUFJLE9BQ3JDLE1BQU0sR0FBRyxTQUFTLEtBQUs7QUFDbEMsWUFBSSxXQUFXO0FBQUUsZUFBSyxRQUFRLFFBQVEsU0FBTyxLQUFLLE9BQU8sV0FBVyxHQUFHLENBQUM7QUFBRyx1QkFBYTtBQUFBLFFBQU07QUFBQSxNQUNoRztBQUFBLElBQ047QUFFSSxRQUFJLFdBQVksTUFBSyxLQUFJO0FBQ3pCLFdBQU8sQ0FBQyxZQUFZLFVBQVU7QUFBQSxFQUNoQztBQUFBLEVBRUEscUJBQXFCLElBQUk7QUFBRSxTQUFLLFFBQVEsU0FBUyxDQUFDLEdBQUcsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLEVBQUUsUUFBUSxFQUFFO0FBQUEsRUFBRztBQUFBO0FBQUE7QUFBQSxFQUdoRCxhQUFhLFFBQVE7QUFDdEQsUUFBSSxPQUFPLElBQUksR0FBRztBQUFFLGFBQU87QUFBSyxZQUFNLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQyxLQUFLO0FBQUksYUFBTyxJQUFJLEtBQUssSUFBSSxPQUFPLEdBQUcsS0FBSyxNQUFNO0FBQUcsV0FBSyxvQkFBb0IsTUFBTTtBQUFBLElBQUc7QUFDdkosV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBLEVBQ21DLGVBQWUsUUFBUTtBQUN4RCxRQUFLLE9BQU8sSUFBSSxJQUFLLEtBQUssTUFBTSxRQUFRO0FBQUUsWUFBTSxPQUFPLEtBQUssTUFBTSxPQUFPLElBQUksQ0FBQyxLQUFLO0FBQUksYUFBTyxJQUFJLEtBQUssSUFBSSxPQUFPLEdBQUcsS0FBSyxNQUFNO0FBQUcsYUFBTztBQUFLLFdBQUssb0JBQW9CLE1BQU07QUFBQSxJQUFHO0FBQ2pMLFdBQU87QUFBQSxFQUNUO0FBQUE7QUFBQSxFQUNtQyxlQUFlLFFBQVE7QUFDeEQsUUFBSSxPQUFPLElBQUksR0FBRztBQUFFLGFBQU87QUFBSyxXQUFLLG9CQUFvQixNQUFNO0FBQUEsSUFBRztBQUNsRSxXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUEsRUFDbUMsZ0JBQWdCLFFBQVE7QUFDekQsVUFBTSxPQUFPLEtBQUssTUFBTSxPQUFPLENBQUMsS0FBSztBQUNyQyxXQUFPLElBQUksS0FBSyxJQUFJLE9BQU8sSUFBSSxHQUFHLEtBQUssTUFBTTtBQUM3QyxTQUFLLG9CQUFvQixNQUFNO0FBQy9CLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxVQUFVLFFBQVE7QUFDaEIsVUFBTSxPQUFPLEtBQUssTUFBTSxPQUFPLENBQUMsS0FBSztBQUNyQyxRQUFJLElBQUksT0FBTyxJQUFJO0FBQ25CLFdBQU8sSUFBSSxLQUFLLEtBQUssQ0FBQyxNQUFNLElBQUs7QUFDakMsV0FBTyxJQUFJLEtBQUssS0FBSyxJQUFJLENBQUMsS0FBSyxLQUFLLEtBQUssS0FBSyxJQUFJLENBQUMsQ0FBQyxFQUFHO0FBQ3ZELFdBQU8sSUFBSSxNQUFNLEdBQUcsR0FBRyxLQUFLLE1BQU07QUFDbEMsU0FBSyxvQkFBb0IsTUFBTTtBQUMvQixXQUFPO0FBQUEsRUFDVDtBQUFBLEVBQ0EsV0FBVyxRQUFRO0FBQ2pCLFVBQU0sT0FBTyxLQUFLLE1BQU0sT0FBTyxDQUFDLEtBQUs7QUFDckMsUUFBSSxJQUFJLE9BQU87QUFDZixXQUFPLElBQUksS0FBSyxVQUFVLEtBQUssQ0FBQyxNQUFNLElBQUs7QUFDM0MsV0FBTyxJQUFJLEtBQUssVUFBVSxLQUFLLEtBQUssS0FBSyxDQUFDLENBQUMsRUFBRztBQUM5QyxXQUFPLElBQUksTUFBTSxHQUFHLEdBQUcsS0FBSyxNQUFNO0FBQ2xDLFNBQUssb0JBQW9CLE1BQU07QUFDL0IsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLHFCQUFxQixHQUFHLFFBQVE7QUFDOUIsUUFBSSxNQUFNLEVBQUcsUUFBTztBQUNwQixVQUFNLE1BQU0sS0FBSyxLQUFLLENBQUM7QUFDdkIsYUFBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLElBQUksQ0FBQyxHQUFHLEtBQUs7QUFDcEMsVUFBSSxNQUFNLEVBQUcsTUFBSyxlQUFlLE1BQU07QUFBQSxVQUFRLE1BQUssYUFBYSxNQUFNO0FBQUEsSUFDekU7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUE7QUFBQSxFQUlBLE9BQU8sTUFBTSxRQUFRO0FBQ25CLFVBQU0sT0FBTyxLQUFLLE1BQU0sT0FBTyxDQUFDLEtBQUs7QUFDckMsVUFBTSxTQUFTLEtBQUssVUFBVSxHQUFHLE9BQU8sQ0FBQztBQUN6QyxVQUFNLFFBQVEsS0FBSyxVQUFVLE9BQU8sQ0FBQztBQUVyQyxVQUFNLFFBQVEsT0FBTyxJQUFJLEVBQUUsTUFBTSxJQUFJO0FBQ3JDLFFBQUksTUFBTSxXQUFXLEdBQUc7QUFDdEIsV0FBSyxNQUFNLE9BQU8sQ0FBQyxJQUFJLFNBQVMsTUFBTSxDQUFDLElBQUk7QUFDM0MsV0FBSyxpQkFBaUIsT0FBTyxDQUFDO0FBQzlCLGFBQU8sS0FBSyxNQUFNLENBQUMsRUFBRTtBQUFBLElBQ3ZCLE9BQU87QUFDTCxZQUFNLFFBQVEsU0FBUyxNQUFNLENBQUM7QUFDOUIsWUFBTSxTQUFTLE1BQU0sTUFBTSxHQUFHLEVBQUU7QUFDaEMsWUFBTSxPQUFPLE1BQU0sTUFBTSxTQUFTLENBQUMsSUFBSTtBQUN2QyxZQUFNLFdBQVcsQ0FBQyxPQUFPLEdBQUcsUUFBUSxJQUFJO0FBQ3hDLFdBQUssTUFBTSxPQUFPLE9BQU8sR0FBRyxHQUFHLEdBQUcsUUFBUTtBQUMxQyxlQUFTLElBQUksR0FBRyxJQUFJLFNBQVMsUUFBUSxJQUFLLE1BQUssaUJBQWlCLE9BQU8sSUFBSSxDQUFDO0FBQzVFLGFBQU8sS0FBTSxNQUFNLFNBQVM7QUFDNUIsYUFBTyxJQUFJLE1BQU0sTUFBTSxTQUFTLENBQUMsRUFBRTtBQUFBLElBQ3JDO0FBQ0EsU0FBSyxvQkFBb0IsTUFBTTtBQUMvQixXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUEsRUFHQSxPQUFPLFFBQVE7QUFDYixVQUFNLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQyxLQUFLO0FBQ3JDLFFBQUksT0FBTyxNQUFNLEtBQUssUUFBUTtBQUM1QixVQUFJLE9BQU8sS0FBSyxLQUFLLE1BQU0sU0FBUyxFQUFHLFFBQU87QUFDOUMsWUFBTSxXQUFXLEtBQUssTUFBTSxPQUFPLElBQUksQ0FBQyxLQUFLO0FBQzdDLFdBQUssTUFBTSxPQUFPLE9BQU8sR0FBRyxHQUFHLE9BQU8sUUFBUTtBQUM5QyxXQUFLLGlCQUFpQixPQUFPLENBQUM7QUFBQSxJQUNoQyxPQUFPO0FBQ0wsV0FBSyxNQUFNLE9BQU8sQ0FBQyxJQUFJLEtBQUssVUFBVSxHQUFHLE9BQU8sQ0FBQyxJQUFJLEtBQUssVUFBVSxPQUFPLElBQUksQ0FBQztBQUNoRixXQUFLLGlCQUFpQixPQUFPLENBQUM7QUFBQSxJQUVoQztBQUNBLFNBQUssb0JBQW9CLE1BQU07QUFDL0IsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLFVBQVUsUUFBUTtBQUNoQixRQUFJLE9BQU8sSUFBSSxHQUFHO0FBQ2hCLGFBQU87QUFBSyxXQUFLLE9BQU8sTUFBTTtBQUFBLElBQ2hDLFdBQVcsT0FBTyxJQUFJLEdBQUc7QUFDdkIsWUFBTSxXQUFXLEtBQUssTUFBTSxPQUFPLElBQUksQ0FBQyxLQUFLLElBQUk7QUFDakQsYUFBTztBQUFLLGFBQU8sSUFBSTtBQUFTLFdBQUssT0FBTyxNQUFNO0FBQUcsV0FBSyxpQkFBaUIsT0FBTyxDQUFDO0FBQUEsSUFDckY7QUFDQSxTQUFLLG9CQUFvQixNQUFNO0FBQy9CLFdBQU87QUFBQSxFQUNUO0FBQUE7QUFBQTtBQUFBLEVBSUEsT0FBTztBQUNMLFVBQU0sUUFBUSxJQUFJLGlCQUFpQixLQUFLLFVBQVUsRUFBRSxNQUFNLEtBQUssZ0JBQWdCLE1BQU0sS0FBSyxjQUFhLENBQUU7QUFDekcsVUFBTSxXQUFTLEtBQUs7QUFDcEIsVUFBTSxZQUFVLEtBQUs7QUFDckIsVUFBTSxZQUFVLEtBQUs7QUFDckIsVUFBTSxRQUFNLEtBQUs7QUFDakIsVUFBTSxVQUFRLEtBQUs7QUFDbkIsVUFBTSxTQUFPLEtBQUs7QUFDbEIsVUFBTSxZQUFVLEtBQUs7QUFDckIsVUFBTSxhQUFXLEtBQUs7QUFDdEIsVUFBTSxjQUFZLEtBQUs7QUFDdkIsVUFBTSxTQUFPLEtBQUs7QUFDbEIsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLFlBQVk7QUFDVixVQUFNLFVBQVUsT0FBTyxLQUFLLEtBQUssZUFBYyxDQUFFO0FBQ2pELFVBQU0sUUFBUSxRQUFRLENBQUMsS0FBSztBQUM1QixVQUFNLE9BQU8sUUFBUSxRQUFRLFNBQVMsQ0FBQyxLQUFLO0FBQzVDLFVBQU0sT0FBTztBQUFBLE1BQ1gsUUFBUSxLQUFLO0FBQUEsTUFDYixHQUFHLEVBQUUsR0FBRyxLQUFLLFdBQVcsR0FBRyxLQUFLLFdBQVcsR0FBRyxLQUFLLGVBQWUsR0FBRyxLQUFLLGVBQWM7QUFBQSxNQUN4RixHQUFHLEtBQUs7QUFBQSxNQUNSLEdBQUcsR0FBRyxLQUFLLFFBQVEsSUFBSTtBQUFBLElBQzdCO0FBQ0ksV0FBTyxLQUFLLFVBQVUsSUFBSSxFQUFFLFFBQVEsT0FBTyxFQUFFO0FBQUEsRUFDL0M7QUFDRjtBQUtBLFNBQVMsTUFBTSxHQUFHLEtBQUssS0FBSztBQUFFLFNBQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxJQUFJLEtBQUssQ0FBQyxDQUFDO0FBQUc7QUNyWS9ELFNBQVMsMEJBQTBCO0FBQUEsRUFDdEM7QUFBQSxFQUNBLGFBQVcsQ0FBQyxJQUFHLFFBQU87QUFBQSxFQUFDO0FBQUEsRUFDdkIsV0FBVyxDQUFDLEVBQUMsUUFBQVgsU0FBTyxJQUFHLEtBQUksYUFBWSxlQUFjO0FBQUEsRUFBQztBQUFBLEVBQ3RELFVBQVUsQ0FBQyxFQUFDLFFBQUFBLFNBQU8sSUFBRyxLQUFJLGFBQVksZUFBYztBQUFBLEVBQUM7QUFBQSxFQUNyRCxHQUFHO0FBQ1AsR0FBRztBQUNELFFBQU0sU0FBU0wsTUFBQUEsT0FBQTtBQU1mLFFBQU0sQ0FBQ0ssU0FBUUMsVUFBUyxJQUFJQyxNQUFBQSxTQUFTLElBQUk7QUFDekMsUUFBTSxDQUFDLE1BQU0sT0FBTyxJQUFRQSxNQUFBQSxTQUFTLEVBQUUsTUFBTSxJQUFJLE1BQU0sSUFBSTtBQUMzRCxRQUFLLENBQUMsV0FBVSxZQUFZLElBQUlBLE1BQUFBLFNBQVMsRUFBQyxRQUFPLE1BQUssSUFBRyxNQUFLLEtBQUksTUFBSyxhQUFZLE1BQUssVUFBUyxNQUFLO0FBSXRHTixRQUFBQSxVQUFVLE1BQU07QUFDZCxRQUFJLFVBQVU7QUFDWixZQUFNLEtBQUssSUFBSSxpQkFBaUIsVUFBVSxFQUFFLE1BQU0sS0FBSyxNQUFNLE1BQU0sS0FBSyxLQUFBLENBQU07QUFFOUUsU0FBRyxpQkFBaUIsS0FBSyxPQUFLO0FBQzlCLFNBQUcsZ0JBQWdCLEtBQUs7QUFDeEIsTUFBQUssV0FBVSxFQUFFO0FBQUEsSUFDZCxPQUFPO0FBQ0wsTUFBQUEsV0FBVSxJQUFJO0FBQUEsSUFDaEI7QUFBQSxFQUNGLEdBQUcsQ0FBQyxRQUFRLENBQUM7QUFHYkwsUUFBQUEsVUFBVSxNQUFNO0FBQ2QsVUFBTU8sT0FBTSxPQUFPO0FBQ25CLFFBQUksQ0FBQ0EsS0FBSztBQUNWLFVBQU0sU0FBUyxNQUFNO0FBQ25CLGNBQVEsRUFBRSxNQUFNQSxLQUFJLE9BQU8sTUFBTUEsS0FBSSxTQUFPLEdBQUc7QUFBQSxJQUNqRDtBQUNBLFdBQUE7QUFDQUEsU0FBSSxHQUFHLFVBQVUsTUFBTTtBQUN2QixXQUFPLE1BQU1BLEtBQUksZUFBZSxVQUFVLE1BQU07QUFBQSxFQUNsRCxHQUFHLENBQUEsQ0FBRTtBQUdMUCxRQUFBQSxVQUFVLE1BQUk7QUFDWixRQUFHSSxTQUFPO0FBQ1IsTUFBQUEsUUFBTyxnQkFBZ0IsS0FBSztBQUM1QixNQUFBQSxRQUFPLGlCQUFpQixLQUFLO0FBQzdCLE1BQUFDLFdBQVVELFFBQU8sTUFBTTtBQUFBLElBQ3pCO0FBQUEsRUFDRixHQUFHLENBQUMsSUFBSSxDQUFDO0FBQ1QsUUFBTSxnQkFBZ0IsTUFBSTtBQUN4QixRQUFHLENBQUNBLFNBQU87QUFDUCxhQUNFRiw4QkFBQUE7QUFBQUEsUUFBQztBQUFBLFFBQUE7QUFBQSxVQUNDLE1BQU07QUFBQSxVQUFHLEtBQUs7QUFBQSxVQUFHLE9BQU87QUFBQSxVQUFHLFFBQVE7QUFBQSxVQUNuQyxPQUFPLEVBQUMsT0FBTSxLQUFBO0FBQUEsVUFDZCxTQUFTO0FBQUEsUUFBQTtBQUFBLFFBSEQ7QUFBQSxNQUFBO0FBQUEsSUFNaEI7QUFDQSxVQUFNLFlBQVUsS0FBSyxLQUFLLEtBQUssTUFBTUUsUUFBTyxpQkFBZUEsUUFBTyxTQUFTLENBQUMsSUFBRTtBQUU5RSxXQUFPLENBQUMsR0FBR0EsUUFBTyxPQUFPLEVBQ3BCLE9BQU8sQ0FBQyxRQUFPLE1BQUk7QUFDbEIsYUFBTyxPQUFPLEtBQUdBLFFBQU8sYUFBYSxPQUFPLEtBQU1BLFFBQU8sWUFBVUEsUUFBTztBQUFBLElBQzVFLENBQUMsRUFDQSxJQUFJLENBQUMsS0FBSSxPQUFLO0FBQ2IsWUFBTSxTQUFTQSxRQUFPLFVBQVUsRUFBQyxHQUFHLEtBQUk7QUFDeEMsYUFBT0YsOEJBQUFBO0FBQUFBLFFBQUM7QUFBQSxRQUFBO0FBQUEsVUFDSixNQUFNLE9BQU8sSUFBRUUsUUFBTyxZQUFVLFlBQVUsSUFBRztBQUFBLFVBQUcsS0FBSyxPQUFPLElBQUVBLFFBQU87QUFBQSxVQUFXLE9BQU87QUFBQSxVQUFHLFFBQVE7QUFBQSxVQUNsRyxPQUFPLEVBQUMsR0FBRyxPQUFPLE9BQU0sV0FBVyxNQUFLLE1BQUssTUFBSyxTQUFRLEtBQUE7QUFBQSxVQUMxRCxNQUFNO0FBQUEsVUFDTixTQUFTLE9BQU87QUFBQSxRQUFBO0FBQUEsUUFKSCxVQUFVLEVBQUUsSUFBSSxLQUFLLEtBQUs7QUFBQSxNQUFBO0FBQUEsSUFNN0MsQ0FBQztBQUFBLEVBRVA7QUFDQSxRQUFNLG1CQUFtQixNQUFNO0FBQzdCLFFBQUcsQ0FBQ0EsU0FBTztBQUNULGFBQU8sQ0FBQTtBQUFBLElBQ1Q7QUFDQSxVQUFNLFlBQVUsS0FBSyxLQUFLLEtBQUssTUFBTUEsUUFBTyxpQkFBZUEsUUFBTyxTQUFTLENBQUMsSUFBRTtBQUM5RSxVQUFNLGNBQWMsVUFBVSxXQUFXQSxPQUFNO0FBRS9DLFdBQU8sQ0FBQyxHQUFHQSxRQUFPLFVBQVUsRUFDdkIsT0FBTyxDQUFDQSxRQUFPLFdBQVcsQ0FBQyxFQUMzQixPQUFPLENBQUMsV0FBVSxNQUFJO0FBQ3JCLGFBQU8sY0FBYyxRQUFRLFVBQVUsVUFBVSxXQUFXO0FBQUEsSUFDOUQsQ0FBQyxFQUNBLFFBQVEsQ0FBQSxNQUFLO0FBQ1osWUFBTSxRQUFNLENBQUE7QUFDWixlQUFRLElBQUUsRUFBRSxNQUFNLEdBQUUsS0FBRyxFQUFFLElBQUksR0FBRSxLQUFJO0FBQ2pDLGNBQU0sS0FBSztBQUFBLFVBQ1QsR0FBRSxFQUFFLE1BQU0sSUFBRUEsUUFBTyxZQUFVLFlBQVUsSUFBRztBQUFBLFVBQzFDLEdBQUUsSUFBRUEsUUFBTztBQUFBLFVBQ1gsT0FBTyxFQUFFLE1BQU07QUFBQSxVQUNmLFNBQVNBLFFBQU8sTUFBTSxDQUFDLEVBQUUsVUFBVSxFQUFFLE1BQU0sR0FBRyxFQUFFLElBQUksSUFBSSxDQUFDO0FBQUEsUUFBQSxDQUMxRDtBQUFBLE1BQ0g7QUFDQSxhQUFPO0FBQUEsSUFDVCxDQUFDLEVBQ0EsSUFBSSxDQUFDLElBQUcsT0FBSztBQUNaLGFBQU9GLDhCQUFBQTtBQUFBQSxRQUFDO0FBQUEsUUFBQTtBQUFBLFVBQ0ksTUFBTSxHQUFHO0FBQUEsVUFBRyxLQUFLLEdBQUc7QUFBQSxVQUFHLE9BQU8sR0FBRyxRQUFRO0FBQUEsVUFBUSxRQUFRO0FBQUEsVUFDekQsT0FBTyxFQUFDLEdBQUcsR0FBRyxPQUFNLFdBQVcsTUFBSyxNQUFLLE1BQUssU0FBUSxLQUFBO0FBQUEsVUFDdEQsTUFBTTtBQUFBLFVBQ04sU0FBUyxHQUFHO0FBQUEsUUFBQTtBQUFBLFFBSlAsYUFBYSxFQUFFLElBQUksS0FBSyxLQUFLO0FBQUEsTUFBQTtBQUFBLElBTWhELENBQUM7QUFBQSxFQUVQO0FBRUEsUUFBTSxZQUFZLE1BQUk7QUFDcEIsUUFBRyxDQUFDRSxTQUFPO0FBQ1AsYUFDRUYsOEJBQUFBO0FBQUFBLFFBQUM7QUFBQSxRQUFBO0FBQUEsVUFDQyxPQUFLO0FBQUEsVUFDTCxNQUFJO0FBQUEsVUFDSixPQUFLO0FBQUEsVUFDTCxXQUFTO0FBQUEsVUFDVCxTQUFPO0FBQUEsVUFDUCxPQUFPLEtBQUssUUFBTSxLQUFLO0FBQUEsVUFBRyxNQUFNLEtBQUssUUFBTSxLQUFHO0FBQUEsVUFBRyxPQUFPO0FBQUEsVUFBSSxRQUFRO0FBQUEsVUFDcEUsT0FBTyxFQUFDLElBQUcsV0FBVSxJQUFHLFVBQUE7QUFBQSxVQUN4QixTQUFTO0FBQUEsUUFBQTtBQUFBLFFBUkQ7QUFBQSxNQUFBO0FBQUEsSUFXaEI7QUFFQSxVQUFNLFlBQVUsS0FBSyxLQUFLLEtBQUssTUFBTUUsUUFBTyxpQkFBZUEsUUFBTyxTQUFTLENBQUMsSUFBRTtBQUM5RSxVQUFNLFFBQVFBLFFBQU8sZUFBQTtBQUNyQixXQUFPLE9BQU8sS0FBSyxLQUFLLEVBQUUsUUFBUSxDQUFDLFlBQVksTUFBTTtBQUNuRCxZQUFNLE9BQU8sTUFBTSxVQUFVO0FBQzdCLFlBQU0saUJBQWlCLEdBQUcsT0FBTyxVQUFVLEVBQUUsU0FBUyxXQUFXLEdBQUcsQ0FBQztBQUNyRSxZQUFNLGdCQUNGRiw4QkFBQUE7QUFBQUEsUUFBQztBQUFBLFFBQUE7QUFBQSxVQUNJLE1BQU07QUFBQSxVQUFHLEtBQUs7QUFBQSxVQUFHLE9BQU8sWUFBWTtBQUFBLFVBQUcsUUFBUTtBQUFBLFVBQy9DLE9BQU8sRUFBQyxJQUFJLFdBQVcsSUFBSSxXQUFXLFNBQVNFLFFBQU8sUUFBUSxJQUFJLE9BQUksRUFBRSxDQUFDLEVBQUUsUUFBUSxVQUFVLElBQUUsR0FBQTtBQUFBLFVBQy9GLFNBQVMsaUJBQWU7QUFBQSxRQUFBO0FBQUEsUUFIbkIsR0FBRyxVQUFVLGVBQWUsS0FBSyxHQUFHO0FBQUEsTUFBQTtBQUtsRCxZQUFNLGdCQUNGRiw4QkFBQUE7QUFBQUEsUUFBQztBQUFBLFFBQUE7QUFBQSxVQUNJLE1BQU0sWUFBWSxJQUFJO0FBQUEsVUFBRyxLQUFLO0FBQUEsVUFBRyxPQUFPRSxRQUFPLE1BQU0sVUFBVSxFQUFFO0FBQUEsVUFBUSxRQUFRO0FBQUEsVUFDakYsT0FBTyxFQUFDLElBQUksV0FBVyxJQUFJLFdBQVcsU0FBU0EsUUFBTyxRQUFRLElBQUksT0FBSSxFQUFFLENBQUMsRUFBRSxRQUFRLFVBQVUsSUFBRSxHQUFBO0FBQUEsVUFDL0YsU0FBU0EsUUFBTyxNQUFNLFVBQVU7QUFBQSxRQUFBO0FBQUEsUUFIM0IsUUFBUSxVQUFVLElBQUksS0FBSyxLQUFLO0FBQUEsTUFBQTtBQUs5QyxhQUFPLEtBQUssT0FBTyxDQUFDLEdBQUcsTUFBTTtBQUMzQixVQUFFO0FBQUEsVUFDRUYsOEJBQUFBO0FBQUFBLFlBQUM7QUFBQSxZQUFBO0FBQUEsY0FDSSxNQUFNLEVBQUUsSUFBSSxZQUFZLElBQUk7QUFBQSxjQUFHLEtBQUssRUFBRSxJQUFJRSxRQUFPO0FBQUEsY0FBVyxPQUFPLEVBQUUsS0FBSztBQUFBLGNBQVEsUUFBUTtBQUFBLGNBQzFGLE9BQU8sRUFBRTtBQUFBLGNBQ1QsU0FBUyxFQUFFO0FBQUEsWUFBQTtBQUFBLFlBSE4sR0FBRyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxLQUFLLEtBQUs7QUFBQSxVQUFBO0FBQUEsUUFJckM7QUFFSixlQUFPO0FBQUEsTUFDVCxHQUFHO0FBQUEsUUFDRDtBQUFBLFFBQ0E7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BQUEsQ0FPRDtBQUFBLElBQ0gsQ0FBQztBQUFBLEVBQ0g7QUFHQSxRQUFNLHFCQUFxQixDQUFDLElBQUksUUFBUTtBQUN0QyxlQUFXLElBQUcsR0FBRztBQUNqQixRQUFHQSxXQUFVLFFBQVEsWUFBVSxNQUFLO0FBQ2hDO0FBQUEsSUFDSjtBQUNBLFVBQU0sQ0FBQyxZQUFXLFVBQVUsSUFBSUEsUUFBTyxNQUFNLElBQUcsR0FBRztBQUNuRCxRQUFHLFlBQVc7QUFDWixZQUFNLGVBQWUsRUFBQyxHQUFHLFdBQVUsUUFBQUEsU0FBTyxJQUFHLEtBQUksVUFBUyxPQUFPLFFBQVEsS0FBQTtBQUN6RSxlQUFTLFlBQVk7QUFDckIsbUJBQWEsWUFBWTtBQUN6QixNQUFBQyxXQUFVRCxRQUFPLE1BQU07QUFBQSxJQUN6QixXQUFXLFlBQVk7QUFDckIsWUFBTSxlQUFlLEVBQUMsR0FBRyxXQUFVLFFBQUFBLFNBQU8sSUFBRyxLQUFJLFVBQVMsT0FBTyxRQUFRLEtBQUE7QUFDekUsY0FBUSxZQUFZO0FBQ3BCLG1CQUFhLFlBQVk7QUFDekIsTUFBQUMsV0FBVUQsUUFBTyxNQUFNO0FBQUEsSUFDekI7QUFBQSxFQUVGO0FBRUEsUUFBTSxjQUFZLENBQUMsZ0JBQWU7QUFDaEMsUUFBRyxDQUFDQSxTQUFPO0FBQ1Q7QUFBQSxJQUNGO0FBQ0EsVUFBTSxDQUFDLFlBQVcsVUFBVSxJQUFJQSxRQUFPLFFBQVEsYUFBWSxPQUFPLFFBQVEsSUFBSTtBQUM5RSxRQUFHLFlBQVc7QUFDWixZQUFNLGVBQWUsRUFBQyxHQUFHLFdBQVUsUUFBQUEsU0FBTyxhQUFZLFVBQVMsT0FBTyxRQUFRLEtBQUE7QUFDOUUsZUFBUyxZQUFZO0FBQ3JCLG1CQUFhLFlBQVk7QUFDekIsTUFBQUMsV0FBVUQsUUFBTyxNQUFNO0FBQUEsSUFDekIsV0FBVyxZQUFZO0FBQ3JCLFlBQU0sZUFBZSxFQUFDLEdBQUcsV0FBVSxRQUFBQSxTQUFPLGFBQVksVUFBUyxPQUFPLFFBQVEsS0FBQTtBQUM5RSxjQUFRLFlBQVk7QUFDcEIsbUJBQWEsWUFBWTtBQUN6QixNQUFBQyxXQUFVRCxRQUFPLE1BQU07QUFBQSxJQUN6QjtBQUFBLEVBQ0Y7QUFDQSxTQUNFSCw4QkFBQUE7QUFBQUEsSUFBQztBQUFBLElBQUE7QUFBQSxNQUNDLEtBQUs7QUFBQSxNQUNKLEdBQUc7QUFBQSxNQUNKLE9BQUs7QUFBQSxNQUNMLE1BQUk7QUFBQSxNQUNKLE9BQUs7QUFBQSxNQUNMLFdBQVM7QUFBQSxNQUNULFNBQU87QUFBQSxNQUNQLFFBQVEsRUFBRSxNQUFNLE9BQUE7QUFBQSxNQUNoQixPQUFPLEVBQUUsUUFBUSxFQUFFLElBQUksU0FBTztBQUFBLE1BQzlCLE1BQU07QUFBQSxNQUNOLFlBQVk7QUFBQSxNQUNaLFlBQVk7QUFBQSxNQUNaLFNBQVM7QUFBQSxNQUNULE9BQU8sWUFBWSxRQUFRO0FBQUEsTUFNMUIsVUFBQTtBQUFBLFFBQUEsVUFBQTtBQUFBLFFBRURDLDhCQUFBQTtBQUFBQSxVQUFDO0FBQUEsVUFBQTtBQUFBLFlBRUMsS0FBSyxLQUFLO0FBQUEsWUFDVixNQUFNO0FBQUEsWUFDTixPQUFPLEtBQUssT0FBSztBQUFBLFlBQ2pCLFFBQVE7QUFBQSxZQUNSLFNBQVNFLFNBQVEsVUFBQTtBQUFBLFlBQ2pCLE1BQU07QUFBQSxZQUNOLE9BQU8sRUFBQyxJQUFHLFNBQVEsSUFBRyxTQUFBO0FBQUEsVUFBUTtBQUFBLFVBUHpCO0FBQUEsUUFBQTtBQUFBLFFBU04sY0FBQTtBQUFBLFFBQ0EsaUJBQUE7QUFBQSxNQUFpQjtBQUFBLElBQUE7QUFBQSxFQUFBO0FBR3hCO0FDelBBLE1BQU0sT0FBTyxRQUFRLE1BQU07QUFDM0IsTUFBTSxLQUFLLFFBQVEsZUFBZTtBQUNsQyxNQUFNLE9BQU8sS0FBSyxVQUFVLEdBQUcsSUFBSTtBQUU1QixlQUFlLFVBQVUsS0FBSztBQUNuQyxRQUFNLEVBQUUsT0FBTSxJQUFLLE1BQU0sS0FBSywwQkFBMEIsRUFBRSxLQUFLO0FBQy9ELFNBQU8sT0FBTyxNQUFNLElBQUksRUFBRSxPQUFPLE9BQU87QUFDMUM7QUFDTyxlQUFlLFdBQVcsS0FBSztBQUNwQyxRQUFNLEVBQUUsT0FBTSxJQUFLLE1BQU0sS0FBSyxxREFBcUQsRUFBRSxLQUFLO0FBQzFGLFFBQU0sUUFBUSxPQUFPLE1BQU0sSUFBSSxFQUFFLE9BQU8sT0FBTztBQUMvQyxTQUFPLE1BQU0sUUFBUSxJQUFJLE1BQU0sSUFBSSxPQUFNLE1BQUs7QUFDNUMsVUFBTSxLQUFLLEVBQUUsVUFBVSxHQUFFLEVBQUU7QUFDM0IsVUFBTSxVQUFVLEVBQUUsVUFBVSxFQUFFO0FBQzlCLFVBQU0sRUFBRSxRQUFPLEtBQUksSUFBSyxNQUFNLEtBQUssdUJBQXVCLEVBQUUsSUFBSSxFQUFFLEtBQUs7QUFDdkUsV0FBTyxHQUFHLEdBQUcsVUFBVSxHQUFFLENBQUMsQ0FBQyxLQUFLLE9BQUssS0FBSyxLQUFLLElBQUksSUFBRSxJQUFJLE9BQU8sR0FBRSxHQUFHLENBQUMsSUFBSSxPQUFPO0FBQUEsRUFFbkYsQ0FBQyxDQUFDO0FBQ0o7QUFDTyxlQUFlLFVBQVUsS0FBSztBQUNuQyxRQUFNLEVBQUUsT0FBTSxJQUFLLE1BQU0sS0FBSyw2QkFBNkIsRUFBRSxLQUFLO0FBQ2xFLFNBQU8sT0FBTyxNQUFNLElBQUksRUFBRSxPQUFPLE9BQU87QUFDMUM7QUFDTyxlQUFlLGNBQWMsS0FBSztBQUN2QyxRQUFNLEVBQUUsT0FBTSxJQUFLLE1BQU0sS0FBSyxnRUFBZ0UsRUFBRSxLQUFLO0FBQ3JHLFNBQU8sT0FBTyxNQUFNLElBQUksRUFBRSxPQUFPLE9BQU87QUFDMUM7QUFDTyxlQUFlLFdBQVcsS0FBSztBQUNwQyxRQUFNLEVBQUUsT0FBTSxJQUFLLE1BQU0sS0FBSyxpQkFBaUIsRUFBRSxLQUFLO0FBQ3RELFNBQU8sT0FBTyxNQUFNLElBQUksRUFBRSxPQUFPLE9BQU87QUFDMUM7QUFDTyxlQUFlLFFBQVEsS0FBSztBQUNqQyxRQUFNLEVBQUUsT0FBTSxJQUFLLE1BQU0sS0FBSyxpQkFBaUIsRUFBRSxLQUFLO0FBQ3RELFNBQU8sT0FBTyxNQUFNLElBQUksRUFBRSxPQUFPLE9BQU87QUFDMUM7QUFDTyxlQUFlLFNBQVMsS0FBSyxVQUFVO0FBQzVDLFFBQU0sRUFBRSxXQUFXLE1BQU0sS0FBSyxlQUFlLFFBQVEsS0FBSyxFQUFFLEtBQUs7QUFDakUsU0FBTyxPQUFPLE1BQU0sSUFBSSxFQUFFLE9BQU8sT0FBTztBQUMxQztBQUNPLGVBQWUsV0FBVyxLQUFLLFVBQVU7QUFDOUMsUUFBTSxFQUFFLFdBQVcsTUFBTSxLQUFLLHlCQUF5QixRQUFRLEtBQUssRUFBRSxLQUFLO0FBQzNFLFNBQU8sT0FBTyxNQUFNLElBQUksRUFBRSxPQUFPLE9BQU87QUFDMUM7QUFDTyxlQUFlLFVBQVUsS0FBSSxlQUFlO0FBQ2pELFFBQU0sRUFBRSxXQUFXLE1BQU0sS0FBSyxrQkFBa0IsYUFBYSxLQUFLLEVBQUUsS0FBSztBQUN6RSxTQUFPLE9BQU8sTUFBTSxJQUFJLEVBQUUsT0FBTyxPQUFPO0FBQzFDO0FBQ08sZUFBZSxPQUFPLEtBQUlZLE1BQUs7QUFDcEMsUUFBTSxFQUFFLFdBQVcsTUFBTSxLQUFLLFlBQVlBLElBQUcsS0FBSyxFQUFFLEtBQUs7QUFDekQsU0FBTyxPQUFPLE1BQU0sSUFBSSxFQUFFLE9BQU8sT0FBTztBQUMxQztBQUNPLGVBQWUsUUFBUSxLQUFJLFFBQU9DLFNBQVE7QUFDL0MsUUFBTSxFQUFFLE9BQU0sSUFBSyxNQUFNLEtBQUssYUFBYSxNQUFNLE1BQU1BLE9BQU0sWUFBWSxFQUFFLElBQUcsQ0FBRTtBQUNoRixTQUFPLE9BQU8sTUFBTSxJQUFJLEVBQUUsT0FBTyxPQUFPO0FBQzFDO0FDM0NBLE1BQU0sY0FBWSxNQUNiLE1BQU0sR0FBRyxFQUFFLEtBQUssSUFBSTtBQUNsQixTQUFTLDBCQUEwQixFQUFDLGFBQWEsVUFBUyxHQUFHLFlBQVc7QUFDM0UsUUFBTSxTQUFTbEIsTUFBQUEsT0FBTyxJQUFJO0FBQzFCLFFBQU0sQ0FBQ0ssU0FBUUMsVUFBUyxJQUFJQyxNQUFBQSxTQUFTLElBQUk7QUFDekMsUUFBTSxDQUFDLGFBQWEsY0FBYyxJQUFJQSxNQUFBQSxTQUFTLEVBQUMsR0FBRSxHQUFFLEdBQUUsR0FBRTtBQUN4RCxRQUFNLENBQUMsTUFBTSxPQUFPLElBQVFBLE1BQUFBLFNBQVMsRUFBRSxNQUFNLElBQUksTUFBTSxJQUFJO0FBQzNELE1BQUksaUJBQWU7QUFDbkJOLFFBQUFBLFVBQVUsTUFBSTtBQUNWLFFBQUksWUFBVUk7QUFDZCxRQUFHLENBQUMsV0FBVTtBQUNWLGtCQUFZLElBQUksaUJBQWlCLGVBQWEsV0FBVztBQUFBLElBQzdEO0FBQ0EsU0FBSSxlQUFhLGFBQWEsVUFBVSxVQUFVLFdBQVcsTUFBSSxVQUFVLE9BQU8sVUFBVSxVQUFVLFdBQVcsR0FBRTtBQUMvRyxnQkFBVSxjQUFjO0FBQ3hCLGdCQUFVLHNCQUFBO0FBQUEsSUFDZDtBQUNBLGNBQVUsU0FBTyxlQUFhO0FBQzlCLGNBQVUsaUJBQWlCLEtBQUssT0FBSztBQUNyQyxjQUFVLGdCQUFnQixLQUFLO0FBQy9CLElBQUFDLFdBQVUsVUFBVSxNQUFNO0FBQUEsRUFDOUIsR0FBRSxDQUFDLFdBQVcsQ0FBQztBQUdmTCxRQUFBQSxVQUFVLE1BQU07QUFDWixVQUFNTyxPQUFNLE9BQU87QUFDbkIsUUFBSSxDQUFDQSxLQUFLO0FBQ1YsVUFBTSxTQUFTLE1BQU07QUFDakIsY0FBUSxFQUFFLE1BQU1BLEtBQUksT0FBTyxNQUFNQSxLQUFJLFNBQU8sR0FBRztBQUFBLElBQ25EO0FBQ0EsV0FBQTtBQUNBQSxTQUFJLEdBQUcsVUFBVSxNQUFNO0FBQ3ZCLFdBQU8sTUFBTUEsS0FBSSxlQUFlLFVBQVUsTUFBTTtBQUFBLEVBQ3BELEdBQUcsQ0FBQSxDQUFFO0FBSUxQLFFBQUFBLFVBQVUsTUFBSTtBQUNWLFFBQUdJLFNBQU87QUFDTixNQUFBQSxRQUFPLGdCQUFnQixLQUFLO0FBQzVCLE1BQUFBLFFBQU8saUJBQWlCLEtBQUs7QUFDN0IsTUFBQUMsV0FBVUQsUUFBTyxNQUFNO0FBQUEsSUFDM0I7QUFBQSxFQUNKLEdBQUcsQ0FBQyxJQUFJLENBQUM7QUFFVCxRQUFNLHFCQUFtQixDQUFDLElBQUcsUUFBTTtBQUMvQixJQUFBQSxRQUFPLE1BQU0sSUFBRyxHQUFHO0FBQ25CLGlCQUFhLGNBQWM7QUFDM0IscUJBQWlCLFdBQVcsTUFBSTtBQUM1QixlQUFTQSxPQUFNO0FBQ2YsTUFBQUMsV0FBVUQsUUFBTyxNQUFNO0FBQUEsSUFDM0IsR0FBRSxFQUFFO0FBQUEsRUFDUjtBQUNBLFFBQU0sb0JBQW9CLENBQUMsZ0JBQWdCO0FBQ3ZDLFFBQUcsQ0FBQ0EsU0FBTztBQUNQO0FBQUEsSUFDSjtBQUNBLFVBQU0sRUFBQyxJQUFHLEdBQUEsSUFBTSxPQUFPLFFBQVE7QUFDL0IsVUFBTSxFQUFDLEdBQUUsRUFBQSxJQUFLO0FBQ2QsSUFBQUEsUUFBTyxVQUFVLElBQUUsS0FBRyxJQUFFQSxRQUFPLFdBQVUsSUFBRSxLQUFHLElBQUVBLFFBQU8sU0FBUztBQUNoRSxJQUFBQyxXQUFVRCxRQUFPLE1BQU07QUFBQSxFQUMzQjtBQUNBLFFBQU0sY0FBWSxDQUFDLFVBQVM7QUFDeEIsVUFBTSxFQUFDLEdBQUUsRUFBQSxJQUFLO0FBQUEsRUFXbEI7QUFDQSxRQUFNLGNBQWMsTUFBTTtBQUN0QixRQUFHLENBQUNBLFNBQU87QUFDUDtBQUFBLElBQ0o7QUFDQSxVQUFNLEVBQUMsV0FBVSxJQUFHLGdCQUFlLE9BQU1BO0FBQ3pDLFdBQU9BLFFBQU8sY0FBQSxFQUNULE9BQU8sQ0FBQyxHQUFFLE1BQU07QUFDYixhQUFRLEtBQUksTUFBTSxLQUFNLEtBQUs7QUFBQSxJQUNqQyxDQUFDLEVBQ0EsSUFBSSxDQUFDLE1BQUssVUFBUTtBQUNmLGFBQ0lGLDhCQUFBQTtBQUFBQSxRQUFDO0FBQUEsUUFBQTtBQUFBLFVBQ0csS0FBSztBQUFBLFVBQU8sTUFBTTtBQUFBLFVBQUcsUUFBUTtBQUFBLFVBQUcsT0FBTyxLQUFLLFVBQVE7QUFBQSxVQUVwRCxTQUFTO0FBQUEsUUFBQTtBQUFBLFFBREosc0JBQXNCLEtBQUs7QUFBQSxNQUFBO0FBQUEsSUFJNUMsQ0FBQztBQUFBLEVBQ1Q7QUFDQSxRQUFNLGVBQWUsTUFBTTtBQUN2QixRQUFHLENBQUNFLFNBQU87QUFDUDtBQUFBLElBQ0o7QUFDQSxVQUFNLElBQUlBLFFBQU87QUFDakIsVUFBTSxFQUFDLEdBQUUsTUFBS0EsUUFBTyxhQUFBO0FBQ3JCLFVBQU0sRUFBQyxhQUFZLElBQUcsV0FBVSxJQUFHLFdBQVUsSUFBRyxnQkFBZSxJQUFHLGVBQWMsR0FBQSxJQUFNQTtBQUN0RixVQUFNLFVBQVVBLFFBQU8sT0FBTyxVQUFVLEdBQUUsSUFBRSxDQUFDO0FBQzdDLFdBQVFGLDhCQUFBQTtBQUFBQSxNQUFDO0FBQUEsTUFBQTtBQUFBLFFBRUwsS0FBSyxJQUFFO0FBQUEsUUFDUCxNQUFNLElBQUU7QUFBQSxRQUNSLE9BQU87QUFBQSxRQUFHLFFBQVE7QUFBQSxRQUNsQixPQUFPLEVBQUMsU0FBUSxNQUFLLFdBQVUsS0FBQTtBQUFBLFFBQy9CO0FBQUEsTUFBQTtBQUFBLE1BTEssaUJBQWlCLEtBQUssS0FBSztBQUFBLElBQUE7QUFBQSxFQU94QztBQUNBLFFBQU0sZUFBZSxNQUFNO0FBQ3ZCLFFBQUcsQ0FBQ0UsU0FBTztBQUNQO0FBQUEsSUFDSjtBQUNBLFVBQU0sRUFBQyxhQUFZLElBQUcsV0FBVSxJQUFHLFdBQVUsSUFBRyxnQkFBZSxJQUFHLGVBQWMsR0FBQSxJQUFNQTtBQUN0RixVQUFNLEVBQUMsR0FBRSxJQUFHLEdBQUUsR0FBQSxJQUFNQSxRQUFPLGFBQUE7QUFDM0IsVUFBTSxFQUFDLEdBQUUsSUFBRyxHQUFFLE9BQU07QUFDcEIsUUFBSSxnQkFBZ0JBLFFBQU8sT0FBTyxVQUFVLElBQUcsS0FBRyxDQUFDO0FBQ25ELFFBQUksVUFBUTtBQUNaLFFBQUcsT0FBTyxXQUFXLE9BQU8sUUFBUSxNQUFNO0FBQ3RDLFlBQU0sRUFBQyxJQUFHLEdBQUEsSUFBTSxPQUFPLFFBQVE7QUFDL0IsWUFBTSxXQUFTO0FBQUEsUUFDWCxHQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssYUFBYTtBQUFBLFFBQ3RDLEdBQUUsR0FBRyxFQUFFLElBQUksRUFBRTtBQUFBLFFBQ2IsR0FBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUU7QUFBQSxRQUN6QixHQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxLQUFHLEtBQUcsQ0FBQyxJQUFJLEtBQUcsS0FBRyxDQUFDO0FBQUEsTUFBQTtBQUV4QyxnQkFBVSxjQUFjLFFBQVEsRUFBRSxRQUFRLFlBQVcsRUFBRTtBQUFBLElBQzNEO0FBQ0EsV0FBUUYsOEJBQUFBO0FBQUFBLE1BQUM7QUFBQSxNQUFBO0FBQUEsUUFFTCxLQUFLO0FBQUEsUUFDTCxNQUFNO0FBQUEsUUFDTixPQUFPLFFBQVE7QUFBQSxRQUFRLFFBQVE7QUFBQSxRQUMvQixPQUFPLEVBQUMsU0FBUSxNQUFLLFdBQVUsS0FBQTtBQUFBLFFBQy9CO0FBQUEsTUFBQTtBQUFBLE1BTEssaUJBQWlCLEtBQUssS0FBSztBQUFBLElBQUE7QUFBQSxFQU94QztBQUNBLFNBQ0lELDhCQUFBQTtBQUFBQSxJQUFDO0FBQUEsSUFBQTtBQUFBLE1BQ0csS0FBSztBQUFBLE1BQ0osR0FBRztBQUFBLE1BQ0osT0FBSztBQUFBLE1BQ0wsTUFBSTtBQUFBLE1BQ0osT0FBSztBQUFBLE1BQ0wsV0FBUztBQUFBLE1BQ1QsU0FBTztBQUFBLE1BQ1AsUUFBUSxFQUFFLE1BQU0sT0FBQTtBQUFBLE1BQ2hCLE9BQU8sRUFBRSxRQUFRLEVBQUUsSUFBSSxTQUFPO0FBQUEsTUFDOUIsTUFBTTtBQUFBLE1BQ04sWUFBWTtBQUFBLE1BQ1osWUFBWTtBQUFBLE1BQ1osU0FBUztBQUFBLE1BQ1QsU0FBUztBQUFBLE1BR1IsVUFBQTtBQUFBLFFBQUEsWUFBQTtBQUFBLFFBQ0EsYUFBQTtBQUFBLFFBQ0EsYUFBQTtBQUFBLE1BQWE7QUFBQSxJQUFBO0FBQUEsRUFBQTtBQUUxQjtBQzFLTyxNQUFNLE9BQU87QUFBQSxFQUNoQixRQUFRO0FBQUEsRUFDUixRQUFRO0FBQUEsRUFDUixRQUFRO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBT1IsT0FBTyxLQUFLLEdBQUU7QUFDVixRQUFJO0FBQ0EsWUFBTSxDQUFDLE9BQU8sT0FBTyxLQUFLLEtBQUssS0FBSyxTQUFTLE1BQU0sR0FBRztBQUN0RCxhQUFPLElBQUksT0FBTyxPQUFPLE9BQU8sS0FBSztBQUFBLElBQ3pDLFNBQU8sR0FBRTtBQUNMLFlBQU0sQ0FBQyxPQUFPLE9BQU8sS0FBSyxJQUFJLFFBQVEsTUFBTSxHQUFHO0FBQy9DLGFBQU8sSUFBSSxPQUFPLE9BQU8sT0FBTyxLQUFLO0FBQUEsSUFDekM7QUFBQSxFQUNKO0FBQUEsRUFDQSxZQUFZLE9BQU0sT0FBTSxPQUFPO0FBQzNCLFNBQUssUUFBUTtBQUNiLFNBQUssUUFBUTtBQUNiLFNBQUssUUFBUTtBQUFBLEVBQ2pCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLFlBQVc7QUFDUCxXQUFPLElBQUksUUFBUSxTQUFTLEtBQUssS0FBSyxJQUFFLEdBQUcsWUFBWSxLQUFJLEdBQUc7QUFBQSxFQUNsRTtBQUFBLEVBQ0EsWUFBVztBQUNQLFFBQUksSUFBSSxTQUFTLEtBQUssS0FBSztBQUMzQixRQUFFLElBQUUsSUFBRSxJQUFFLElBQUU7QUFDVixXQUFPLElBQUksT0FBTyxFQUFFLFNBQVEsR0FBSSxLQUFJLEdBQUc7QUFBQSxFQUMzQztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNQSxZQUFXO0FBQ1AsV0FBTyxJQUFJLE9BQU8sS0FBSyxRQUFPLFNBQVMsS0FBSyxLQUFLLElBQUUsR0FBRyxTQUFRLEdBQUksR0FBRztBQUFBLEVBQ3pFO0FBQUEsRUFDQSxZQUFXO0FBQ1AsUUFBSSxJQUFJLFNBQVMsS0FBSyxLQUFLO0FBQzNCLFFBQUUsSUFBRSxJQUFFLElBQUUsSUFBRTtBQUNWLFdBQU8sSUFBSSxPQUFPLEtBQUssT0FBTSxFQUFFLFNBQVEsR0FBSSxHQUFHO0FBQUEsRUFDbEQ7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTUEsWUFBVztBQUNQLFdBQU8sSUFBSSxPQUFPLEtBQUssT0FBTSxLQUFLLFFBQVEsU0FBUyxLQUFLLEtBQUssSUFBRSxHQUFHLFNBQVEsQ0FBRTtBQUFBLEVBQ2hGO0FBQUEsRUFDQSxZQUFXO0FBQ1AsUUFBSSxJQUFJLFNBQVMsS0FBSyxLQUFLO0FBQzNCLFFBQUUsSUFBRSxJQUFFLElBQUUsSUFBRTtBQUNWLFdBQU8sSUFBSSxPQUFPLEtBQUssT0FBTSxLQUFLLE9BQU8sRUFBRSxTQUFRLENBQUU7QUFBQSxFQUN6RDtBQUFBLEVBR0EsV0FBVTtBQUNOLFdBQU8sR0FBRyxLQUFLLEtBQUssSUFBSSxLQUFLLEtBQUssSUFBSSxLQUFLLEtBQUs7QUFBQSxFQUNwRDtBQUFBLEVBQ0EsT0FBTTtBQUNGLFdBQU8sSUFBSSxPQUFPLEtBQUssT0FBTSxLQUFLLE9BQU8sS0FBSyxLQUFLO0FBQUEsRUFDdkQ7QUFDSjtBQzlETyxTQUFTLGNBQWMsRUFBQyxTQUFRLFVBQVMsR0FBRyxZQUFVO0FBQ3pELFFBQU0sQ0FBQyxRQUFRLFNBQVMsSUFBSUssTUFBQUEsU0FBUyxPQUFPLEtBQUssT0FBTyxDQUFDO0FBQ3pETixRQUFBQSxVQUFVLE1BQUk7QUFDVixjQUFVLE9BQU8sS0FBSyxPQUFPLENBQUM7QUFBQSxFQUNsQyxHQUFFLENBQUMsT0FBTyxDQUFDO0FBQ1gsUUFBTSxXQUFTLE1BQUk7QUFDZixVQUFNLFlBQVUsT0FBTyxVQUFBO0FBQ3ZCLGFBQVMsU0FBUztBQUNsQixjQUFVLFNBQVM7QUFBQSxFQUN2QjtBQUNBLFFBQU0sV0FBUyxNQUFJO0FBQ2YsVUFBTSxZQUFVLE9BQU8sVUFBQTtBQUN2QixhQUFTLFNBQVM7QUFDbEIsY0FBVSxTQUFTO0FBQUEsRUFDdkI7QUFDQSxRQUFNLFdBQVMsTUFBSTtBQUNmLFVBQU0sWUFBVSxPQUFPLFVBQUE7QUFDdkIsYUFBUyxTQUFTO0FBQ2xCLGNBQVUsU0FBUztBQUFBLEVBQ3ZCO0FBQ0EsUUFBTSxXQUFTLE1BQUk7QUFDZixVQUFNLFlBQVUsT0FBTyxVQUFBO0FBQ3ZCLGFBQVMsU0FBUztBQUNsQixjQUFVLFNBQVM7QUFBQSxFQUN2QjtBQUNBLFFBQU0sV0FBUyxNQUFJO0FBQ2YsVUFBTSxZQUFVLE9BQU8sVUFBQTtBQUN2QixhQUFTLFNBQVM7QUFDbEIsY0FBVSxTQUFTO0FBQUEsRUFDdkI7QUFDQSxRQUFNLFdBQVMsTUFBSTtBQUNmLFVBQU0sWUFBVSxPQUFPLFVBQUE7QUFDdkIsYUFBUyxTQUFTO0FBQ2xCLGNBQVUsU0FBUztBQUFBLEVBQ3ZCO0FBQ0EsU0FBUUMsOEJBQUFBLEtBQUMsT0FBQSxFQUFLLEdBQUcsVUFDYixVQUFBO0FBQUEsSUFBQUMsOEJBQUFBO0FBQUFBLE1BQUM7QUFBQSxNQUFBO0FBQUEsUUFBSSxPQUFLO0FBQUEsUUFBQyxTQUFPO0FBQUEsUUFBQyxXQUFTO0FBQUEsUUFBQyxTQUFTO0FBQUEsUUFBVSxRQUFRO0FBQUEsUUFDbkQsTUFBTTtBQUFBLFFBQ04sT0FBTztBQUFBLFFBQ1AsU0FBUztBQUFBLE1BQUE7QUFBQSxJQUFBO0FBQUEsSUFDZEEsOEJBQUFBO0FBQUFBLE1BQUM7QUFBQSxNQUFBO0FBQUEsUUFBSSxPQUFLO0FBQUEsUUFBQyxTQUFPO0FBQUEsUUFBQyxXQUFTO0FBQUEsUUFBQyxTQUFTO0FBQUEsUUFBVSxRQUFRO0FBQUEsUUFDbkQsTUFBTTtBQUFBLFFBQ04sT0FBTyxPQUFPLE1BQU07QUFBQSxRQUNwQixTQUFTLE9BQU87QUFBQSxNQUFBO0FBQUEsSUFBQTtBQUFBLElBQ3JCQSw4QkFBQUE7QUFBQUEsTUFBQztBQUFBLE1BQUE7QUFBQSxRQUFJLE9BQUs7QUFBQSxRQUFDLFNBQU87QUFBQSxRQUFDLFdBQVM7QUFBQSxRQUFDLFNBQVM7QUFBQSxRQUFVLFFBQVE7QUFBQSxRQUNuRCxNQUFNLElBQUUsT0FBTyxNQUFNO0FBQUEsUUFDckIsT0FBTztBQUFBLFFBQ1AsU0FBUztBQUFBLE1BQUE7QUFBQSxJQUFBO0FBQUEsSUFDZEEsOEJBQUFBO0FBQUFBLE1BQUM7QUFBQSxNQUFBO0FBQUEsUUFBSSxPQUFLO0FBQUEsUUFBQyxTQUFPO0FBQUEsUUFBQyxXQUFTO0FBQUEsUUFBQyxTQUFTO0FBQUEsUUFBVSxRQUFRO0FBQUEsUUFDbkQsTUFBTSxJQUFFLE9BQU8sTUFBTTtBQUFBLFFBQ3JCLE9BQU8sT0FBTyxNQUFNO0FBQUEsUUFDcEIsU0FBUyxPQUFPO0FBQUEsTUFBQTtBQUFBLElBQUE7QUFBQSxJQUNyQkEsOEJBQUFBO0FBQUFBLE1BQUM7QUFBQSxNQUFBO0FBQUEsUUFBSSxPQUFLO0FBQUEsUUFBQyxTQUFPO0FBQUEsUUFBQyxXQUFTO0FBQUEsUUFBQyxTQUFTO0FBQUEsUUFBVSxRQUFRO0FBQUEsUUFDbkQsTUFBTSxJQUFFLE9BQU8sTUFBTSxTQUFPLE9BQU8sTUFBTTtBQUFBLFFBQ3pDLE9BQU87QUFBQSxRQUNQLFNBQVM7QUFBQSxNQUFBO0FBQUEsSUFBQTtBQUFBLElBQ2RBLDhCQUFBQTtBQUFBQSxNQUFDO0FBQUEsTUFBQTtBQUFBLFFBQUksT0FBSztBQUFBLFFBQUMsU0FBTztBQUFBLFFBQUMsV0FBUztBQUFBLFFBQUMsU0FBUztBQUFBLFFBQVUsUUFBUTtBQUFBLFFBQ25ELE1BQU0sSUFBRSxPQUFPLE1BQU0sU0FBTyxPQUFPLE1BQU07QUFBQSxRQUN6QyxPQUFPLE9BQU8sTUFBTTtBQUFBLFFBQ3BCLFNBQVMsT0FBTztBQUFBLE1BQUE7QUFBQSxJQUFBO0FBQUEsRUFBTSxHQUMvQjtBQUNKO0FDdkRPLFNBQVMsYUFBYTtBQUFBLEVBQ3JCO0FBQUEsRUFDQTtBQUFBLEVBQ0EsR0FBRztBQUNQLEdBQUc7QUFDSCxRQUFNLENBQUMsU0FBUyxVQUFVLElBQUlJLE1BQUFBLFNBQVMsS0FBSztBQUM1QyxRQUFNLENBQUMsV0FBVyxZQUFZLElBQUlBLE1BQUFBLFNBQVMsQ0FBQSxDQUFFO0FBQzdDLFFBQU0sQ0FBQyxZQUFZLGFBQWEsSUFBSUEsTUFBQUEsU0FBUyxDQUFBLENBQUU7QUFDL0MsUUFBTSxDQUFDLFdBQVcsWUFBWSxJQUFJQSxNQUFBQSxTQUFTLEVBQUU7QUFDN0MsUUFBTSxDQUFDLGVBQWUsZ0JBQWdCLElBQUlBLE1BQUFBLFNBQVMsRUFBRTtBQUNyRCxRQUFNLENBQUMsU0FBUyxVQUFVLElBQUlBLE1BQUFBLFNBQVMsQ0FBQSxDQUFFO0FBQ3pDLFFBQU0sQ0FBQyxZQUFZLGFBQWEsSUFBSUEsTUFBQUEsU0FBUyxDQUFBLENBQUU7QUFDL0MsUUFBTSxDQUFDLGVBQWUsZ0JBQWdCLElBQUlBLE1BQUFBLFNBQVMsSUFBSTtBQUN2RCxRQUFNLENBQUMsYUFBYSxjQUFjLElBQUlBLE1BQUFBLFNBQVMsRUFBQyxHQUFFLEdBQUUsR0FBRSxHQUFFO0FBRXhELFFBQU0sY0FBYyxDQUFDLEdBQUUsTUFBTSxFQUFFLFVBQVUsQ0FBQyxJQUFFLEVBQUUsVUFBVSxDQUFDLElBQUUsSUFBRyxFQUFFLFVBQVUsQ0FBQyxNQUFJLEVBQUUsVUFBVSxDQUFDLElBQUUsSUFBRTtBQUNoRyxpQkFBZSxhQUFhO0FBQ3hCLFVBQU0sU0FBUyxNQUFNLFFBQVEsSUFBSTtBQUFBLE1BQzdCLFVBQVUsT0FBTztBQUFBLE1BQ2pCLFdBQVcsT0FBTztBQUFBLE1BQ2xCLFVBQVUsT0FBTztBQUFBLE1BQ2pCLGNBQWMsT0FBTztBQUFBLE1BQ3JCLFdBQVcsT0FBTztBQUFBLE1BQ2xCLFFBQVEsT0FBTztBQUFBLElBQUEsQ0FDbEI7QUFDRCxpQkFBYSxNQUFNLEtBQUssT0FBTyxDQUFDLENBQUMsRUFBRSxTQUFTLFdBQVcsQ0FBQztBQUN4RCxrQkFBYyxPQUFPLENBQUMsQ0FBQztBQUN2QixpQkFBYSxPQUFPLENBQUMsQ0FBQztBQUN0QixxQkFBaUIsT0FBTyxDQUFDLENBQUM7QUFDMUIsa0JBQWMsTUFBTSxLQUFLLE9BQU8sQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFBLE1BQUk7QUFDeEMsWUFBTSxLQUFLLEVBQUUsTUFBTSxPQUFPO0FBQzFCLGFBQU87QUFBQSxRQUNILE1BQU0sR0FBRyxDQUFDO0FBQUEsUUFDVixLQUFLLEdBQUcsQ0FBQztBQUFBLFFBQ1QsTUFBTSxHQUFHLENBQUM7QUFBQSxNQUFBO0FBQUEsSUFFbEIsQ0FBQyxDQUFDO0FBQ0YsZUFBVyxPQUFPLENBQUMsQ0FBQztBQUFBLEVBQ3hCO0FBQ0FOLFFBQUFBLFVBQVUsTUFBTTtBQUNaLGVBQUE7QUFBQSxFQUNKLEdBQUcsQ0FBQSxDQUFFO0FBQ0wsUUFBTSxtQkFBbUIsQ0FBQyxVQUFVO0FBQ2hDLFVBQU0sU0FBUyxNQUFNLFFBQVEsVUFBVSxHQUFFLENBQUM7QUFDMUMsVUFBTSxVQUFVLE1BQU0sUUFBUSxVQUFVLEdBQUUsQ0FBQztBQUMzQyxVQUFNLEVBQUMsR0FBRSxFQUFBLElBQUs7QUFFZCxVQUFNLE9BQU8sTUFBTSxRQUFRLFVBQVUsQ0FBQztBQUN0QyxRQUFJLFdBQVcsT0FBTyxXQUFXLE9BQVEsWUFBWSxPQUFPLFdBQVcsU0FBVTtBQUU3RSxlQUFTLFNBQVMsSUFBSSxFQUFFLEtBQUssQ0FBQSxXQUFVO0FBRW5DLGVBQU8sVUFBVSxPQUFPO0FBQUEsTUFDNUIsQ0FBQyxFQUFFLEtBQUssQ0FBQSxXQUFVO0FBQ2QscUJBQWEsT0FBTyxTQUFTLFdBQVcsQ0FBQztBQUFBLE1BQzdDLENBQUMsRUFBRSxNQUFNLENBQUEsVUFBUztBQUNkLG1CQUFXLGNBQWMsSUFBSSxXQUFXLEtBQUssSUFBSTtBQUFBLE1BQ3JELENBQUM7QUFBQSxJQUNMLFdBQVUsWUFBWSxPQUFPLFlBQVksS0FBSztBQUUxQyxpQkFBVyxTQUFTLElBQUksRUFBRSxLQUFLLENBQUEsV0FBVTtBQUVyQyxlQUFPLFVBQVUsT0FBTztBQUFBLE1BQzVCLENBQUMsRUFBRSxLQUFLLENBQUEsV0FBVTtBQUNkLHFCQUFhLE9BQU8sU0FBUyxXQUFXLENBQUM7QUFBQSxNQUM3QyxDQUFDLEVBQUUsTUFBTSxDQUFBLFVBQVM7QUFDZCxtQkFBVyxpQkFBaUIsSUFBSSxXQUFXLEtBQUssSUFBSTtBQUFBLE1BQ3hELENBQUM7QUFBQSxJQUNMO0FBQUEsRUFFSjtBQUNBLFFBQU0saUJBQWlCLENBQUMsVUFBVTtBQUU5QixVQUFNZ0IsT0FBSSxNQUFNLFFBQVEsVUFBVSxHQUFFLEVBQUUsRUFBRSxLQUFBO0FBQ3hDLFVBQU0sTUFBSSxNQUFNLFFBQVEsVUFBVSxFQUFFO0FBQ3BDLHFCQUFpQixHQUFHO0FBRXBCLFFBQUdBLEtBQUksVUFBUSxHQUFHO0FBQ2QsdUJBQWlCQSxJQUFHO0FBQUEsSUFDeEI7QUFBQSxFQUNKO0FBQ0EsUUFBTSxvQkFBb0IsQ0FBQyxVQUFVO0FBQ2pDLFFBQUcsY0FBYyxLQUFBLE1BQVcsSUFBRztBQUMzQixpQkFBVyxnQ0FBZ0M7QUFBQSxJQUMvQyxPQUFLO0FBQ0QsZ0JBQVUsU0FBUyxhQUFhLEVBQUUsS0FBSyxDQUFBLFdBQVU7QUFDN0MsZUFBTyxXQUFBO0FBQUEsTUFDWCxDQUFDLEVBQUUsS0FBSyxDQUFBLFdBQVU7QUFDZCxtQkFBVyxrQkFBa0IsYUFBYSxHQUFHO0FBQUEsTUFDakQsQ0FBQztBQUFBLElBQ0w7QUFBQSxFQUVKO0FBQ0EsUUFBTSxnQkFBZ0IsQ0FBQyxVQUFVO0FBQzdCLFdBQU8sU0FBUyxhQUFhLEVBQUUsS0FBSyxDQUFBLFdBQVU7QUFDMUMsYUFBTyxXQUFBO0FBQUEsSUFDWCxDQUFDLEVBQUUsS0FBSyxDQUFBLFdBQVU7QUFDZCxpQkFBVyxlQUFlLGFBQWEsR0FBRztBQUFBLElBQzlDLENBQUM7QUFBQSxFQUVMO0FBQ0EsUUFBTSxjQUFjLENBQUMsVUFBVTtBQUMzQixlQUFXLGFBQWEsV0FBVyxDQUFDLEVBQUUsSUFBSSxNQUFNLFNBQVMsR0FBRztBQUM1RCxZQUFRLFNBQVMsV0FBVyxDQUFDLEVBQUUsTUFBSyxTQUFTLEVBQUUsS0FBSyxDQUFBLFdBQVU7QUFDMUQsaUJBQVcsYUFBYSxXQUFXLENBQUMsRUFBRSxJQUFJLE1BQU0sU0FBUyxHQUFHO0FBQUEsSUFDaEUsQ0FBQztBQUNELGVBQVcsbUJBQW1CLE1BQU0sT0FBTyxJQUFJLFFBQVEsSUFBQSxDQUFLLEVBQUU7QUFBQSxFQUNsRTtBQUNBLFFBQU0sdUJBQXFCLENBQUMsaUJBQWlCO0FBQ3pDLHFCQUFpQixhQUFhLE1BQU07QUFBQSxFQUN4QztBQUNBLFFBQU0sY0FBWSxDQUFDLFVBQVM7QUFDeEIsVUFBTSxFQUFDLEdBQUUsRUFBQSxJQUFLO0FBRWQsWUFBTyxNQUFNLFFBQUE7QUFBQSxNQUNULEtBQUs7QUFBWTtBQUFBLE1BQ2pCLEtBQUs7QUFBWTtBQUFBLE1BQ2pCLEtBQUs7QUFBVTtBQUFBLE1BQ2YsS0FBSztBQUFVLGVBQU8sYUFBQSxFQUFlLHNCQUFBO0FBQXdCLGtCQUFVLE9BQU8sTUFBTTtBQUFFO0FBQUEsTUFDdEYsS0FBSztBQUFZLGVBQU8sZUFBQSxFQUFpQixzQkFBQTtBQUF3QixrQkFBVSxPQUFPLE1BQU07QUFBRTtBQUFBLE1BQzFGO0FBQVMsY0FBTSxJQUFJLE1BQU0sY0FBYyxLQUFLLENBQUM7QUFBQSxJQUFHO0FBRXBELG1CQUFlLEVBQUMsR0FBRSxHQUFFO0FBQUEsRUFDeEI7QUFDQSxRQUFNLFNBQVMsYUFBYSxXQUFXLENBQUMsS0FBRyxJQUFJLElBQUksc0JBQXNCLFNBQVMsd0JBQXdCLGFBQWE7QUFDdkgsUUFBTSxZQUFVLElBQUksV0FBVyxDQUFDLEtBQUcsQ0FBQSxHQUFJLElBQUksSUFBSSxTQUFTLElBQUksYUFBYSxJQUFJO0FBQzdFLFNBQ0lmLDhCQUFBQSxLQUFDLE9BQUEsRUFBSyxHQUFHLFVBQ0wsVUFBQTtBQUFBLElBQUFBLDhCQUFBQSxLQUFDLE9BQUEsRUFBSSxPQUFPLElBQUksUUFBUSxHQUFHLFFBQVEsRUFBRSxNQUFNLE9BQUEsR0FDdkMsVUFBQTtBQUFBLE1BQUFDLDhCQUFBQTtBQUFBQSxRQUFDO0FBQUEsUUFBQTtBQUFBLFVBQ0csT0FBSztBQUFBLFVBQ0wsTUFBSTtBQUFBLFVBQ0osT0FBSztBQUFBLFVBQ0wsV0FBUztBQUFBLFVBQ1QsU0FBTztBQUFBLFVBQ1AsV0FBVyxFQUFFLElBQUksS0FBSyxPQUFPLEVBQUUsSUFBRyxRQUFRLElBQUksU0FBTztBQUFBLFVBQ3JELE9BQU87QUFBQSxVQUNQLE9BQU8sRUFBQyxVQUFVLEVBQUMsSUFBSSxTQUFNO0FBQUEsVUFDN0IsVUFBVTtBQUFBLFVBQ1YsY0FBYztBQUFBLFVBQ2QsU0FBUztBQUFBLFFBQUE7QUFBQSxNQUFBO0FBQUEsd0NBRVosT0FBQSxFQUFJLEtBQUssSUFBSSxNQUFNLElBQUksT0FBTyxHQUFHLFFBQVEsR0FBRyxTQUFTLElBQUksWUFBWSxDQUFDLElBQUksWUFBWSxDQUFDLElBQUEsQ0FBSTtBQUFBLElBQUEsR0FDaEc7QUFBQSxJQUNBQSw4QkFBQUEsSUFBQyxPQUFBLEVBQUksU0FBUyxRQUFRLEtBQUssR0FBRyxNQUFNLEdBQUcsT0FBTyxXQUFXLFFBQVEsR0FBRyxNQUFNLE1BQUs7QUFBQSxJQUMvRUEsOEJBQUFBLElBQUMsT0FBQSxFQUFJLFNBQVMsU0FBUyxLQUFLLEdBQUcsTUFBTSxHQUFHLE9BQU8sUUFBUSxRQUFRLFFBQVEsRUFBQSxDQUFFO0FBQUEsSUFDekVBLDhCQUFBQTtBQUFBQSxNQUFDO0FBQUEsTUFBQTtBQUFBLFFBQ0csS0FBSztBQUFBLFFBQUksUUFBUTtBQUFBLFFBQ2pCLE9BQU87QUFBQSxRQUNQLGFBQWE7QUFBQSxRQUNiLFFBQVEsRUFBRSxNQUFNLE9BQUE7QUFBQSxRQUNoQixVQUFVO0FBQUEsTUFBQTtBQUFBLElBQUE7QUFBQSxJQUVkQSw4QkFBQUE7QUFBQUEsTUFBQztBQUFBLE1BQUE7QUFBQSxRQUNHLEtBQUs7QUFBQSxRQUFHLE1BQU07QUFBQSxRQUFJLE9BQU87QUFBQSxRQUFHLFFBQVE7QUFBQSxRQUNwQyxTQUFTO0FBQUEsUUFDVCxVQUFVLENBQUMsTUFBTTtBQUNiLDJCQUFpQixFQUFFLFVBQVU7QUFBQSxRQUNqQztBQUFBLE1BQUE7QUFBQSxJQUFBO0FBQUEsSUFFSkEsOEJBQUFBO0FBQUFBLE1BQUM7QUFBQSxNQUFBO0FBQUEsUUFDRyxLQUFLO0FBQUEsUUFBSSxNQUFNO0FBQUEsUUFBTSxRQUFRO0FBQUEsUUFBRyxPQUFPO0FBQUEsUUFDdkMsT0FBSztBQUFBLFFBQ0wsTUFBSTtBQUFBLFFBQ0osT0FBSztBQUFBLFFBQ0wsV0FBUztBQUFBLFFBQ1QsU0FBTztBQUFBLFFBQ1AsUUFBUTtBQUFBLFFBQ1IsT0FBTztBQUFBLFFBQ1AsT0FBTyxFQUFDLElBQUcsV0FBVSxJQUFHLFdBQVUsT0FBTSxFQUFDLElBQUcsV0FBVSxJQUFHLFVBQUEsRUFBUztBQUFBLFFBQ2xFLFNBQVM7QUFBQSxRQUNULFNBQVM7QUFBQSxNQUFBO0FBQUEsSUFBQTtBQUFBLElBRWJBLDhCQUFBQTtBQUFBQSxNQUFDO0FBQUEsTUFBQTtBQUFBLFFBQ0csS0FBSztBQUFBLFFBQUksTUFBTTtBQUFBLFFBQU8sUUFBUTtBQUFBLFFBQUcsT0FBTztBQUFBLFFBQ3hDLE9BQUs7QUFBQSxRQUNMLE1BQUk7QUFBQSxRQUNKLE9BQUs7QUFBQSxRQUNMLFdBQVM7QUFBQSxRQUNULFNBQU87QUFBQSxRQUNQLFFBQVE7QUFBQSxRQUNSLE9BQU87QUFBQSxRQUNQLE9BQU8sRUFBQyxJQUFHLFdBQVUsSUFBRyxXQUFVLE9BQU0sRUFBQyxJQUFHLFdBQVUsSUFBRyxVQUFBLEVBQVM7QUFBQSxRQUNsRSxTQUFTO0FBQUEsUUFDVCxTQUFTO0FBQUEsTUFBUyxhQUFhO0FBQUE7QUFBQSxNQUFBO0FBQUEsSUFBQTtBQUFBLElBRW5DQSw4QkFBQUE7QUFBQUEsTUFBQztBQUFBLE1BQUE7QUFBQSxRQUNHLEtBQUs7QUFBQSxRQUFJLE1BQU07QUFBQSxRQUFPLFFBQVE7QUFBQSxRQUFHLE9BQU87QUFBQSxRQUN4QyxPQUFLO0FBQUEsUUFDTCxNQUFJO0FBQUEsUUFDSixPQUFLO0FBQUEsUUFDTCxXQUFTO0FBQUEsUUFDVCxTQUFPO0FBQUEsUUFDUCxRQUFRO0FBQUEsUUFDUixPQUFPO0FBQUEsUUFDUCxPQUFPLEVBQUMsSUFBRyxXQUFVLElBQUcsV0FBVSxPQUFNLEVBQUMsSUFBRyxXQUFVLElBQUcsVUFBQSxFQUFTO0FBQUEsUUFDbEUsU0FBUztBQUFBLFFBQ1QsU0FBUztBQUFBLE1BQUE7QUFBQSxJQUFBO0FBQUEsSUFFYkEsOEJBQUFBLElBQUMsT0FBQSxFQUFJLE9BQU8sV0FBVyxLQUFLLElBQUksUUFBUSxFQUFFLE1BQU0sT0FBQSxHQUFVLFNBQVMsQ0FBQyxVQUFRO0FBQ3hFLFlBQU0sRUFBQyxHQUFFLEVBQUEsSUFBRztBQUNaLHVCQUFpQixjQUFjLEVBQUMsR0FBRSxFQUFBLENBQUUsQ0FBQztBQUFBLElBQ3pDLEdBQ0ksVUFBQUEsOEJBQUFBO0FBQUFBLE1BQUM7QUFBQSxNQUFBO0FBQUEsUUFDRyxPQUFLO0FBQUEsUUFDTCxNQUFJO0FBQUEsUUFDSixPQUFLO0FBQUEsUUFDTCxXQUFTO0FBQUEsUUFDVCxTQUFPO0FBQUEsUUFDUCxXQUFXLEVBQUUsSUFBSSxLQUFLLE9BQU8sRUFBRSxJQUFHLFFBQVEsSUFBSSxTQUFPO0FBQUEsUUFDckQsT0FBTztBQUFBLFFBQ1AsT0FBTyxFQUFDLFVBQVUsRUFBQyxJQUFJLFNBQU07QUFBQSxRQUM3QixVQUFVO0FBQUEsUUFDVixjQUFjO0FBQUEsUUFDZCxPQUFPO0FBQUEsTUFBQTtBQUFBLElBQUEsR0FFZjtBQUFBLElBQ0MsV0FDR0EsOEJBQUFBO0FBQUFBLE1BQUM7QUFBQSxNQUFBO0FBQUEsUUFDRyxPQUFNO0FBQUEsUUFDTixTQUFTLE1BQU0sV0FBVyxLQUFLO0FBQUEsUUFFL0IsVUFBQUEsOEJBQUFBLElBQUMsVUFBTSxVQUFBLFFBQUEsQ0FBUTtBQUFBLE1BQUE7QUFBQSxJQUFBO0FBQUEsRUFDbkIsR0FFUjtBQUVSO0FDbFBPLFNBQVMsY0FBYyxFQUFFLE9BQU8sc0JBQXNCO0FBQ3pELFNBQ0lELDhCQUFBQTtBQUFBQSxJQUFDO0FBQUEsSUFBQTtBQUFBLE1BQ0csS0FBSTtBQUFBLE1BQ0osTUFBSztBQUFBLE1BQ0wsT0FBTTtBQUFBLE1BQ04sUUFBTztBQUFBLE1BQ1AsUUFBUSxFQUFFLE1BQU0sT0FBQTtBQUFBLE1BQ2hCLE9BQU8sRUFBRSxJQUFJLE1BQUE7QUFBQSxNQUViLFVBQUE7QUFBQSxRQUFBQyw4QkFBQUE7QUFBQUEsVUFBQztBQUFBLFVBQUE7QUFBQSxZQUNHLE9BQU87QUFBQSxZQUFHLEtBQUs7QUFBQSxZQUFHLE9BQU87QUFBQSxZQUFHLFFBQVE7QUFBQSxZQUNwQyxPQUFLO0FBQUEsWUFDTCxXQUFTO0FBQUEsWUFDVCxTQUFTO0FBQUEsWUFDVCxRQUFRO0FBQUEsWUFDUixPQUFPO0FBQUEsWUFDUCxPQUFPLEVBQUMsSUFBRyxXQUFVLElBQUcsV0FBVSxPQUFNLEVBQUMsSUFBRyxXQUFVLElBQUcsVUFBQSxFQUFTO0FBQUEsWUFDbEUsU0FBUztBQUFBLFVBQUE7QUFBQSxRQUFBO0FBQUEsUUFDYkEsOEJBQUFBLElBQUMsT0FBQSxFQUFJLEtBQUssR0FBRyxNQUFNLEdBQUksVUFBQTtBQUFBLEVBQTBCLE1BQU0sT0FBTztBQUFBLEVBQUssTUFBTSxLQUFLLEdBQUEsQ0FBRztBQUFBLE1BQUE7QUFBQSxJQUFBO0FBQUEsRUFBQTtBQUc3RjtBQ1JBLE1BQU0sNkJBQTJCO0FBQUEsRUFDN0IsTUFBSztBQUFBLEVBQ0wsT0FBTTtBQUFBLEVBQ04sYUFBWTtBQUFBLElBQ1IsY0FBa0IsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFBLEdBQVMsU0FBUSxTQUFBO0FBQUEsSUFDL0MsZUFBaUIsRUFBQyxPQUFPLEVBQUMsSUFBRyxNQUFBLEdBQU8sU0FBUSxVQUFBO0FBQUEsSUFDNUMsWUFBa0IsRUFBQyxPQUFPLEVBQUMsSUFBRyxRQUFBLEdBQVMsU0FBUSx5Q0FBQTtBQUFBLElBQy9DLFFBQWtCLEVBQUMsT0FBTyxFQUFDLElBQUcsU0FBQSxHQUFVLFNBQVEsYUFBQTtBQUFBLEVBQVk7QUFFcEU7QUFDTyxTQUFTLElBQUksT0FBTTtBQUV4QixRQUFNLGlCQUFlSCxNQUFBQSxPQUFPLElBQUk7QUFDaEMsUUFBTSxDQUFDLFNBQVMsVUFBVSxJQUFJTyxNQUFBQSxTQUFTLEtBQUs7QUFDNUMsUUFBTSxDQUFDLFlBQVksYUFBYSxJQUFJQSxNQUFBQSxTQUFTLEtBQUs7QUFDbEQsUUFBTSxDQUFDLG1CQUFtQixvQkFBb0IsSUFBSUEsTUFBQUEsU0FBUyxFQUFFO0FBQzdELFFBQU0sQ0FBQyxjQUFjLGVBQWUsSUFBSUEsTUFBQUEsU0FBUyxJQUFJO0FBQ3JELFFBQU0sQ0FBQyxhQUFhLGNBQWMsSUFBSUEsTUFBQUEsU0FBUyxDQUFBLENBQUU7QUFDakQsUUFBTSxDQUFDLGFBQWEsY0FBYyxJQUFNQSxNQUFBQSxTQUFTLEVBQUU7QUFDbkQsUUFBTSxDQUFDLFNBQVMsVUFBVSxJQUFNQSxNQUFBQSxTQUFTLFFBQVEsS0FBSztBQUN0RCxRQUFNLENBQUMsV0FBVyxZQUFZLElBQUlBLE1BQUFBLFNBQVMsQ0FBQSxDQUFFO0FBVTdDLFFBQU0sYUFBYSxDQUFDLFNBQVM7QUFDM0Isb0JBQWdCLEtBQUssUUFBUTtBQUM3QixVQUFNLGlCQUFlLEVBQUMsR0FBRyxZQUFBO0FBQ3pCLG1CQUFlLEtBQUssU0FBUyxRQUFRLFNBQVEsRUFBRSxDQUFDLElBQUk7QUFDcEQsbUJBQWUsY0FBYztBQUM3QixtQkFBZSxXQUFXLEtBQUssT0FBTyxFQUFFO0FBQ3hDLFNBQUssU0FBUyxLQUFLLFFBQVEsRUFBRSxLQUFLLGNBQWM7QUFBQSxFQUNsRDtBQU1BLFFBQU0sWUFBWSxPQUFPLFFBQVE7QUFDL0IsZUFBVyxnQkFBZ0IsT0FBTyxLQUFLLEdBQUcsQ0FBQyxFQUFFO0FBQUEsRUFDL0M7QUFPQSxRQUFNLHdCQUF3QixDQUFDLEVBQUMsUUFBQUYsU0FBTyxJQUFHLEtBQUksYUFBWSxlQUFhO0FBQ3JFLHlCQUFxQixjQUFjLEVBQUMsUUFBUSxFQUFDLFNBQVFBLFFBQU8sUUFBQSxHQUFTLFVBQVMsSUFBRyxLQUFJLFlBQUEsQ0FBWSxDQUFDO0FBQUEsRUFDcEc7QUFDQSxRQUFNLHFCQUFxQixDQUFDLElBQUcsUUFBTztBQUFBLEVBRXRDO0FBQ0EsUUFBTSxZQUFVLE1BQUk7QUFDaEIsVUFBTSxVQUFVO0FBQUEsRUFBWSxrQkFBbUI7QUFDL0MsV0FBT0Ysa0NBQUMsU0FBSSxTQUFpQjtBQUFBLEVBQ2pDO0FBQ0EsUUFBTSxrQkFBZ0IsTUFBSTtBQUN0QixRQUFHLG1CQUFtQixNQUFNO0FBQ3hCLGFBQU8sQ0FBQTtBQUFBLElBQ1g7QUFDQSxRQUFHLGVBQWUsWUFBWSxNQUFNO0FBQ2hDLGFBQU8sQ0FBQTtBQUFBLElBQ1g7QUFDQSxVQUFNLE9BQU8sZUFBZSxRQUFRO0FBQ3BDLFdBQU8sT0FBTyxLQUFLLFdBQVcsRUFBRTtBQUFBLE1BQzVCLENBQUEsTUFBSztBQUNELGVBQU8sRUFBRSxPQUFPLEtBQUssUUFBTSxHQUFFLEdBQUcsSUFBRTtBQUFBLE1BQ3RDO0FBQUEsSUFBQTtBQUFBLEVBRVI7QUFFRSxRQUFNLGVBQWEsQ0FBQyxjQUFZO0FBQ1gsb0JBQUE7QUFDakIsVUFBTSxFQUFDLE9BQU8sY0FBYyxNQUFNLFFBQU8sRUFBQyxHQUFFLEVBQUEsR0FBRyxjQUFjLFFBQVEsZUFBZSxPQUFNLFFBQU8sa0JBQWlCLFdBQVU7QUFFNUgsUUFBSSxJQUFJLE9BQU8sS0FBSyxXQUFXLEVBQUUsQ0FBQztBQUNsQyxRQUFJLE9BQU8sWUFBWSxDQUFDO0FBR3hCLFlBQU8sT0FBTyxPQUFPLENBQUEsTUFBSyxNQUFJLFlBQVksRUFBRSxLQUFLLEdBQUcsR0FBQTtBQUFBLE1BQ2hELEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFDRCxpQkFBUSxvQkFBa0IsRUFBQyxNQUFLLFlBQUEsR0FBYyxNQUFBO0FBQUEsVUFDMUMsS0FBSztBQUNELHVCQUFXLElBQUk7QUFFZjtBQUFBLFVBQ0osS0FBSztBQUNELGtCQUFNLGlCQUFlLEVBQUMsR0FBRyxZQUFBO0FBQ3pCLG1CQUFPLGVBQWUsQ0FBQztBQUN2QiwyQkFBZSxjQUFjO0FBQzdCLHVCQUFXO0FBQUEsRUFBVSxLQUFLLFFBQVEsaUJBQWlCLFlBQVksa0JBQWtCLEtBQUssUUFBUSxHQUFHO0FBQ2pHLGdCQUFHLGlCQUFpQixLQUFLLFVBQVM7QUFDOUIsa0JBQUksT0FBTyxLQUFLLFdBQVcsRUFBRSxJQUFFLENBQUM7QUFDaEMscUJBQU8sWUFBWSxDQUFDO0FBQ3BCLDhCQUFnQixLQUFLLFFBQVE7QUFBQSxZQUNqQztBQUdBO0FBQUEsUUFBQTtBQUVSO0FBQUEsTUFDSjtBQUNJLGNBQU0sSUFBSSxNQUFNLGdDQUFnQyxNQUFNLEdBQUc7QUFBQSxJQUFBO0FBQUEsRUFFckU7QUFDRixTQUNJRCw4QkFBQUEsS0FBQVcsd0JBQUEsRUFDQSxVQUFBO0FBQUEsSUFBQVgsbUNBQUNZLHNCQUFBQSxRQUFLLE1BQU0sR0FBRyxNQUFNLElBQUksWUFBVSxNQUMvQixVQUFBO0FBQUEsTUFBQVosOEJBQUFBLEtBQUMsT0FBQSxFQUFNLEtBQUssR0FBRyxLQUFLLEdBQUcsU0FBUyxHQUFHLFNBQVMsR0FDeEMsVUFBQTtBQUFBLFFBQUFDLDhCQUFBQSxJQUFDLEtBQUEsRUFBSSxNQUFLLFdBQ04sVUFBQUQsOEJBQUFBLEtBQUNZLHNCQUFBQSxRQUFLLE1BQU0sR0FBRyxNQUFNLEdBQ3JCLFVBQUE7QUFBQSxVQUFBWCw4QkFBQUE7QUFBQUEsWUFBQztBQUFBLFlBQUE7QUFBQSxjQUFZLEtBQUs7QUFBQSxjQUFHLEtBQUs7QUFBQSxjQUFHLFNBQVM7QUFBQSxjQUFHLFNBQVM7QUFBQSxjQUM3QyxPQUFPO0FBQUEsY0FBaUIsS0FBSztBQUFBLGNBQzlCLFVBQUFBLDhCQUFBQTtBQUFBQSxnQkFBQztBQUFBLGdCQUFBO0FBQUEsa0JBQ0csT0FBTyxnQkFBQTtBQUFBLGtCQUNQLGFBQWE7QUFBQSxrQkFDYixNQUFJO0FBQUEsa0JBQUMsT0FBSztBQUFBLGtCQUFDLFFBQU07QUFBQSxrQkFBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLElBQUksU0FBTztBQUFBLGtCQUNsRCxXQUFXLEVBQUUsSUFBSSxLQUFLLE9BQU8sRUFBRSxJQUFHLFFBQVEsSUFBSSxTQUFPO0FBQUEsa0JBQ3JEO0FBQUEsa0JBQ0EsY0FBYztBQUFBLGdCQUFBO0FBQUEsY0FBQTtBQUFBLFlBQ2xCO0FBQUEsWUFUTTtBQUFBLFVBQUE7QUFBQSxVQVdWQSw4QkFBQUE7QUFBQUEsWUFBQztBQUFBLFlBQUE7QUFBQSxjQUNJLEtBQUs7QUFBQSxjQUFHLEtBQUs7QUFBQSxjQUFHLFNBQVM7QUFBQSxjQUFHLFNBQVM7QUFBQSxjQUNyQyxPQUFPO0FBQUEsY0FFUixVQUFBQSw4QkFBQUE7QUFBQUEsZ0JBQUM7QUFBQSxnQkFBQTtBQUFBLGtCQUNHLEtBQUs7QUFBQSxrQkFDTCxRQUFRO0FBQUEsa0JBQ1I7QUFBQSxrQkFDQSxhQUFhO0FBQUEsa0JBQ2IsY0FBYztBQUFBLGtCQUNkLE9BQU87QUFBQSxrQkFFUCxVQUFBQSw4QkFBQUE7QUFBQUEsb0JBQUM7QUFBQSxvQkFBQTtBQUFBLHNCQUNHLE9BQUs7QUFBQSxzQkFDTCxNQUFJO0FBQUEsc0JBQ0osT0FBSztBQUFBLHNCQUNMLFdBQVM7QUFBQSxzQkFDVCxTQUFPO0FBQUEsc0JBQ1AsUUFBUTtBQUFBLHNCQUNSLFFBQVE7QUFBQSxzQkFDUixRQUFRO0FBQUEsc0JBQ1IsT0FBTztBQUFBLHNCQUNQLE9BQU8sRUFBQyxJQUFHLFdBQVUsSUFBRyxXQUFVLE9BQU0sRUFBQyxJQUFHLFdBQVUsSUFBRyxVQUFBLEVBQVM7QUFBQSxzQkFDbEUsU0FBUyxNQUFNO0FBQ1gsc0NBQWMsSUFBSTtBQUFBLHNCQUN0QjtBQUFBLHNCQUNBLFNBQVM7QUFBQSxvQkFBQTtBQUFBLGtCQUFBO0FBQUEsZ0JBQVk7QUFBQSxjQUFBO0FBQUEsWUFDN0I7QUFBQSxZQTNCTTtBQUFBLFVBQUE7QUFBQSxRQTRCVixFQUFBLENBQ0EsRUFBQSxDQUNKO0FBQUEsUUFDQUEsa0NBQUMsS0FBQSxFQUFJLE1BQUssT0FDTiw0Q0FBQyxjQUFBLEVBQWEsU0FBa0IsS0FBSyxHQUFHLEtBQUssR0FBRyxTQUFTLEdBQUcsU0FBUyxHQUFFLEdBQzNFO0FBQUEsUUFDQUEsOEJBQUFBLElBQUMsT0FBSSxNQUFNLFNBQ1AsNENBQUMsT0FBQSxFQUNJLFVBQUEsVUFBQSxHQUNMLEVBQUEsQ0FDSjtBQUFBLFFBQ0FBLDhCQUFBQSxJQUFDLEtBQUEsRUFBSSxNQUFNLFFBQVEsWUFBWSxNQUFJO0FBQUMsa0JBQVEsS0FBSyxDQUFDO0FBQUEsUUFBQyxHQUMvQyxVQUFBQSw4QkFBQUEsSUFBQyxPQUFBLEVBQUksWUFBWSxNQUFJO0FBQUMsa0JBQVEsS0FBSyxDQUFDO0FBQUEsUUFBQyxHQUNoQyxVQUFBLFVBQUEsRUFBVSxDQUNmLEVBQUEsQ0FDSjtBQUFBLE1BQUEsR0FDSjtBQUFBLE1BRUFBLDhCQUFBQTtBQUFBQSxRQUFDO0FBQUEsUUFBQTtBQUFBLFVBQTBCLEtBQUs7QUFBQSxVQUFHLEtBQUs7QUFBQSxVQUFHLFNBQVM7QUFBQSxVQUFHLFNBQVM7QUFBQSxVQUNwRCxRQUFRLEVBQUUsTUFBTSxPQUFBO0FBQUEsVUFDaEIsUUFBUSxnQkFBZ0Isb0JBQW9CLFFBQVEsU0FBUSxFQUFFO0FBQUEsVUFDOUQsVUFBVSxnQkFBYztBQUFBLFVBQ3hCLFlBQVk7QUFBQSxVQUNaLFVBQVU7QUFBQSxVQUNWLFNBQVM7QUFBQSxRQUFBO0FBQUEsTUFBQTtBQUFBLE1BRXJCQSw4QkFBQUE7QUFBQUEsUUFBQztBQUFBLFFBQUE7QUFBQSxVQUNHLEtBQUs7QUFBQSxVQUFHLEtBQUs7QUFBQSxVQUFHLFNBQVM7QUFBQSxVQUFHLFNBQVM7QUFBQSxVQUNyQyxRQUFRLEVBQUUsTUFBTSxPQUFBO0FBQUEsVUFDaEIsWUFBVTtBQUFBLFVBQ1YsV0FBUztBQUFBLFVBQ1QsT0FBSztBQUFBLFVBQ0wsTUFBSTtBQUFBLFVBQ0osT0FBTztBQUFBLFVBQ1AsVUFBVTtBQUFBLFVBRVQsVUFBQTtBQUFBLFFBQUE7QUFBQSxNQUFBO0FBQUEsSUFDTCxHQUVGO0FBQUEsSUFDQyxXQUNHQSw4QkFBQUE7QUFBQUEsTUFBQztBQUFBLE1BQUE7QUFBQSxRQUNHLE9BQU87QUFBQSxRQUNQLE9BQU07QUFBQSxRQUNOLFNBQVMsTUFBTSxXQUFXLEtBQUs7QUFBQSxRQUVqQyxVQUFBQSw4QkFBQUEsSUFBQyxVQUFNLFVBQUEsUUFBQSxDQUFRO0FBQUEsTUFBQTtBQUFBLElBQUE7QUFBQSxJQUdwQixjQUNJQSw4QkFBQUE7QUFBQUEsTUFBQ2dCLG1CQUFBQTtBQUFBQSxNQUFBO0FBQUEsUUFDRSxtQkFBbUI7QUFBQSxRQUNuQixTQUFTLE1BQU07QUFDWCx3QkFBYyxLQUFLO0FBQUEsUUFDdkI7QUFBQSxRQUNBLFNBQVMsTUFBTSxjQUFjLEtBQUs7QUFBQSxRQUV0QyxVQUFBaEIsOEJBQUFBO0FBQUFBLFVBQUM7QUFBQSxVQUFBO0FBQUEsWUFDRyxPQUFNO0FBQUEsWUFDTixnQkFBZ0IsQ0FBQyxVQUFRO0FBQ3JCLDRCQUFjLEtBQUs7QUFDbkIsa0JBQUcsT0FBTztBQUNOLDJCQUFXLG1CQUFtQixNQUFNLFFBQVEsRUFBRTtBQUM5QywyQkFBVyxNQUFNLFFBQVE7QUFBQSxjQUM3QjtBQUFBLFlBQ0o7QUFBQSxVQUFBO0FBQUEsUUFBQTtBQUFBLE1BQ0o7QUFBQSxJQUFBO0FBQUEsRUFDQSxHQUVSO0FBRUo7Ozs7Ozs7Ozs7O0FDeE9BLE1BQU0sU0FBUyxRQUFRLE9BQU87QUFBQSxFQUM1QixVQUFVO0FBQUEsRUFDVixhQUFhO0FBQUEsRUFDYixPQUFPLFFBQVEsUUFBUSxHQUFHLEtBQUssUUFBUSxNQUFNLEdBQUcsUUFBUSxPQUFPLFVBQVUsR0FBRSxDQUFDLENBQUMsT0FBTyxRQUFRLElBQUk7QUFBQSxFQUNoRyxNQUFNO0FBQ1IsQ0FBQztBQUdELE9BQU8sSUFBSSxDQUFDLE9BQU8sS0FBSyxHQUFHLE1BQU0sUUFBUSxLQUFLLENBQUMsQ0FBQztBQUNoRCxPQUFPLElBQUksQ0FBQyxPQUFPLFNBQVMsSUFBSSxHQUFHLE1BQU07QUFFdkMsUUFBTSxPQUFPLE9BQU8sV0FBQTtBQUVwQixLQUFHLGNBQWMsY0FBYyxNQUFNLE1BQU07QUFDM0MsVUFBUSxJQUFJLDhCQUE4QjtBQUU1QyxDQUFDO0FBQ0QsT0FBTyxZQUFBO0FBRVBpQixhQUFBQSxPQUFPakIsa0NBQUMsS0FBQSxDQUFBLENBQUksR0FBSSxNQUFNOyJ9
