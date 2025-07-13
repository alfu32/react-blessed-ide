export function highlight(line) {
    const tokenizer=getTokenizer('jsx')
    return tokenizer(line)
  }

export const namedTokenizers={
    any:{name:'any',definitions:{
        Number:       {color:'red',pattern:'\\d+(?:\\.\\d+)?'},
        Identifier:   {color:'green',pattern:'[A-Za-z_]\\w*'},
        String:       {color:'yellow',pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {color:'blue',pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {color:'blue',pattern:'[()[\\]{}.,;]'},
        Whitespace:   {color:'',pattern:'\\s+'},
    }},
    js:{name:'js',definitions:{
        Keyword:      {color:'magenta',pattern:'(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)'},
        Number:       {color:'red',pattern:'\\d+(?:\\.\\d+)?'},
        String:       {color:'yellow',pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {color:'blue',pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {color:'blue',pattern:'[()[\\]{}.,;]'},
        Whitespace:   {color:'',pattern:'\\s+'},
        Identifier:   {color:'green',pattern:'[A-Za-z_]\\w*'},
    }},
    jsx:{name:'jsx',definitions:{
        Keyword:      {color:'magenta',pattern:'(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)'},
        JsxTag:       {color:'yellow',pattern:'\\<(\\/){0,1}[a-zA-Z-]*\\>'},
        Number:       {color:'red',pattern:'\\d+(?:\\.\\d+)?'},
        String:       {color:'yellow',pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {color:'blue',pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {color:'blue',pattern:'[()[\\]{}.,;]'},
        Whitespace:   {color:'',pattern:'\\s+'},
        Identifier:   {color:'green',pattern:'[A-Za-z_]\\w*'},
    }},
    c:{name:'c',definitions:{
        Keyword:      {color:'magenta',pattern:'(int|const|char|long|if|else|for|while|return)'},
        Number:       {color:'red',pattern:'\\d+(?:\\.\\d+)?'},
        String:       {color:'yellow',pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {color:'blue',pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {color:'blue',pattern:'[()[\\]{}.,;]'},
        Whitespace:   {color:'',pattern:'\\s+'},
        Identifier:   {color:'green',pattern:'[A-Za-z_]\\w*'},
    }},
  }
export function getTokenizer(name) {
    const tokenizerDef = namedTokenizers[name]||namedTokenizers['any']
    const tokenRegex = new RegExp(
        Object.entries(tokenizerDef.definitions)
          .map(([name, definition]) => `(?<${name}>${definition.pattern})`)
          .join('|'),
        'g'
    );
    return function tokenizer(code){
        const tokens=[]
        for (const m of code.matchAll(tokenRegex)) {
            const groups = m.groups;
            const type = Object.keys(groups).find(key => groups[key] !== undefined);
            const tokenDef = tokenizerDef.definitions[type]
            tokens.push({ name,text: m[0], type, color:tokenDef.color })
        }
        return tokens
    }
  }