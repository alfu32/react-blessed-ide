


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
    subtokenizer = null
}
export class TokenizerDef{
    name = '';
    flags='mgi'
    /**
     *
     * @type {{[name:string]:TokenizerMatcherDef}}
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
        Number:       {style: {fg:'red'},pattern:/\d+(?:\.\d+)?/mig},
        Identifier:   {style: {fg:'green'},pattern:/[A-Za-z_]\w*/mig},
        String:       {style: {fg:'yellow'},pattern:/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/mig},
        Operator:     {style: {fg:'cyan'},pattern:/==|!=|<=|>=|[+\-*/=<>]/mig},
        punctuation:  {style: {fg:'cyan'},pattern:/[()\[\]{}.,;:?\^]/mig},
        Whitespace:   {style: {fg:'white'},pattern:/\s+/mig},
        Others:       {style: {fg:'white'},pattern:/.*?/mig},
    }},
    js:{name:'js',flags:'mg',definitions:{
        Keyword:      {style: {fg:'magenta'},pattern:/\b(as|from|default|this|const|constructor|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw|switch|case|break|continue)\b/mig},
        Number:       {style: {fg:'red'},pattern:/\d+(?:\.\d+)?/mig},
        Comment:      {style: {fg:'#779977'},pattern:/\/\/.*$/mig},
        // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
        String:       {style: {fg:'yellow'},pattern:/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/mig},
        Operator:     {style: {fg:'cyan'},pattern:/==|!=|<=|>=|[+\-*/=<>%|&]/mig},
        Punctuation:  {style: {fg:'red'},pattern:/[\\()\[\]{}.,;:?^$]/mig},
        Whitespace:   {style: {fg:'white'},pattern:/\s+/smig},
        Identifier:   {style: {fg:'green'},pattern:/[A-Za-z_]\w*/mig},
        Others:       {style: {fg:'white'},pattern:/[^]/smig},
    }},
    htmx:{name:'htmx',flags:'mg',definitions:{
        TagDelim:   {style: {fg:'#FFDD00'},pattern:/<|<\/|\/>|>/ig},
        AttributeName: {style: {fg:'cyan'},pattern:/[0-9a-zA-Z:@-]*/ig},
        Equal: {style: {fg:'magenta'},pattern:/=/ig},
        JsxValue:  {style: {fg:'green'},pattern:/\{.*?}/mig,subtokenizer:'js'},
        AttributeValue:    {style: {fg:'yellow'},pattern:/".*?"/mig},
        Whitespace:   {style: {fg:'white'},pattern:/\s+/mig},
        Others:       {style: {fg:'white'},pattern:/.*?/mig},
    }},
    jsx:{name:'jsx',flags:'mg',definitions:{
        ReactToken:   {style: {fg:'#FFDD00'},pattern:/\buse[A-Z][a-z]*\b/mig},
        Keyword:      {style: {fg:'magenta'},pattern:/\b(as|from|default|const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw|switch|case|break|continue)\b/mig},
        JsxEndTag:    {style: {fg:'yellow'},pattern:/<\/[a-zA-Z-]*>/mig},
        JsxStartTag:  {style: {fg:'yellow'},pattern:/<[a-zA-Z-]*.*?>/mig,subtokenizer:'htmx'},
        Comment:      {style: {fg:'#779977'},pattern:/\/\/.*$/mig},
        // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
        Number:       {style: {fg:'red'},pattern:/\d+(?:\.\d+)?/mig},
        Punctuation:  {style: {fg:'red'},pattern:/[\\()\[\]{}.,;:?^$]/mig},
        Operator:     {style: {fg:'cyan'},pattern:/==|!=|<=|>=|[+\-*/=<>]/mig},
        Whitespace:   {style: {fg:'white'},pattern:/\s+/mig},
        Identifier:   {style: {fg:'green'},pattern:/[A-Za-z_]\w*/mig},
        Others:       {style: {fg:'white'},pattern:/.*?/mig},
    }},
    c:{name:'c',flags:'mg',definitions:{
        Keyword:      {style: {fg:'magenta'},pattern:/\b(int|const|char|long|if|else|for|while|return|switch|case|break|continue)\b/mig},
        Number:       {style: {fg:'red'},pattern:/\d+(?:\.\d+)?/mig},
        Comment:      {style: {fg:'#779977'},pattern:/\/\/.*$/mig},
        // MComment:     {style: {fg:'#779999'},pattern:'/\\*.*\\*/'},
        String:       {style: {fg:'yellow'},pattern:/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/mig},
        Operator:     {style: {fg:'cyan'},pattern:/==|!=|<=|>=|[+\-*/=<>]/mig},
        Punctuation:  {style: {fg:'cyan'},pattern:/==|!=|<=|>=|[+\-*/=<>]/mig},
        Whitespace:   {style: {fg:'white'},pattern:/\s+/mig},
        Identifier:   {style: {fg:'green'},pattern:/[A-Za-z_]\w*/mig},
        Others:       {style: {fg:'white'},pattern:/.*?/mig},
    }},
    words:{name:'c',flags:'mg',definitions:{
        Whitespace:       {style: {fg:'red'},pattern:/\s+/mig},
        Word:             {style: {fg:'green'},pattern:/\b.+?\b/mig},
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
    tokenizerDef['Any']={style: {fg:'#eeeeee'},pattern:/(\b|^).+?(\b|$)/smig}
    const tokenRegex = new RegExp(
        Object.entries(tokenizerDef.definitions)
            .map(([name, definition]) => `(?<${name}>${definition.pattern.source})`)
            .join('|'),
        tokenizerDef.flags||'g'
    );
    /**
     * @param {TokenizerMatcherDef} code
     * @return {Array<TokenizerToken>}
     */
    return function tokenizer(code,lineNumber){
        const tokens=[]
        for (const m of (code ).matchAll(tokenRegex)) {
            const groups = m.groups;
            const type = Object.keys(groups).find(key => groups[key] !== undefined);
            const tokenDef = tokenizerDef.definitions[type]
            const gt = TokenizerToken.fromRegexpMatch(m,tokenizerDef,tokenizerDef.name,lineNumber)
            //if(typeof(tokenDef.subtokenizer) === "string"){
            //    const stk = getNamedTokenizer(tokenDef.subtokenizer)
            //    stk(gt.text,lineNumber).forEach( subtoken => {
            //        subtoken.start+=gt.start
            //        subtoken.end+=gt.start
            //        subtoken.x+=gt.start
            //        subtoken.y=gt.y
            //        tokens.push(subtoken)
            //    })
            //}else{
                tokens.push(gt)
            //}
        }
        return tokens
    }
}