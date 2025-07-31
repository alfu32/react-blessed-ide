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
  const { stdout } = await exec(`git status --porcelain`, { cwd });
  return stdout.split("\n").filter(Boolean);
}
async function getCommits(cwd) {
  const { stdout } = await exec(`git log --pretty=format:"%h %s" --abbrev=8 | tee`, { cwd });
  return stdout.split("\n").filter(Boolean);
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
          onClick: () => setActiveIndex(i),
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
  js: { name: "js", flags: "mg", definitions: {
    Keyword: { style: { fg: "magenta" }, pattern: "\\b(as|from|default|this|const|constructor|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw|switch|case|break|continue)\\b" },
    Number: { style: { fg: "red" }, pattern: "\\d+(?:\\.\\d+)?" },
    Comment: { style: { fg: "#779977" }, pattern: "//.*$" },
    // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
    String: { style: { fg: "yellow" }, pattern: `"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'` },
    Operator: { style: { fg: "cyan" }, pattern: "==|!=|<=|>=|[+\\-*/=<>]" },
    Punctuation: { style: { fg: "cyan" }, pattern: "[()[\\]{}.,;]" },
    Whitespace: { style: { fg: "white" }, pattern: "\\s+" },
    Identifier: { style: { fg: "green" }, pattern: "[A-Za-z_]\\w*" }
  } },
  jsx: { name: "jsx", flags: "mg", definitions: {
    ReactToken: { style: { fg: "#FFDD00" }, pattern: "\\buse[A-Z][a-z]*\\b" },
    Keyword: { style: { fg: "magenta" }, pattern: "\\b(as|from|default|const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw|switch|case|break|continue)\\b" },
    JsxTag: { style: { fg: "#FFDD00" }, pattern: "\\<(\\/){0,1}[a-zA-Z-]*\\>" },
    Comment: { style: { fg: "#779977" }, pattern: "//.*$" },
    // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
    Number: { style: { fg: "red" }, pattern: "\\d+(?:\\.\\d+)?" },
    String: { style: { fg: "yellow" }, pattern: `"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'` },
    Operator: { style: { fg: "cyan" }, pattern: "==|!=|<=|>=|[+\\-*/=<>]" },
    Punctuation: { style: { fg: "cyan" }, pattern: "[()[\\]{}.,;]" },
    Whitespace: { style: { fg: "white" }, pattern: "\\s+" },
    Identifier: { style: { fg: "green" }, pattern: "[A-Za-z_]\\w*" }
  } },
  c: { name: "c", flags: "mg", definitions: {
    Keyword: { style: { fg: "magenta" }, pattern: "\\b(int|const|char|long|if|else|for|while|return|switch|case|break|continue)\\b" },
    Number: { style: { fg: "red" }, pattern: "\\d+(?:\\.\\d+)?" },
    Comment: { style: { fg: "#779977" }, pattern: "//.*$" },
    // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
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
    tokenizerDef.flags || "g"
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
    this.viewportY = 0;
    this.viewportX = 0;
    this.viewportHeight = windowSize.rows;
    this.viewportWidth = windowSize.cols;
    this.cursorY = 0;
    this.cursorX = 0;
    this.cursorStyle = {};
    this.cursorChar = "_";
    this.lines = [];
    this._tout000 = 0;
    this._saved = "";
    this.setFilePath(filePath);
  }
  setFilePath(filePath) {
    this.filePath = filePath;
    this.lines = fs.readFileSync(filePath, { encoding: "utf-8" }).split("\n");
    this.updateTokens();
    this.updateCursor();
  }
  save() {
    clearTimeout(this._tout000);
    this._tout000 = setTimeout(() => {
      fs.writeFileSync(this.filePath, this.lines.join("\n"));
      this._saved = `saved ${(/* @__PURE__ */ new Date()).toISOString()}`;
    }, 1e3);
  }
  // ── private ────────────────────────────────────────────────────────────
  _ensureCursorInView() {
    if (this.cursorY < this.viewportY) {
      this.viewportY = this.cursorY;
    } else if (this.cursorY >= this.viewportY + this.viewportHeight) {
      this.viewportY = this.cursorY - this.viewportHeight;
    }
    if (this.cursorX < this.viewportX) {
      this.viewportX = this.cursorX;
    } else if (this.cursorX >= this.viewportX + this.viewportWidth) {
      this.viewportX = this.cursorX - this.viewportWidth;
    }
  }
  /**
   * @returns {{ rowInWindow: number, colInWindow: number }}
   *   0-based coords of the cursor inside the viewport
   */
  getCursorWindowCoords() {
    return {
      cursorY: this.cursorY - this.viewportY,
      cursorX: this.cursorX - this.viewportX
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
  updateCursor() {
    const lineId = this.cursorY;
    const tokens = this.tokens[lineId];
    let col = 0;
    this.cursorChar = "_";
    for (const tok of tokens) {
      if (this.cursorX >= tok.start && this.cursorX < tok.end) {
        this.cursorStyle = tok.style;
        this.cursorChar = (this.lines[lineId] || "_")[this.cursorX] || "_";
        break;
      }
      col += tok.text.length;
    }
    if (this.cursorStyle == null) {
      const last = tokens.slice(-1)[0];
      this.cursorStyle = last ? last.style : {};
      this.cursorChar = last && last.text.length ? last.text[last.text.length - 1] : "_";
    }
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
  // ── cursor moves ───────────────────────────────────────────────────────
  setCursor(x, y) {
    this.cursorX = x;
    this.cursorY = y;
  }
  moveCursorUp() {
    if (this.cursorY > 0) {
      this.cursorY--;
      if (this.cursorX >= this.lines[this.cursorY].length) {
        this.cursorX = this.lines[this.cursorY].length;
      }
      this._ensureCursorInView();
      this.updateCursor();
    }
  }
  moveCursorDown() {
    if (this.cursorY + 1 < this.lines.length) {
      if (this.cursorX >= this.lines[this.cursorY + 1].length) {
        this.cursorX = this.lines[this.cursorY + 1].length;
      }
      this.cursorY++;
      this._ensureCursorInView();
      this.updateCursor();
    }
  }
  moveCursorLeft() {
    if (this.cursorX > 0) {
      this.cursorX--;
      this._ensureCursorInView();
      this.updateCursor();
    }
  }
  moveCursorRight() {
    if (this.cursorX < this.lines[this.cursorY].length) {
      this.cursorX++;
    } else {
      this.cursorX = this.lines[this.cursorY].length;
    }
    this._ensureCursorInView();
    this.updateCursor();
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
  // ── clone ──────────────────────────────────────────────────────────────
  /** return a new instance with identical state */
  copy() {
    const clone = new MemoryBufferEditor(this.filePath, {
      rows: this.viewportHeight,
      cols: this.viewportWidth
    });
    clone.filePath = this.filePath;
    clone.viewportY = this.viewportY;
    clone.viewportX = this.viewportX;
    clone.cursorY = this.cursorY;
    clone.cursorX = this.cursorX;
    clone.cursorStyle = this.cursorStyle;
    clone.cursorChar = this.cursorChar;
    clone.lines = this.lines;
    clone._saved = this._saved;
    return clone;
  }
  getStatus() {
    const range = Object.keys(this.renderViewport());
    const json = {
      cursor: {
        x: this.cursorX,
        y: this.cursorY,
        chr: this.cursorChar,
        ...this.cursorStyle
      },
      v: { x: this.viewportX, y: this.viewportY, w: this.viewportWidth, h: this.viewportHeight },
      s: this._saved,
      l: range[0] + " ... " + range[range.length - 1]
    };
    json.cursor[`${this.cursorX}-${this.viewportX}`] = this.cursorX - this.viewportX;
    json.cursor[`${this.cursorY}-${this.viewportY}`] = this.cursorY - this.viewportY;
    return JSON.stringify(json).replace(/"/gi, "");
  }
}
function safeStringify(obj) {
  const seen = /* @__PURE__ */ new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    switch (key) {
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
  }, 2);
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
      ed.viewportHeight = size.rows - 1;
      ed.viewportWidth = size.cols;
      setEditor(ed);
    } else {
      setEditor(null);
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
    if (editor) {
      editor.viewportWidth = size.cols;
      editor.viewportHeight = size.rows;
      setEditor(editor.copy());
    }
  }, [size]);
  const cursor = () => {
    if (!editor) {
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
    const padLength = Math.ceil(Math.log10(editor.viewportHeight + editor.viewportY)) + 1;
    editor.updateCursor();
    return /* @__PURE__ */ jsxRuntime_js.jsx(
      "box",
      {
        left: editor.cursorX - editor.viewportX + padLength + 1 + 1,
        top: editor.cursorY - editor.viewportY,
        width: 1,
        height: 1,
        style: { ...editor.cursorStyle, underline: true, bold: true, inverse: true },
        tags: false,
        content: editor.cursorChar
      },
      `cursor-${Date.now()}`
    );
  };
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
          style: { bg: "#eeee00", fg: "#111111" },
          content: "\n No File Loaded"
        },
        `0-0-no-file`
      );
    }
    const padLength = Math.ceil(Math.log10(editor.viewportHeight + editor.viewportY)) + 1;
    editor.updateTokens();
    const lines = editor.renderViewport();
    const { cursorY, cursorX } = editor.getCursorWindowCoords();
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
          style: { bg: "#222222", fg: "#33aabb", inverse: editor.cursorY == lineNumber },
          content: lineNumberText + "│"
        },
        `${lineNumber}-lineNumber`
      );
      return line.reduce((a, t) => {
        a.push(
          /* @__PURE__ */ jsxRuntime_js.jsx(
            "box",
            {
              left: t.x + padLength + 1 + 1,
              top: t.y - editor.viewportY,
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
      case "home":
        editor.cursorX = 0;
        break;
      case "end":
        editor.cursorX = editor.lines[editor.cursorY].length;
        break;
      case "pageup":
        editor.moveCursorVertically(-editor.viewportHeight);
        break;
      case "pagedown":
        editor.moveCursorVertically(editor.viewportHeight);
        break;
      case "backspace":
        editor.backspace().save();
        onChange();
        break;
      case "delete":
        editor.delete().save();
        onChange();
        break;
      case "return":
        editor.insert("\n");
        editor.moveCursorDown();
        editor.save();
        onChange();
        break;
      case "tab":
        editor.insert("	").save();
        onChange();
        break;
      default:
        if (ch && ch.length > 0) {
          if (key.name && key.name.length === 1) {
            editor.insert(ch).save();
            onChange();
          }
        }
    }
    setEditor(editor.copy());
  };
  const setCursorPosition = (screenEvent) => {
    if (!editor) {
      return;
    }
    const padLength = Math.ceil(Math.log10(editor.viewportHeight + editor.viewportY)) + 1;
    const { xi, yi } = boxRef.current.lpos;
    const { x, y } = screenEvent;
    editor.setCursor(x - xi - padLength - 1 - 1 + editor.viewportX, y - yi - 1 + editor.viewportY);
    setEditor(editor.copy());
  };
  const mouseAction = (event) => {
    switch (event.action) {
      case "mousemove":
        break;
      case "mousedown":
        break;
      case "mouseup":
        break;
      case "wheelup":
        editor.moveCursorUp();
        setEditor(editor.copy());
        break;
      case "wheeldown":
        editor.moveCursorDown();
        setEditor(editor.copy());
        break;
      default:
        throw new Error(safeStringify(event));
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
      onClick: setCursorPosition,
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
            content: editor?.getStatus(),
            tags: false,
            style: { fg: "black", bg: "yellow" }
          },
          `status`
        ),
        cursor()
      ]
    }
  );
}
function GitPanel({
  rootDir,
  onFileSelect,
  ...boxProps
}) {
  const [message, setMessage] = React.useState(false);
  const [workspace, setWorkspace] = React.useState(new Workspace$1());
  const [gitStatus, setGitStatus] = React.useState([]);
  const [gitCommits, setGitCommits] = React.useState([]);
  const [gitBranch, setGitBranch] = React.useState("");
  const [gitCurrentTag, setGitCurrentTag] = React.useState("");
  const [gitRemotes, setGitRemotes] = React.useState([]);
  const [commitMessage, setCommitMessage] = React.useState("");
  const sortFilesFn = (a, b) => a.substring(3) > b.substring(3) ? 1 : a.substring(3) === b.substring(3) ? 0 : -1;
  async function refreshAll() {
    const result = await Promise.all([
      getStatus(rootDir),
      getCommits(rootDir),
      getBranch(rootDir),
      getCurrentTag(rootDir),
      getRemotes(rootDir)
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
  }
  React.useEffect(() => {
    refreshAll();
  }, []);
  const onFilePathSelect = (event) => {
    const staged = event.content.substring(0, 1);
    const changed = event.content.substring(1, 2);
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
    setCommitMessage(event.content.substring(9));
  };
  const onCommitMessageChanged = (event) => {
    setCommitMessage(event.content);
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
  const status = `{cyan-fg}${(gitRemotes[0] || {}).name}{/cyan-fg}/{red-fg}${gitBranch}{/red-fg}({yellow-fg}${gitCurrentTag}{/yellow-fg})`;
  const statusLen = `${(gitRemotes[0] || {}).name}/${gitBranch}(${gitCurrentTag})`.length;
  return /* @__PURE__ */ jsxRuntime_js.jsxs("box", { ...boxProps, children: [
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { label: `Status`, height: 9, border: { type: "line" }, children: /* @__PURE__ */ jsxRuntime_js.jsx(
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
        onSelect: onFilePathSelect
      }
    ) }),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { content: status, top: 0, left: 9, width: statusLen, height: 1, tags: true }),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { content: rootDir, top: 8, left: 2, width: rootDir.length, height: 1 }),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      "textarea",
      {
        top: 9,
        height: 9,
        input: true,
        focused: true,
        scrollable: true,
        alwaysScroll: true,
        content: commitMessage,
        label: "Commit Message",
        border: { type: "line" },
        inputOnFocus: true,
        onChange: onCommitMessageChanged
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx(
      "button",
      {
        top: 18,
        left: "0%",
        height: 3,
        width: "48%",
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
        left: "52%",
        height: 3,
        width: "48%",
        mouse: true,
        keys: true,
        input: true,
        clickable: true,
        focused: true,
        valign: "middle",
        align: "center",
        style: { bg: "#ffaa00", fg: "#333333", hover: { bg: "#ffdd88", fg: "#333333" } },
        content: "\nrevert\n"
      }
    ),
    /* @__PURE__ */ jsxRuntime_js.jsx("box", { label: "Commits", top: 21, border: { type: "line" }, children: /* @__PURE__ */ jsxRuntime_js.jsx(
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
function App(props) {
  const [message, setMessage] = React.useState(false);
  const [pickFolder, setPickFolder] = React.useState(false);
  const [currentEditorText, setCurrentEditorText] = React.useState("");
  const [activeTab, setActiveTab] = React.useState("Project");
  const [treeData, setTreeData] = React.useState([]);
  const [selectedFile, setSelectedFile] = React.useState(null);
  const [openedFiles, setOpenedFiles] = React.useState({});
  const [fileContent, setFileContent] = React.useState("");
  const [rootDir, setRootDir] = React.useState(process.cwd());
  const [gitStatus, setGitStatus] = React.useState([]);
  const [workspace, setWorkspace] = React.useState(new Workspace$1());
  React.useEffect(() => {
    workspace.init(rootDir).then((wk) => workspace.open(workspace.rootNode)).then((t) => {
      const wk = workspace.copy();
      const td = workspace.flatten();
      setWorkspace(wk);
      setTreeData(td);
    });
  }, []);
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
        /* @__PURE__ */ jsxRuntime_js.jsx(Tab, { name: "Git", children: /* @__PURE__ */ jsxRuntime_js.jsx(GitPanel, { rootDir }) })
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
