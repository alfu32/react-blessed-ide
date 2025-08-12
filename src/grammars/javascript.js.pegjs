{
  // helpers
  const KEYWORDS = new Set([
    "break","case","catch","class","const","continue","debugger","default","delete","do","else","export",
    "extends","finally","for","function","if","import","in","instanceof","new","return","super","switch",
    "this","throw","try","typeof","var","void","while","with","yield","let","static","enum","await","as",
    "from","of"
  ]);

  function tok(type, v) {
    const loc = location();
    return { type, value: v != null ? v : text(), loc };
  }
}

Start
  = parts:(JunkOrToken)* { return parts.filter(Boolean); }

/* ————— core choice ————— */

JunkOrToken
  = _                            { return null; }
  / c:Comment                    { return c; }
  / t:(NumberLiteral
     / StringLiteral
     / TemplateLiteral
     / RegexLiteral
     / IdentifierOrKeyword
     / Punct)                    { return t; }

/* ————— trivia ————— */

_ = ([ \t\n\r\f\u00A0\uFEFF] / LineTerminatorSequence)*

LineTerminatorSequence
  = "\r\n" / "\n" / "\r" / "\u2028" / "\u2029"

Comment
  = LineComment
  / BlockComment


LineComment
  = "//" [^\n\r\u2028\u2029]* LineTerminatorSequence? { return tok("js.comment.line"); }

BlockComment
  = "/*" (!"*/" .)* "*/"                              { return tok("js.comment.block"); }

/* ————— identifiers & keywords ————— */

IdentifierOrKeyword
  = id:Identifier {
      const v = id;
      if (v === "true" || v === "false") return tok("js.boolean", v);
      if (v === "null") return tok("js.null", v);
      if (KEYWORDS.has(v)) return tok("js.keyword", v);
      return tok("js.identifier", v);
    }

Identifier
  = head:[A-Za-z_$] tail:[A-Za-z0-9_$]* { return head + tail.join(""); }

/* ————— numbers ————— */

NumberLiteral
  = BigIntLiteral
  / HexIntegerLiteral
  / OctalIntegerLiteral
  / BinaryIntegerLiteral
  / DecimalLiteral

BigIntLiteral
  = (
      // 0xFFn, 0o77n, 0b101n
      ("0x"i h:HexDigits "n" { return tok("js.bigint"); })
    / ("0o"i o:OctalDigits "n" { return tok("js.bigint"); })
    / ("0b"i b:BinaryDigits "n" { return tok("js.bigint"); })
    / (i:DecimalDigits "n" { return tok("js.bigint"); })
    )

HexIntegerLiteral
  = "0x"i HexDigits { return tok("js.number"); }

OctalIntegerLiteral
  = "0o"i OctalDigits { return tok("js.number"); }

BinaryIntegerLiteral
  = "0b"i BinaryDigits { return tok("js.number"); }

DecimalLiteral
  = (
      // 123.45e-6   or   123.   or   123e+9
      d1:DecimalDigits "." d2:DecimalDigits? e:ExponentPart? { return tok("js.number"); }
    / "." d3:DecimalDigits e2:ExponentPart?                  { return tok("js.number"); }
    / d4:DecimalDigits e3:ExponentPart?                      { return tok("js.number"); }
    )

ExponentPart
  = [eE] [+\-]? DecimalDigits

DecimalDigits
  = [0-9] ( "_"? [0-9] )*

HexDigits
  = [0-9a-fA-F] ( "_"? [0-9a-fA-F] )*

OctalDigits
  = [0-7] ( "_"? [0-7] )*

BinaryDigits
  = [0-1] ( "_"? [0-1] )*

/* ————— strings ————— */

StringLiteral
  = SingleString
  / DoubleString

SingleString
  = "'" chars:SingleStringChar* "'" {
      const v = text();
      return v.indexOf("\n") >= 0 ? tok("js.multilineString", v) : tok("js.string", v);
    }

DoubleString
  = "\"" chars:DoubleStringChar* "\"" {
      const v = text();
      return v.indexOf("\n") >= 0 ? tok("js.multilineString", v) : tok("js.string", v);
    }

SingleStringChar
  = "\\'" / "\\\\" / "\\n" / "\\r" / "\\t" / "\\b" / "\\f"
  / "\\x" [0-9a-fA-F][0-9a-fA-F]
  / "\\u" ( [0-9a-fA-F]{4} / ("{" [0-9a-fA-F]+ "}") )
  / !("'" / "\\" / "\n" / "\r" / "\u2028" / "\u2029") .

DoubleStringChar
  = "\\\"" / "\\\\" / "\\n" / "\\r" / "\\t" / "\\b" / "\\f"
  / "\\x" [0-9a-fA-F][0-9a-fA-F]
  / "\\u" ( [0-9a-fA-F]{4} / ("{" [0-9a-fA-F]+ "}") )
  / !("\"" / "\\" / "\n" / "\r" / "\u2028" / "\u2029") .

/* ————— template literals (single token; interpolation not parsed) ————— */

TemplateLiteral
  = "`" TemplateBody* "`" {
      const v = text();
      return v.indexOf("\n") >= 0 ? tok("js.multilineString", v) : tok("js.string", v);
    }

TemplateBody
  = "\\`"               // escaped backtick
  / "\\\\" .            // any escape
  / "${" (!"}" .)* "}"  // crude interpolation skipper (no nested templates)
  / (!"`" .)

/* ————— regex literal (heuristic) ————— */

RegexLiteral
  = "/" RegexBody "/" RegexFlags {
      return tok("js.regex");
    }

RegexBody
  = (
      // character class [...]
      "[" ( "\\]" / "\\\\" . / !"]" . )* "]"
    / "\\/"         // escaped slash
    / "\\\\" .      // any escape
    / !("\n" / "\r" / "/") .
    )+

RegexFlags
  = [a-zA-Z]*

/* ————— punctuation/operators ————— */

Punct
  = p:(
      // longest-first
      ">>>=" / ">>=" / "<<=" / "**=" / "??=" / "&&=" / "||="
    / "===" / "!==" / ">>>"
    / ">>" / "<<" / "&&" / "||" / "??" / "?."
    / "**" / "=>"
    / "++" / "--"
    / "..."
    / "+=" / "-=" / "*=" / "/=" / "%=" / "&=" / "|=" / "^="
    / "==" / "!=" / "<=" / ">="
    / "+" / "-" / "*" / "/" / "%" / "&" / "|" / "^" / "~"
    / "<" / ">" / "=" / "!" / "?" / ":" / "." / "," / ";"
    / "(" / ")" / "{" / "}" / "[" / "]"
    ) { return tok("js.punctuation", p); }
