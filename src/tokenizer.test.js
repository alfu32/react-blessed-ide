import {highlight, getNamedTokenizer, getTokenizer} from './tokenizer.js'
import fs from 'fs'

function print(arg){
    process.stdout.write(arg)
}
function println(arg){
    process.stdout.write(arg)
    process.stdout.write('\n')
}
function test_my_tokenizer(){

    const ff = fs.readFileSync('src/App.jsx').toString()
    const lines = ff.split('\n')
    const padding = Math.trunc(Math.log10(lines.length)) + 1

    
    // 3) Example usage
    const code = `let x = "hi";\nconst y = 3.14;`;
    const tokenizer=getNamedTokenizer('js')

    lines.forEach( (line,i,a) => {
        const tokens = tokenizer(line)
        println(`${String(i+1).padStart(padding,'0')}| ${line}`)
        tokens.forEach( tk => println(JSON.stringify(tk)))
    })

}

function test_substring(){
    
}

function test_regex(){
    const r=/(^|\b).+?(\b|$)/gi
    const text="There is [+] something [-] that + can not describe !"
    const matches = text.match(r)
    if(matches){
        for(let m of matches){
            console.log(JSON.stringify(m))
        }
    }
    const tokenizer = getNamedTokenizer("words")
    const result =  tokenizer(text,1)
    print(JSON.stringify(result,null,' '))

}

function test_regex(){
    const text=`
    bun.lock                                       [r] [x]
  [+] components                         [+D] [+F] [r] [x]
  [+] dist                               [+D] [+F] [r] [x]
    git-sync-all.sh                                [r] [x]
    index.jsx                                      [r] [x]
  [-] log                                [+D] [+F] [r] [x]
      buffer.sgr                                   [r] [x]
      log.error                                    [r] [x]
      log.json                                     [r] [x]
      package.0.json                               [r] [x]
      terminal-dump.log                            [r] [x]
  [-] node_modules                       [+D] [+F] [r] [x]
    [+] .bin                             [+D] [+F] [r] [x]
      .package-lock.json                           [r] [x]
    [+] @ampproject                      [+D] [+F] [r] [x]
    [-] @babel                           [+D] [+F] [r] [x]
      [+] cli                            [+D] [+F] [r] [x]
      [-] code-frame                     [+D] [+F] [r] [x]
          LICENSE                                  [r] [x]
          README.md                                [r] [x]
        [-] lib                          [+D] [+F] [r] [x]
            index.js                               [r] [x]
            index.js.map                           [r] [x]
          package.json                             [r] [x]
      [+] compat-data                    [+D] [+F] [r] [x]
      [+] core                           [+D] [+F] [r] [x]`.split("\n").filter(v => v.trim() !== "")
    const tkDef = {
        name:'listing',
        flags:'mg',
        definitions:{
            "Whitespace":     {style: {fg:'white'},pattern:/\s+/mgi},
            "OpenButton":     {style: {fg:'yellow'},pattern:/\[\+]/mgi},
            "CloseButton":    {style: {fg:'yellow'},pattern:/\[-]/mgi},
            "AddDirButton":   {style: {fg:'cyan'},pattern:/\[\+D]/mgi},
            "AddFileButton":  {style: {fg:'magenta'},pattern:/\[\+F]/mgi},
            "RenameButton":   {style: {fg:'blue'},pattern:/\[r]/mgi},
            "DeleteButton":   {style: {fg:'red'},pattern:/\[x]/mgi},
            "NodeName":       {style: {fg:'green'},pattern:/[a-zA-Z0-9_={}\[\]%*()m,.:;!?@~-]+/mgi},
            "Word":           {style: {fg:'green'},pattern:/\s.+?\s/mgi},
        }
    }
    const tokenizer = getTokenizer(tkDef)
    text.forEach( (line, i, a) => {
        const tokens = tokenizer(line, i)
        //const phrase = tokens.map(t => `${t.type} (${t.start},${t.text.length})`).join(',')
        const phrase = tokens.map(t => `${t.type}`).join(',')
        // console.log(JSON.stringify(tokens,null,' '))
        console.log(line + ' ' + phrase)
    })

}

test_my_tokenizer()
test_substring()
test_regex()

