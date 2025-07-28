#!/usr/bin/env node
"use strict";
const jsxRuntime_js = require("react/jsx-runtime.js");
require("raf/polyfill.js");
const React = require("react");
const blessed = require("blessed");
const reactBlessed = require("react-blessed");
const fs = require("fs");
const path = require("path");
const ignore = require("ignore");
const reactBlessedContrib17 = require("react-blessed-contrib-17");
require("blessed/lib/widgets/message.js");
const util = require("util");
const cp = require("child_process");
const exec = util.promisify(cp.exec);
async function getStatus(cwd) {
  const { stdout } = await exec("git status --porcelain", { cwd });
  return stdout.split("\n").filter(Boolean);
}
class INode {
  id = 0;
  /// (file stat ino)
  type = "";
  ///  ( one of 'd','f','l','p')
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
    return this.relPath.split("/").length;
  }
  toText() {
    const marker = this.type.indexOf("d") > -1 ? this.isOpen ? "[-]" : "[+]" : " ";
    return `${" ".repeat(this.depth() * 2)}${marker} ${this.name}`;
  }
  /**
   *
   * @param depth current depth
   * @returns {INode[]}
   */
  flatten(depth = 0) {
    let out = [];
    out.push(this);
    if (this.isOpen) {
      const o = this.children.flatMap((child) => child.flatten(depth + 1));
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
    const stat = await fs.promises.stat(this.fullPath);
    this.id = stat.ino;
    this.type = [
      stat.isDirectory() ? "d" : "-",
      stat.isFile() ? "f" : "-",
      stat.isSymbolicLink() ? "l" : "-",
      stat.isBlockDevice() ? "b" : "-",
      stat.isCharacterDevice() ? "c" : "-",
      stat.isFIFO() ? "p" : "-",
      stat.isSocket() ? "s" : "?"
    ].join("");
    this.name = path.basename(this.fullPath);
    this.relPath = path.relative(rootDir, this.fullPath);
    this.isOpen = false;
    this.children = [];
    this.entries = this.type.indexOf("d") > -1 ? await fs.promises.readdir(this.fullPath) : [];
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
    this.children = await Promise.all(
      this.entries.map((entry) => {
        const inode1 = new INode();
        inode1.fullPath = path.join(this.fullPath, entry);
        return inode1.init(rootDir, ig, inode1.fullPath);
      })
    );
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
      let children = await Promise.all(
        entries.map((entry) => {
          const inode1 = new INode();
          inode1.fullPath = path.join(this.fullPath, entry);
          inode1.init(rootDir, ig, this.fullPath);
          return inode1.refresh(rootDir, ig);
        })
      );
      children = children.filter((x) => x !== null);
      children.sort((a, b) => {
        const aa = `${a.type}${a.name}`;
        const bb = `${b.type}${b.name}`;
        return aa > bb ? 1 : aa === bb ? 0 : -1;
      });
    }
    return this;
  }
}
let Workspace$1 = class Workspace2 {
  rootDir = "";
  rootNode = new INode();
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
    return this;
  }
  flatten() {
    let fmap = this.rootNode.flatten();
    return fmap;
  }
  // build a flat list of visible nodes
  /**
   *
   * @returns {Workspace}
   */
  copy() {
    let wks = new Workspace2();
    wks.rootDir = this.rootDir;
    wks.rootNode = this.rootNode;
    wks.ig = this.ig;
    return wks;
  }
};
function FileTree({ workspace, treeData, onDirSelect, onFileSelect, label }) {
  let lines = (treeData || []).map((v, i, a) => {
    return v.toText();
  });
  const itemSelect = (n, idx) => {
    const node = treeData[idx];
    if (node.type.indexOf("d") > -1) {
      onDirSelect(node);
    } else {
      onFileSelect(node);
    }
  };
  return (
    // <>
    //     <text>{workspacePath}</text>
    //     <text>{JSON.stringify(items,null,' ')}</text>
    // </>
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { label, children: /* @__PURE__ */ jsxRuntime_js.jsx(
      "list",
      {
        scrollbar: { ch: "=", track: { fg: "blue", bg: "grey" } },
        top: 0,
        bottom: 1,
        items: lines,
        keys: true,
        mouse: true,
        style: { selected: { bg: "blue" } },
        onSelect: itemSelect,
        label
      }
    ) })
  );
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
function FolderPickerDialog({
  title = "Dialog",
  width = "50%",
  height = "50%",
  onClose,
  onFolderSelect
}) {
  const boxRef = React.useRef();
  const [treeData, setTreeData] = React.useState([]);
  const [workspace, setWorkspace] = React.useState(new Workspace());
  React.useEffect(() => {
    const node = boxRef.current;
    if (node) node.focus();
    workspace.init("/").then((wk) => workspace.open(workspace.rootNode)).then((t) => {
      const wk = workspace.copy();
      const td = workspace.flatten();
      setWorkspace(wk);
      setTreeData(td);
    });
  }, []);
  const selectDir = async (dir) => {
    if (dir.isOpen) {
      dir.close();
      const wk = workspace.copy();
      const td = wk.flatten();
      setWorkspace(wk);
      setTreeData(td);
    } else {
      dir.open(workspace.rootDir, workspace.ig).then((n) => {
        const wk = workspace.copy();
        const td = wk.flatten();
        setWorkspace(wk);
        setTreeData(td);
      });
    }
  };
  const selectFile = async (dir) => {
  };
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
        /* @__PURE__ */ jsxRuntime_js.jsx("box", { top: 2, left: 1, right: 1, bottom: 1, scrollable: true, keys: true, mouse: true, alwaysScroll: true, children: /* @__PURE__ */ jsxRuntime_js.jsx(FileTree, { top: 1, bottom: 0, workspace, treeData, onDirSelect: selectDir, onFileSelect: selectFile }) }),
        /* @__PURE__ */ jsxRuntime_js.jsxs("box", { top: 3, height: 1, children: [
          /* @__PURE__ */ jsxRuntime_js.jsx(
            "text",
            {
              mouse: true,
              clickable: true,
              underline: true,
              onClick: () => {
                onFolderSelect();
                setShowModal(false);
              },
              children: "Select"
            }
          ),
          /* @__PURE__ */ jsxRuntime_js.jsx(
            "text",
            {
              left: 6,
              mouse: true,
              clickable: true,
              underline: true,
              onClick: () => {
                setShowModal(false);
                onClose();
              },
              children: "Cancel"
            }
          )
        ] })
      ]
    }
  );
}
function VTabs({ children, ...boxProps }) {
  const tabs = React.Children.toArray(children).filter((child) => React.isValidElement(child) && child.props.name);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const styleActive = { fg: "black", underline: true, bg: "orange" };
  const styleInactive = {};
  return /* @__PURE__ */ jsxRuntime_js.jsx("box", { ...boxProps, children: /* @__PURE__ */ jsxRuntime_js.jsxs(reactBlessedContrib17.Grid, { rows: 1, cols: 6, hideBorder: true, children: [
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { row: 0, col: 0, rowSpan: 1, colSpan: 1, children: tabs.map((tab, i) => /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        top: i,
        mouse: true,
        clickable: true,
        bold: activeIndex === i,
        onClick: () => setActiveIndex(i),
        style: activeIndex === i ? styleActive : styleInactive,
        children: activeIndex === i ? `> ${tab.props.name}` : `  ${tab.props.name}`
      },
      tab.props.name
    )) }),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { row: 0, col: 1, rowSpan: 1, colSpan: 5, children: tabs[activeIndex].props.children })
  ] }) });
}
function Tab({ children }) {
  return /* @__PURE__ */ jsxRuntime_js.jsx(jsxRuntime_js.Fragment, { children });
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
    Number: { style: { fg: "red" }, pattern: "\\d+(?:\\.\\d+)?" },
    Identifier: { style: { fg: "green" }, pattern: "[A-Za-z_]\\w*" },
    String: { style: { fg: "yellow" }, pattern: `"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'` },
    Operator: { style: { fg: "cyan" }, pattern: "==|!=|<=|>=|[+\\-*/=<>]" },
    Punctuation: { style: { fg: "cyan" }, pattern: "[()[\\]{}.,;]" },
    Whitespace: { style: { fg: "white" }, pattern: "\\s+" }
  } },
  js: { name: "js", definitions: {
    Keyword: { style: { fg: "magenta" }, pattern: "(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)" },
    Number: { style: { fg: "red" }, pattern: "\\d+(?:\\.\\d+)?" },
    String: { style: { fg: "yellow" }, pattern: `"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'` },
    Operator: { style: { fg: "cyan" }, pattern: "==|!=|<=|>=|[+\\-*/=<>]" },
    Punctuation: { style: { fg: "cyan" }, pattern: "[()[\\]{}.,;]" },
    Whitespace: { style: { fg: "white" }, pattern: "\\s+" },
    Identifier: { style: { fg: "green" }, pattern: "[A-Za-z_]\\w*" }
  } },
  jsx: { name: "jsx", definitions: {
    ReactToken: { style: { fg: "yellow" }, pattern: "use[A-Z][a-z]*" },
    Keyword: { style: { fg: "magenta" }, pattern: "(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)" },
    JsxTag: { style: { fg: "yellow" }, pattern: "\\<(\\/){0,1}[a-zA-Z-]*\\>" },
    Number: { style: { fg: "red" }, pattern: "\\d+(?:\\.\\d+)?" },
    String: { style: { fg: "yellow" }, pattern: `"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'` },
    Operator: { style: { fg: "cyan" }, pattern: "==|!=|<=|>=|[+\\-*/=<>]" },
    Punctuation: { style: { fg: "cyan" }, pattern: "[()[\\]{}.,;]" },
    Whitespace: { style: { fg: "white" }, pattern: "\\s+" },
    Identifier: { style: { fg: "green" }, pattern: "[A-Za-z_]\\w*" }
  } },
  c: { name: "c", definitions: {
    Keyword: { style: { fg: "magenta" }, pattern: "(int|const|char|long|if|else|for|while|return)" },
    Number: { style: { fg: "red" }, pattern: "\\d+(?:\\.\\d+)?" },
    String: { style: { fg: "yellow" }, pattern: `"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'` },
    Operator: { style: { fg: "cyan" }, pattern: "==|!=|<=|>=|[+\\-*/=<>]" },
    Punctuation: { style: { fg: "cyan" }, pattern: "[()[\\]{}.,;]" },
    Whitespace: { style: { fg: "white" }, pattern: "\\s+" },
    Identifier: { style: { fg: "green" }, pattern: "[A-Za-z_]\\w*" }
  } }
};
function getTokenizer(name) {
  const tokenizerDef = namedTokenizers[name] || namedTokenizers["any"];
  const tokenRegex = new RegExp(
    Object.entries(tokenizerDef.definitions).map(([name2, definition]) => `(?<${name2}>${definition.pattern})`).join("|"),
    "g"
  );
  return function tokenizer(code, lineNumber) {
    const tokens = [];
    for (const m of code.matchAll(tokenRegex)) {
      const groups = m.groups;
      const type = Object.keys(groups).find((key) => groups[key] !== void 0);
      tokenizerDef.definitions[type];
      tokens.push(TokenizerToken.fromRegexpMatch(m, tokenizerDef, name, lineNumber));
    }
    return tokens;
  };
}
class MemoryBufferEditor {
  /**
   * @param {string} filePath
   * @param {{rows:number, cols:number}} windowSize
   */
  constructor(filePath, windowSize) {
    this.filePath = filePath;
    this.windowStartRow = 0;
    this.windowStartCol = 0;
    this.windowRows = windowSize.rows;
    this.windowCols = windowSize.cols;
    this.cursorY = 0;
    this.cursorX = 0;
    this.cursorStyle = {};
    this.cursorChar = "#";
    this.lines = [];
    this._to = 0;
    this._saved = "";
    this.setFilePath(filePath);
  }
  setFilePath(filePath) {
    this.filePath = filePath;
    this.lines = fs.readFileSync(filePath, { encoding: "utf-8" }).split("\n");
    this.updateTokens();
  }
  save() {
    clearTimeout(this._to);
    this._to = setTimeout(() => {
      fs.writeFileSync(this.filePath, this.lines.join("\n"));
      this._saved = `saved ${(/* @__PURE__ */ new Date()).toISOString()}`;
    }, 1e3);
  }
  // ── private ────────────────────────────────────────────────────────────
  _ensureCursorInView() {
    if (this.cursorY < this.windowStartRow) {
      this.windowStartRow = this.cursorY;
    } else if (this.cursorY >= this.windowStartRow + this.windowRows) {
      this.windowStartRow = this.cursorY - this.windowRows;
    }
    if (this.cursorX < this.windowStartCol) {
      this.windowStartCol = this.cursorX;
    } else if (this.cursorX >= this.windowStartCol + this.windowCols) {
      this.windowStartCol = this.cursorX - this.windowCols;
    }
  }
  // compute byte‐offset in file for (row, col)
  _offsetFor(row, col) {
    let offsetStart = 0;
    let offsetEnd = 0;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      offsetStart = offsetEnd;
      offsetEnd = offsetEnd + line.length + 1;
      if (i == row) {
        if (col <= line.length) {
          return offsetStart + col;
        } else {
          return offsetEnd;
        }
      }
    }
    return offsetEnd;
  }
  /**
   * @returns {{ rowInWindow: number, colInWindow: number }}
   *   0-based coords of the cursor inside the viewport
   */
  getCursorWindowCoords() {
    return {
      y: this.cursorY - this.windowStartRow,
      x: this.cursorX - this.windowStartCol
    };
  }
  updateTokens() {
    const ps = this.filePath.split(".");
    const tokenizer = getTokenizer(ps[ps.length - 1]);
    this.tokens = this.lines.reduce((r, line, lineNumber) => {
      const tokens = tokenizer(line, lineNumber);
      r[lineNumber] = tokens;
      return r;
    }, {});
  }
  /**
  * @param {(code:string)=>TokenizerToken[]} tokenizer
  * @returns {{[lineNumber:string]:TokenizerToken[]}}
  *
  * */
  render() {
    return Object.keys(this.tokens).reduce(
      (visible, lineNumber) => {
        if (parseInt(lineNumber) >= this.windowStartRow && parseInt(lineNumber) < this.windowStartRow + this.windowRows) {
          visible[lineNumber] = this.tokens[lineNumber];
          const tokens = this.tokens[lineNumber];
          let col = 0;
          if (this.cursorY == lineNumber) {
            this.cursorChar = " ";
            for (const tok of tokens) {
              if (this.cursorX >= tok.start && this.cursorX < tok.end) {
                this.cursorStyle = tok.style;
                this.cursorChar = (this.lines[lineNumber] || " ")[this.cursorX] || " ";
                break;
              }
              col += tok.text.length;
            }
          }
          if (this.cursorStyle == null) {
            const last = tokens.slice(-1)[0];
            this.cursorStyle = last ? last.style : {};
            this.cursorChar = last && last.text.length ? last.text[last.text.length - 1] : "#";
          }
        }
        return visible;
      },
      {}
    );
  }
  // ── cursor moves ───────────────────────────────────────────────────────
  moveCursorUp() {
    if (this.cursorY > 0) {
      this.cursorY--;
      if (this.cursorX >= this.lines[this.cursorY].length) {
        this.cursorX = this.lines[this.cursorY].length;
      }
      this._ensureCursorInView();
    }
  }
  moveCursorDown() {
    if (this.cursorY < this.lines.length) {
      this.cursorY++;
      if (this.cursorX >= this.lines[this.cursorY].length) {
        this.cursorX = this.lines[this.cursorY].length;
      }
      this._ensureCursorInView();
    }
  }
  moveCursorLeft() {
    if (this.cursorX > 0) {
      this.cursorX--;
      this._ensureCursorInView();
    }
  }
  moveCursorRight() {
    if (this.cursorX < this.lines[this.cursorY].length) {
      this.cursorX++;
    } else {
      this.cursorX = this.lines[this.cursorY].length;
    }
    this._ensureCursorInView();
  }
  moveCursorVertically(n) {
    if (n > 0) {
      for (let i = 0; i < n; i++) {
        this.moveCursorDown();
      }
    } else if (n < 0) {
      for (let i = n; i <= 0; i++) {
        this.moveCursorUp();
      }
    }
  }
  moveCursorHorizontally(n) {
    if (n > 0) {
      for (let i = 0; i < n; i++) {
        this.moveCursorRight();
      }
    } else if (n < 0) {
      for (let i = n; i <= 0; i++) {
        this.moveCursorLeft();
      }
    }
  }
  // ── edits ───────────────────────────────────────────────────────────────
  insert(text) {
    const oldLine = this.lines[this.cursorY];
    const before = oldLine.substring(0, this.cursorX);
    const after = oldLine.substring(this.cursorX);
    const newLine = before + text + after;
    let newLines = this.lines.slice(0, this.cursorY);
    let oldLinesAfter = this.lines.slice(this.cursorY + 1);
    this.lines = newLines.concat(newLine.split("\n")).concat(oldLinesAfter);
    this.cursorX++;
    this._ensureCursorInView();
    return this;
  }
  delete() {
    const oldLine = this.lines[this.cursorY];
    const before = oldLine.substring(0, this.cursorX - 1);
    const after = oldLine.substring(this.cursorX + 1);
    const newLine = before + after;
    let newLines = this.lines.slice(0, this.cursorY);
    let oldLinesAfter = this.lines.slice(this.cursorY + 1);
    this.lines = newLines.concat(newLine.split("\n")).concat(oldLinesAfter);
    this._ensureCursorInView();
    return this;
  }
  backspace() {
    if (this.cursorX > 0) {
      this.delete();
      this.cursorX--;
    } else if (this.cursorY > 0) {
      const newCol = this.lines[this.cursorY - 1].length;
      this.delete();
      this.cursorY--;
      this.cursorX = newCol;
    }
    this._ensureCursorInView();
    return this;
  }
  /**
   * @returns {{ startLine: number, endLine: number }}
   *  both 0‐based; add +1 if you need 1‐based
   */
  getWindowRange() {
    const startLine = this.windowStartRow;
    const endLine = this.windowStartRow + this.windowRows - 1;
    return { startLine, endLine };
  }
  // ── clone ──────────────────────────────────────────────────────────────
  /** return a new instance with identical state */
  copy() {
    const clone = new MemoryBufferEditor(this.filePath, {
      rows: this.windowRows,
      cols: this.windowCols
    });
    clone.cursorY = this.cursorY;
    clone.cursorX = this.cursorX;
    clone.windowStartRow = this.windowStartRow;
    clone.windowStartCol = this.windowStartCol;
    clone.cursorStyle = this.cursorStyle;
    clone.cursorChar = this.cursorChar;
    clone.lines = this.lines;
    clone._to = this._to;
    clone._saved = this._saved;
    return clone;
  }
  getStatus() {
    return ` row:${this.cursorY} col:${this.cursorX} ${this._saved}`;
  }
}
function CodeBufferEditor({
  filePath,
  onKeypress = (ch, key) => {
  },
  onChange = (p) => {
  },
  ...boxProps
}) {
  const boxRef = React.useRef();
  const [editor, setEditor] = React.useState(null);
  const [size, setSize] = React.useState({ rows: 10, cols: 30 });
  React.useEffect(() => {
    if (filePath) {
      const ed = new MemoryBufferEditor(filePath, { rows: size.rows, cols: size.cols });
      ed.windowRows = size.rows;
      ed.windowCols = size.cols;
      setEditor(ed);
    } else {
      setEditor(null);
    }
  }, [filePath]);
  React.useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const update = () => {
      setSize({ cols: box.width, rows: box.height - 2 });
    };
    update();
    box.on("resize", update);
    return () => box.removeListener("resize", update);
  }, []);
  React.useEffect(() => {
    if (editor) {
      editor.windowCols = size.cols;
      editor.windowRows = size.rows;
      setEditor(editor.copy());
    }
  }, [size]);
  const tokenList = () => {
    if (!editor) {
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
          style: { bg: "yellow", fg: "#111111" },
          content: "No File Loaded"
        },
        `0-0-no-file`
      );
    }
    const padLength = Math.ceil(Math.log10(editor.windowRows + editor.windowStartRow));
    const lines = editor.render();
    const { y: cursorY, x: cursorX } = editor.getCursorWindowCoords();
    const tt = Object.keys(lines).flatMap((lineNumber, k) => {
      const line = lines[lineNumber];
      const lineNumberText = `${String(lineNumber).padStart(padLength, " ")}`;
      const lineNumberBox = /* @__PURE__ */ jsxRuntime_js.jsx(
        "box",
        {
          left: 0,
          top: k,
          width: padLength,
          height: 1,
          style: { bg: "black", fg: "blue", inverse: cursorY == lineNumber },
          content: lineNumberText
        },
        `${lineNumber}-lineNumber`
      );
      return line.reduce((a, t) => {
        a.push(
          /* @__PURE__ */ jsxRuntime_js.jsx(
            "box",
            {
              left: t.x + padLength + 1,
              top: t.y - editor.windowStartRow,
              width: t.text.length,
              height: 1,
              style: t.style,
              content: t.text
            },
            `${t.x}-${t.y}`
          )
        );
        return a;
      }, [lineNumberBox]);
    });
    const style = editor.cursorStyle;
    const char = editor.cursorChar;
    tt.push(/* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        left: cursorX + padLength + 1,
        top: cursorY,
        width: 1,
        height: 1,
        style: { ...style, inverse: true },
        tags: false,
        content: char
      },
      `cursor`
    ));
    return tt;
  };
  const internalOnKeypress = (ch, key) => {
    onKeypress({ ch, key });
    if (filePath == null) {
      return;
    }
    switch (key.name) {
      case "up":
        editor.moveCursorUp();
        break;
      case "down":
        editor.moveCursorDown();
        break;
      case "left":
        editor.moveCursorLeft();
        break;
      case "right":
        editor.moveCursorRight();
        break;
      case "backspace":
        editor.backspace().save();
        onChange();
        break;
      case "delete":
        editor.delete().save();
        onChange();
        break;
      default:
        if (ch && ch.length === 1) {
          editor.insert(ch).save();
          onChange();
        }
    }
    setEditor(editor.copy());
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
      label: `Editing: ${filePath}`,
      children: [
        tokenList(),
        /* @__PURE__ */ jsxRuntime_js.jsx(
          "box",
          {
            top: size.rows,
            left: -1,
            width: size.cols,
            height: 1,
            content: editor?.getStatus(),
            tags: false,
            style: { fg: "black", bg: "yellow" }
          },
          `status`
        )
      ]
    }
  );
}
function App(props) {
  const [message, setMessage] = React.useState(false);
  const [pickFolder, setPickFolder] = React.useState(false);
  const [currentEditorText, setCurrentEditorText] = React.useState("");
  const [activeTab, setActiveTab] = React.useState("Project");
  const [treeData, setTreeData] = React.useState([]);
  const [gitStatus, setGitStatus] = React.useState([]);
  const [selectedFile, setSelectedFile] = React.useState(null);
  const [openedFiles, setOpenedFiles] = React.useState({});
  const [fileContent, setFileContent] = React.useState("");
  const [rootDir, setRootDir] = React.useState(process.cwd());
  const [workspace, setWorkspace] = React.useState(new Workspace$1());
  React.useEffect(() => {
    workspace.init(rootDir).then((wk) => workspace.open(workspace.rootNode)).then((t) => {
      const wk = workspace.copy();
      const td = workspace.flatten();
      setWorkspace(wk);
      setTreeData(td);
    });
    getStatus(rootDir).then(setGitStatus);
  }, []);
  const onFilePathSelect = (event) => {
    setMessage(`file path selected ${event.content} ${process.cwd()}`);
  };
  const selectFile = (node) => {
    setSelectedFile(node.fullPath);
    const newOpenedFiles = { ...openedFiles };
    newOpenedFiles[node.fullPath.replace(workspace.rootNode.fullPath, "")] = node;
    setOpenedFiles(newOpenedFiles);
    setFileContent(`Loading ${node.relPath}`);
    node.readFile(node.fullPath).then(setFileContent);
  };
  const selectDir = async (dir) => {
    if (dir.isOpen) {
      dir.close();
      const wk = workspace.copy();
      const td = wk.flatten();
      setWorkspace(wk);
      setTreeData(td);
    } else {
      dir.open(workspace.rootDir, workspace.ig).then((n) => {
        const wk = workspace.copy();
        const td = wk.flatten();
        setWorkspace(wk);
        setTreeData(td);
      });
    }
  };
  const onCurrentEditorChange = (a, b, c) => {
  };
  const onCodeEditKeyPress = ({ ch, key }) => {
    setCurrentEditorText(JSON.stringify({ ch, key }));
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
              children: /* @__PURE__ */ jsxRuntime_js.jsx(
                "list",
                {
                  items: Object.keys(openedFiles),
                  keys: true,
                  mouse: true,
                  scroll: true,
                  style: { selected: { bg: "blue" } },
                  scrollbar: { ch: "=", track: { fg: "blue", bg: "grey" } },
                  onSelect: (_, idx) => {
                    const k = Object.keys(openedFiles)[idx];
                    const inode = openedFiles[k];
                    selectFile(inode);
                  }
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
                  workspace,
                  treeData,
                  onDirSelect: selectDir,
                  onFileSelect: selectFile,
                  label: "Project"
                }
              )
            },
            2
          )
        ] }) }),
        /* @__PURE__ */ jsxRuntime_js.jsx(Tab, { name: "Git", children: /* @__PURE__ */ jsxRuntime_js.jsx("box", { label: "Git", children: /* @__PURE__ */ jsxRuntime_js.jsx(
          "list",
          {
            scrollbar: { ch: "=", track: { fg: "blue", bg: "grey" } },
            items: gitStatus,
            keys: true,
            mouse: true,
            style: { selected: { bg: "blue" } },
            onSelect: onFilePathSelect,
            label: "Status"
          }
        ) }, 3) })
      ] }),
      /* @__PURE__ */ jsxRuntime_js.jsx(
        CodeBufferEditor,
        {
          row: 0,
          col: 5,
          rowSpan: 6,
          colSpan: 10,
          border: { type: "line" },
          label: (selectedFile || "No file selected").replace(workspace.rootDir, ""),
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
        title: "Message",
        onClose: () => setMessage(false),
        children: /* @__PURE__ */ jsxRuntime_js.jsx("text", { children: message })
      }
    ),
    pickFolder && /* @__PURE__ */ jsxRuntime_js.jsx(
      FolderPickerDialog,
      {
        title: "Message",
        onClose: () => setMessage(false),
        onFolderSelect: (inode) => {
          setMessage(`selected folder ${inode.fullPath}`);
        }
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
screen.key(["C-c", "C-q", "f12"], () => process.exit(0));
screen.key(["C-s", "C-S-s", "f8"], () => {
  const dump = screen.screenshot();
  fs.writeFileSync("buffer.sgr", dump, "utf8");
  console.log("Wrote SGR dump to buffer.sgr");
});
screen.enableMouse();
reactBlessed.render(/* @__PURE__ */ jsxRuntime_js.jsx(App, {}), screen);
