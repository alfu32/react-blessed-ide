/**
 *
 * @param {string} line
 * @return { TokenizerToken[] }
 */
export function highlight(line) {
    const tokenizer=getTokenizer('jsx')
    return tokenizer(line)
  }
export class TokenizerDef{
    style = {}
    pattern = ''
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
 * @type {Map<string,TokenizerDef>}} namedTokenizers
 */
export const namedTokenizers={
    any:{name:'any',definitions:{
        Number:       {style: {fg:'red'},pattern:'\\d+(?:\\.\\d+)?'},
        Identifier:   {style: {fg:'green'},pattern:'[A-Za-z_]\\w*'},
        String:       {style: {fg:'yellow'},pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {style: {fg:'cyan'},pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {style: {fg:'cyan'},pattern:'[()[\\]{}.,;]'},
        Whitespace:   {style: {fg:'white'},pattern:'\\s+'},
    }},
    js:{name:'js',definitions:{
        Keyword:      {style: {fg:'magenta'},pattern:'\\b(this|const|constructor|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)\\b'},
        Number:       {style: {fg:'red'},pattern:'\\d+(?:\\.\\d+)?'},
        String:       {style: {fg:'yellow'},pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {style: {fg:'cyan'},pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {style: {fg:'cyan'},pattern:'[()[\\]{}.,;]'},
        Whitespace:   {style: {fg:'white'},pattern:'\\s+'},
        Identifier:   {style: {fg:'green'},pattern:'[A-Za-z_]\\w*'},
    }},
    jsx:{name:'jsx',definitions:{
        ReactToken:   {style: {fg:'#FFDD00'},pattern:'\\buse[A-Z][a-z]*\\b'},
        Keyword:      {style: {fg:'magenta'},pattern:'\\b(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)\\b'},
        JsxTag:       {style: {fg:'#FFDD00'},pattern:'\\<(\\/){0,1}[a-zA-Z-]*\\>'},
        Number:       {style: {fg:'red'},pattern:'\\d+(?:\\.\\d+)?'},
        String:       {style: {fg:'yellow'},pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {style: {fg:'cyan'},pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {style: {fg:'cyan'},pattern:'[()[\\]{}.,;]'},
        Whitespace:   {style: {fg:'white'},pattern:'\\s+'},
        Identifier:   {style: {fg:'green'},pattern:'[A-Za-z_]\\w*'},
    }},
    c:{name:'c',definitions:{
        Keyword:      {style: {fg:'magenta'},pattern:'\\b(int|const|char|long|if|else|for|while|return)\\b'},
        Number:       {style: {fg:'red'},pattern:'\\d+(?:\\.\\d+)?'},
        String:       {style: {fg:'yellow'},pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {style: {fg:'cyan'},pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {style: {fg:'cyan'},pattern:'[()[\\]{}.,;]'},
        Whitespace:   {style: {fg:'white'},pattern:'\\s+'},
        Identifier:   {style: {fg:'green'},pattern:'[A-Za-z_]\\w*'},
    }},
  }

/**
 *
 * @param {string} name language name
 * @return {function (code:string,lineNumber:int): Array<TokenizerToken>}
 */
export function getTokenizer(name) {
    const tokenizerDef = namedTokenizers[name]||namedTokenizers['any']
    const tokenRegex = new RegExp(
        Object.entries(tokenizerDef.definitions)
          .map(([name, definition]) => `(?<${name}>${definition.pattern})`)
          .join('|'),
        'g'
    );
    /**
     * @param {String} code
     * @return {Array<TokenizerToken>}
     */
    return function tokenizer(code,lineNumber){
        const tokens=[]
        for (const m of code.matchAll(tokenRegex)) {
            const groups = m.groups;
            const type = Object.keys(groups).find(key => groups[key] !== undefined);
            const tokenDef = tokenizerDef.definitions[type]
            tokens.push(TokenizerToken.fromRegexpMatch(m,tokenizerDef,name,lineNumber))
        }
        return tokens
    }
  }