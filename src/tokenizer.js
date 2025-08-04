/**
 *
 * @param {string} line
 * @return { TokenizerToken[] }
 */
export function highlight(line) {
    const tokenizer=getNamedTokenizer('jsx')
    return tokenizer(line)
  }
export class TokenizerMatcherDef{
    style = {}
    pattern = ''
}
export class TokenizerDef{
    name = '';
    flags='mgi'
    /**
     *
     * @type {{[name:string]:TokenizerDef}}
     */
    definitions = {}
}
export class TokenizerToken{
    tokenizerName=''
    type=''
    style={}
    start=0
    end=0
    y=0
    x=0
    text=''

    /**
     *
     * @param {RegExpExecArray} m
     * @param tokenizerDef
     * @return {{name: void | string, text: *, type: string, style, start, end: *}}
     */
    static fromRegexpMatch(m,tokenizerDef,tokenizerName,lineNumber){
        const groups = m.groups;
        const type = Object.keys(groups).find(key => groups[key] !== undefined);
        const tokenDef = tokenizerDef.definitions[type]
        const tt = new TokenizerToken()
        tt.tokenizerName=tokenizerName
        tt.text= m[0]
        tt.type=type
        tt.style=tokenDef.style
        tt.start=m.index
        tt.end=m.index+m[0].length
        tt.y=lineNumber
        tt.x=tt.start
        return tt
    }
}
/**
 * @const
 * @type {Map<string,TokenizerMatcherDef>}} namedTokenizers
 */
export const namedTokenizers={
    any:{name:'any',definitions:{
        Number:       {style: {fg:'red'},pattern:'\\d+(?:\\.\\d+)?'},
        Identifier:   {style: {fg:'green'},pattern:'[A-Za-z_]\\w*'},
        String:       {style: {fg:'yellow'},pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {style: {fg:'cyan'},pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        punctuation:  {style: {fg:'cyan'},pattern:'[()\\[\\]{}.,;:?]'},
        Whitespace:   {style: {fg:'white'},pattern:'\\s+'},
        Others:       {style: {fg:'white'},pattern:'.*?'},
    }},
    js:{name:'js',flags:'mg',definitions:{
        Keyword:      {style: {fg:'magenta'},pattern:'\\b(as|from|default|this|const|constructor|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw|switch|case|break|continue)\\b'},
        Number:       {style: {fg:'red'},pattern:'\\d+(?:\\.\\d+)?'},
        Comment:      {style: {fg:'#779977'},pattern:'//.*$'},
        // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
        String:       {style: {fg:'yellow'},pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {style: {fg:'cyan'},pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
            Punctuation:  {style: {fg:'cyan'},pattern:'[()\\[\\]{}.,;:?]'},
        Whitespace:   {style: {fg:'white'},pattern:'\\s+'},
        Identifier:   {style: {fg:'green'},pattern:'[A-Za-z_]\\w*'},
            Others:       {style: {fg:'white'},pattern:'.*?'},
    }},
    jsx:{name:'jsx',flags:'mg',definitions:{
        ReactToken:   {style: {fg:'#FFDD00'},pattern:'\\buse[A-Z][a-z]*\\b'},
        Keyword:      {style: {fg:'magenta'},pattern:'\\b(as|from|default|const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw|switch|case|break|continue)\\b'},
        JsxTag:       {style: {fg:'#FFDD00'},pattern:'\\<(\\/){0,1}[a-zA-Z-]*\\>'},
        Comment:      {style: {fg:'#779977'},pattern:'//.*$'},
        // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
        Number:       {style: {fg:'red'},pattern:'\\d+(?:\\.\\d+)?'},
        String:       {style: {fg:'yellow'},pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {style: {fg:'cyan'},pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {style: {fg:'cyan'},pattern:'[()\\[\\]{}.,;:?]'},
        Whitespace:   {style: {fg:'white'},pattern:'\\s+'},
        Identifier:   {style: {fg:'green'},pattern:'[A-Za-z_]\\w*'},
            Others:       {style: {fg:'white'},pattern:'.*?'},
    }},
    c:{name:'c',flags:'mg',definitions:{
        Keyword:      {style: {fg:'magenta'},pattern:'\\b(int|const|char|long|if|else|for|while|return|switch|case|break|continue)\\b'},
        Number:       {style: {fg:'red'},pattern:'\\d+(?:\\.\\d+)?'},
        Comment:      {style: {fg:'#779977'},pattern:'//.*$'},
        // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
        String:       {style: {fg:'yellow'},pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {style: {fg:'cyan'},pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {style: {fg:'cyan'},pattern:'[()\\[\\]{}.,;:?]'},
        Whitespace:   {style: {fg:'white'},pattern:'\\s+'},
        Identifier:   {style: {fg:'green'},pattern:'[A-Za-z_]\\w*'},
            Others:       {style: {fg:'white'},pattern:'.*?'},
    }},
    words:{name:'c',flags:'mg',definitions:{
        Whitespace:       {style: {fg:'red'},pattern:'\\s+'},
        Word:             {style: {fg:'green'},pattern:'\\b.+?\\b'},
    }},
  }

/**
 *
 * @param {string} name language name
 * @return {function (code:string,lineNumber:int): Array<TokenizerToken>}
 */
export function getNamedTokenizer(name) {
    const tokenizerDef = namedTokenizers[name]||namedTokenizers['any']
    return getTokenizer(tokenizerDef)
}
/**
 *
 * @param {TokenizerDef} tokenizerDef language name
 * @return {function (code:string,lineNumber:int): Array<TokenizerToken>}
 */
export function getTokenizer(tokenizerDef) {
    const tokenRegex = new RegExp(
        Object.entries(tokenizerDef.definitions)
            .map(([name, definition]) => `(?<${name}>${definition.pattern})`)
            .join('|'),
        tokenizerDef.flags||'g'
    );
    /**
     * @param {TokenizerMatcherDef} code
     * @return {Array<TokenizerToken>}
     */
    return function tokenizer(code,lineNumber){
        const tokens=[]
        for (const m of code.matchAll(tokenRegex)) {
            const groups = m.groups;
            const type = Object.keys(groups).find(key => groups[key] !== undefined);
            const tokenDef = tokenizerDef.definitions[type]
            tokens.push(TokenizerToken.fromRegexpMatch(m,tokenizerDef,tokenizerDef.name,lineNumber))
        }
        return tokens
    }
}