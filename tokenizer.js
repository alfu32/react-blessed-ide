export function highlight(line) {
    const tokenizer=getTokenizer('js')
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
        Number:       {color:'red',pattern:'\\d+(?:\\.\\d+)?'},
        Identifier:   {color:'green',pattern:'[A-Za-z_]\\w*'},
        String:       {color:'yellow',pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {color:'blue',pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {color:'blue',pattern:'[()[\\]{}.,;]'},
        Whitespace:   {color:'',pattern:'\\s+'},
        Keyword:      {color:'magenta',pattern:'(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)'},
    }},
    jsx:{name:'jsx',definitions:{
        Number:       {color:'red',pattern:'\\d+(?:\\.\\d+)?'},
        Identifier:   {color:'green',pattern:'[A-Za-z_]\\w*'},
        String:       {color:'yellow',pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {color:'blue',pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {color:'blue',pattern:'[()[\\]{}.,;]'},
        Whitespace:   {color:'',pattern:'\\s+'},
        Keyword:      {color:'magenta',pattern:'(const|let|var|function|if|else|for|while|return|class|import|export|new|await|async|try|catch|throw)'},
    }},
    c:{name:'c',definitions:{
        Number:       {color:'red',pattern:'\\d+(?:\\.\\d+)?'},
        Identifier:   {color:'green',pattern:'[A-Za-z_]\\w*'},
        String:       {color:'yellow',pattern:`"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'`},
        Operator:     {color:'blue',pattern:'==|!=|<=|>=|[+\\-*/=<>]'},
        Punctuation:  {color:'blue',pattern:'[()[\\]{}.,;]'},
        Whitespace:   {color:'',pattern:'\\s+'},
        Keyword:      {color:'magenta',pattern:'(int|const|char|long|if|else|for|while|return)'},
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