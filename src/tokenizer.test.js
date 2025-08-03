import {highlight,getTokenizer} from './tokenizer.js'
import fs from 'fs'

function print(arg){
    process.stdout.write(arg)
}
function println(arg){
    process.stdout.write(arg)
    process.stdout.write('\n')
}
function test_my_tokenizer(){

    const ff = fs.readFileSync('App.jsx').toString()
    const lines = ff.split('\n')
    const padding = Math.trunc(Math.log10(lines.length)) + 1

    
    // 3) Example usage
    const code = `let x = "hi";\nconst y = 3.14;`;
    const tokenizer=getTokenizer('js')

    lines.forEach( (line,i,a) => {
        const tokens = tokenizer(line)
        println(`${String(i+1).padStart(padding,'0')}| ${line}`)
        tokens.forEach( tk => println(JSON.stringify(tk)))
    })

}

function test_substring(){
    
}

