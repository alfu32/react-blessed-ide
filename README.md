````text
# react-blessed-ide

A terminal-based IDE built with React-Blessed, inspired by Sublime Text and VSCode.  
No plugins—just a simple, integrated TUI with file tree, Git status, editor pane, and modal dialogs.

Repository: https://github.com/alfu32/react-blessed-ide

---
## screenshots

### project side panel

```
┌─────────────────────────────────┐┌──────────────────────────────────────────────────┐
│[*]Project     [ ]Git            ││                                                  │
│  [-] term-blessed-react         ││                                                  │
│  [+] .git                       ││                                                  │
│    .gitignore                   ││                                                  │
│  [+] .idea                      ││                                                  │
│    App.jsx                      ││                                                  │
│    Counter.jsx                  ││                                                  │
│    FileTree.jsx                 ││                                                  │
│    FolderPickerDialog.jsx       ││                                                  │
│    GitPanel.jsx                 ││                                                  │
│    ModalDialog.jsx              ││                                                  │
│    README.md                    ││                                                  │
│    Workspace.test.js            ││                                                  │
│  [+] dist                       ││                                                  │
│    index.jsx                    ││                                                  │
│  [+] node_modules               ││                                                  │
│                                 ││                                                  │
│                                 ││                                                  │
│                                 ││                                                  │
│                                 ││                                                  │
└─────────────────────────────────┘└──────────────────────────────────────────────────┘
```


### file tree can toggle - expand/contract nodes ( folders )
```
┌────────────────────────────────┐┌───────────────────────────────────────────────────┐
│[*]Project     [ ]Git           ││                                                   │
│    Workspace.test.js           ││                                                   │
│    buffer.sgr                  ││                                                   │
│  [+] dist                      ││                                                   │
│    index.jsx                   ││                                                   │
│  [-] node_modules              ││                                                   │
│    [+] .bin                    ││                                                   │
│      .package-lock.json        ││                                                   │
│    [+] @ampproject             ││                                                   │
│    [+] ansi-escapes            ││                                                   │
│    [+] ansi-regex              ││                                                   │
│    [+] ansi-styles             ││                                                   │
│    [+] ansi-term               ││                                                   │
│    [+] ansicolors              ││                                                   │
│    [+] anymatch                ││                                                   │
└────────────────────────────────┘└───────────────────────────────────────────────────┘
```

### git status --porcelain view

```
┌────────────────────────────────┐┌──────────────────────────────────────────┐ 
│[ ]Project     [*]Git           ││                                          │ 
│AM README.md                    ││                                          │ 
│ M index.jsx                    ││                                          │ 
│AM terminal-dump.js             ││                                          │ 
│?? buffer.sgr                   ││                                          │ 
│?? terminal-dump.log            ││                                          │ 
│?? terminal-dump.txt            ││                                          │ 
│                                ││                                          │ 
└────────────────────────────────┘└──────────────────────────────────────────┘ 
```

## Features

- **File Tree Panel**  
  Browse your workspace folder with collapsible directories (supports `.gitignore` filtering).

- **Git Status Panel**  
  View `git status --porcelain` output and open any changed file.

- **Editor Pane**  
  View file contents in a scrollable, syntax-agnostic text viewer.

- **Modal Dialogs**  
  Reusable, focus-trapping dialogs for confirmations, prompts, etc.

- **Keyboard & Mouse**  
  Navigate with arrow keys, Tab to switch panels, click to select or toggle.

---

## Prerequisites

- **Node.js** v14+  
- **npm** or **yarn**  
- A Unix-like terminal (Linux, macOS, WSL)

---

## Installation

```bash
git clone https://github.com/alfu32/react-blessed-ide.git
cd react-blessed-ide
npm install
````

Or with yarn:

```bash
git clone https://github.com/alfu32/react-blessed-ide.git
cd react-blessed-ide
yarn
```

---

## Running the IDE

```bash
npm start
```

Or:

```bash
node dist/app.js
```

* **Ctrl+C** to quit.
* **Tab** to switch focus between panels.
* **Arrow keys** or **mouse** to navigate lists and trees.
* **Enter** or **click** to open files or toggle directories.
* **Esc** to close modals.

---

## Project Structure

```
.
├── components
│   ├── FileTree.js      # Collapsible file tree component
│   ├── GitPanel.js      # Git status list component
│   └── ModalDialog.js   # Reusable modal dialog component
├── services
│   ├── WorkspaceService.cjs  # Recursively scans workspace, respects .gitignore
│   └── GitService.cjs        # Runs `git status --porcelain`
├── App.js               # Main layout and state management
├── index.js             # Entrypoint: polyfills + render(<App />)
├── package.json
└── README.md            # (this file)
```

---

## Component API

### `<FileTree root={INode} onFileSelect(path) onDirSelect(path,isOpen) />`

* **root**: an `INode` tree:

  ```ts
  interface INode {
    id: number        // inode
    type: 'd'|'f'|'l'|'p'
    name: string
    fullPath: string
    isOpen: boolean
    children: INode[]
  }
  ```
* **onFileSelect**: `(fullPath: string) => void`
* **onDirSelect**: `(fullPath: string, isOpen: boolean) => void`

### `<GitPanel gitStatus={string[]} onFileSelect(path) />`

* **gitStatus**: array of lines from `git status --porcelain`
* **onFileSelect**: `(fullPath: string) => void`

### `<ModalDialog title width height onClose>children</ModalDialog>`

* **title**: dialog headline
* **width**, **height**: percentages or fixed sizes
* **onClose**: `() => void`
* **children**: any Blessed elements (Text, Buttons, etc.)

---

## Customization & Extension

* **Key Bindings**: Extend `screen.key([...], handler)` in `index.js`.
* **Syntax Highlighting**: Integrate a parser + colorization in the editor pane.
* **Save & Edit**: Swap read-only `<Box>` for a `<textbox>` to enable editing.
* **Additional Panels**: Plug in terminals, search, or outline views by copying the FileTree/GitPanel pattern.

---

## Roadmap

* [ ] In-editor file editing & saving
* [ ] Search panel (fuzzy file search)
* [ ] Split-pane layout support
* [ ] Theming & color schemes

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/your-idea`)
3. Commit your changes (`git commit -m "feat: ...”`)
4. Push to your fork (`git push origin feature/your-idea`)
5. Open a Pull Request

Please adhere to existing code style and include tests where applicable.

---

## License

MIT © 2025

```
::contentReference[oaicite:0]{index=0}
```
