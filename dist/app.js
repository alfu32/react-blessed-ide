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
function highlight(line) {
  const tokenizer = getTokenizer("jsx");
  return tokenizer(line);
}
class TokenizerToken {
  tokenizerName = "";
  type = "";
  style = {};
  start = 0;
  end = 0;
  /**
   *
   * @param {RegExpExecArray} m
   * @param tokenizerDef
   * @return {{name: void | string, text: *, type: string, style, start, end: *}}
   */
  static fromRegexpMatch(m, tokenizerDef, tokenizerName) {
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
    Whitespace: { style: { fg: "white", bg: "#222222" }, pattern: "\\s+" }
  } },
  js: { name: "js", definitions: {
    Keyword: { style: { fg: "magenta" }, pattern: "(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)" },
    Number: { style: { fg: "red" }, pattern: "\\d+(?:\\.\\d+)?" },
    String: { style: { fg: "yellow" }, pattern: `"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'` },
    Operator: { style: { fg: "cyan" }, pattern: "==|!=|<=|>=|[+\\-*/=<>]" },
    Punctuation: { style: { fg: "cyan" }, pattern: "[()[\\]{}.,;]" },
    Whitespace: { style: { fg: "white", bg: "#222222" }, pattern: "\\s+" },
    Identifier: { style: { fg: "green" }, pattern: "[A-Za-z_]\\w*" }
  } },
  jsx: { name: "jsx", definitions: {
    Keyword: { style: { fg: "magenta" }, pattern: "(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)" },
    JsxTag: { style: { fg: "yellow" }, pattern: "\\<(\\/){0,1}[a-zA-Z-]*\\>" },
    Number: { style: { fg: "red" }, pattern: "\\d+(?:\\.\\d+)?" },
    String: { style: { fg: "yellow" }, pattern: `"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'` },
    Operator: { style: { fg: "cyan" }, pattern: "==|!=|<=|>=|[+\\-*/=<>]" },
    Punctuation: { style: { fg: "cyan" }, pattern: "[()[\\]{}.,;]" },
    Whitespace: { style: { fg: "white", bg: "#222222" }, pattern: "\\s+" },
    Identifier: { style: { fg: "green" }, pattern: "[A-Za-z_]\\w*" }
  } },
  c: { name: "c", definitions: {
    Keyword: { style: { fg: "magenta" }, pattern: "(int|const|char|long|if|else|for|while|return)" },
    Number: { style: { fg: "red" }, pattern: "\\d+(?:\\.\\d+)?" },
    String: { style: { fg: "yellow" }, pattern: `"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'` },
    Operator: { style: { fg: "cyan" }, pattern: "==|!=|<=|>=|[+\\-*/=<>]" },
    Punctuation: { style: { fg: "cyan" }, pattern: "[()[\\]{}.,;]" },
    Whitespace: { style: { fg: "white", bg: "#222222" }, pattern: "\\s+" },
    Identifier: { style: { fg: "green" }, pattern: "[A-Za-z_]\\w*" }
  } }
};
function getTokenizer(name) {
  const tokenizerDef = namedTokenizers[name] || namedTokenizers["any"];
  const tokenRegex = new RegExp(
    Object.entries(tokenizerDef.definitions).map(([name2, definition]) => `(?<${name2}>${definition.pattern})`).join("|"),
    "g"
  );
  return function tokenizer(code) {
    const tokens = [];
    for (const m of code.matchAll(tokenRegex)) {
      const groups = m.groups;
      const type = Object.keys(groups).find((key) => groups[key] !== void 0);
      tokenizerDef.definitions[type];
      tokens.push(TokenizerToken.fromRegexpMatch(m, tokenizerDef, name));
    }
    return tokens;
  };
}
function CodeEditor({
  width = "100%",
  height = "100%",
  initialText = "",
  onChange = () => {
  },
  ...boxProps
}) {
  const [text2, setText] = React.useState(initialText);
  const [cursorOffset, setCursorOffset] = React.useState(0);
  const [cursorVisible, setCursorVisible] = React.useState(true);
  const boxRef = React.useRef(null);
  React.useEffect(() => {
    setText(initialText);
    setCursorOffset(0);
  }, [initialText]);
  React.useEffect(() => {
    if (boxRef.current) boxRef.current.focus();
  }, []);
  React.useEffect(() => {
    onChange({ text: text2, cursorOffset });
  }, [text2, cursorOffset]);
  const handleKeyPress = (ch, key) => {
    let newText = text2;
    let newCursor = cursorOffset;
    if (key.name === "left") {
      newCursor = Math.max(0, newCursor - 1);
    } else if (key.name === "right") {
      newCursor = Math.min(newText.length, newCursor + 1);
    } else if (key.name === "up") {
      const lines = text2.slice(0, newCursor).split("\n");
      const col = lines.at(-1)?.length || 0;
      if (lines.length > 1) {
        const prevLine = lines[lines.length - 2];
        newCursor -= col + 1 + Math.min(prevLine.length, col);
      }
    } else if (key.name === "down") {
      const lines = text2.split("\n");
      const index = text2.slice(0, newCursor).split("\n").length - 1;
      const col = newCursor - text2.lastIndexOf("\n", newCursor - 1) - 1;
      if (index < lines.length - 1) {
        const below = lines[index + 1];
        newCursor += lines[index].length - col + 1 + Math.min(below.length, col);
      }
    } else if (key.name === "backspace") {
      if (newCursor > 0) {
        newText = newText.slice(0, newCursor - 1) + newText.slice(newCursor);
        newCursor--;
      }
    } else if (key.full === "return") {
      newText = newText.slice(0, newCursor) + "\n" + newText.slice(newCursor);
      newCursor++;
    } else if (typeof ch === "string" && ch.length === 1) {
      newText = newText.slice(0, newCursor) + ch + newText.slice(newCursor);
      newCursor++;
    }
    setText(newText);
    setCursorOffset(newCursor);
  };
  const cursorStyle = { underline: true, inverse: true };
  const renderLOC = (line, y, offset, ll) => {
    const lineNum = "│ " + String(y + 1).padStart(ll) + " │";
    const lineBox = /* @__PURE__ */ jsxRuntime_js.jsx("box", { left: 0, height: 1, content: lineNum, style: { fg: "#aaaaaa" } }, `${y}-linenum`);
    const tokens = highlight(line);
    let inlineOffset = 0;
    const renderedLine = /* @__PURE__ */ jsxRuntime_js.jsxs("box", { top: y, left: 0, height: 1, children: [
      lineBox,
      tokens.map((token, i) => {
        let tx = token.text;
        const containsCursor = cursorOffset >= offset && cursorOffset < offset + tx.length;
        const style = token.style;
        let bx = /* @__PURE__ */ jsxRuntime_js.jsx(
          "box",
          {
            left: lineNum.length + token.start,
            content: tx,
            style
          },
          `${y}-${i}`
        );
        if (containsCursor) {
          const cursorPos = cursorOffset - offset;
          let at = tx[cursorPos];
          at = ["\n", "\r"].indexOf(at) > -1 ? `${at}_` : at;
          bx = /* @__PURE__ */ jsxRuntime_js.jsxs(
            "box",
            {
              left: lineNum.length + token.start,
              children: [
                /* @__PURE__ */ jsxRuntime_js.jsx(
                  "box",
                  {
                    left: 0,
                    content: tx,
                    style
                  },
                  `${y}-${i}`
                ),
                /* @__PURE__ */ jsxRuntime_js.jsx(
                  "box",
                  {
                    left: cursorPos,
                    width: 1,
                    content: at,
                    style: { ...style, ...cursorStyle }
                  },
                  `${y}-${i}-at`
                )
              ]
            },
            `${y}-${i}`
          );
        }
        inlineOffset += tx.length;
        offset += tx.length;
        return [bx];
      })
    ] }, y);
    offset += 1;
    return [renderedLine, offset];
  };
  const renderWithCursor = () => {
    const lines = text2.split("\n");
    const linesLength = Math.trunc(Math.log10(lines.length)) + 1;
    let offset = 0;
    return lines.map((line, y, lines2) => {
      let [loc, offsetOut] = renderLOC(line, y, offset, linesLength);
      offset = offsetOut;
      return loc;
    });
  };
  return /* @__PURE__ */ jsxRuntime_js.jsx(
    "box",
    {
      ref: boxRef,
      label: " Blessed Editor ",
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
      width,
      height,
      mouse: true,
      keys: true,
      input: true,
      clickable: true,
      focused: true,
      scrollable: true,
      alwaysScroll: true,
      onKeypress: handleKeyPress,
      ...boxProps,
      children: renderWithCursor()
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
  const onTextEditorSave = (a, b, c) => {
    setMessage(JSON.stringify({ a, b, c }));
  };
  const onTextEditorCancel = (a, b, c) => {
    setMessage(JSON.stringify({ a, b, c }));
  };
  const onCurrentEditorChange = (a, b, c) => {
    setCurrentEditorText(JSON.stringify({ a, b, c }));
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
        CodeEditor,
        {
          row: 0,
          col: 5,
          rowSpan: 6,
          colSpan: 10,
          border: { type: "line" },
          label: (selectedFile || "No file selected").replace(workspace.rootDir, ""),
          initialText: fileContent || "",
          onSave: onTextEditorSave,
          onCancel: onTextEditorCancel,
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
reactBlessed.render(/* @__PURE__ */ jsxRuntime_js.jsx(App, {}), screen);
