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

    /**
     *
     * @param {RegExpExecArray} m
     * @param tokenizerDef
     * @return {{name: void | string, text: *, type: string, style, start, end: *}}
     */
    static fromRegexpMatch(m,tokenizerDef,tokenizerName){
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
        Keyword:      {style: {fg:'magenta'},pattern:'(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)'},
        Number:       {style: {fg:'red'},pattern:'\\d+(?:\\.\\d+)?'},
        String:       {style: {fg:'yellow'},pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {style: {fg:'cyan'},pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {style: {fg:'cyan'},pattern:'[()[\\]{}.,;]'},
        Whitespace:   {style: {fg:'white'},pattern:'\\s+'},
        Identifier:   {style: {fg:'green'},pattern:'[A-Za-z_]\\w*'},
    }},
    jsx:{name:'jsx',definitions:{
        Keyword:      {style: {fg:'magenta'},pattern:'(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)'},
        JsxTag:       {style: {fg:'yellow'},pattern:'\\<(\\/){0,1}[a-zA-Z-]*\\>'},
        Number:       {style: {fg:'red'},pattern:'\\d+(?:\\.\\d+)?'},
        String:       {style: {fg:'yellow'},pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {style: {fg:'cyan'},pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {style: {fg:'cyan'},pattern:'[()[\\]{}.,;]'},
        Whitespace:   {style: {fg:'white'},pattern:'\\s+'},
        Identifier:   {style: {fg:'green'},pattern:'[A-Za-z_]\\w*'},
    }},
    c:{name:'c',definitions:{
        Keyword:      {style: {fg:'magenta'},pattern:'(int|const|char|long|if|else|for|while|return)'},
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
 * @return {function (code:string): Array<TokenizerToken>}
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
    return function tokenizer(code){
        const tokens=[]
        for (const m of code.matchAll(tokenRegex)) {
            const groups = m.groups;
            const type = Object.keys(groups).find(key => groups[key] !== undefined);
            const tokenDef = tokenizerDef.definitions[type]
            tokens.push(TokenizerToken.fromRegexpMatch(m,tokenizerDef,name))
        }
        return tokens
    }
  }