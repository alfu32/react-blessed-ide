{
  // helpers to build nodes with source locations
  function N(type, props = {}, children = []) {
    const loc = location();
    return { type, ...props, children, loc };
  }
  function T(type, value) {
    const loc = location();
    return { type, value, loc };
  }
  // "start of line" test: BOF or previous char is \n or \r
  function atBOL() {
    const pos = location().start.offset;
    if (pos === 0) return true;
    const prev = input.charAt(pos - 1);
    return prev === '\n' || prev === '\r';
  }
}

Start
  = blocks:(Block / BlankLine)* {
      // flatten, drop blanks
      return blocks.filter(Boolean);
    }

/* -------------------- Blocks -------------------- */

Block
  = AtxHeading
  / ThematicBreak
  / FencedCode
  / Blockquote
  / List
  / Paragraph

BlankLine
  = &{ return atBOL(); } S* NL { return null; }

AtxHeading
  = &{ return atBOL(); }
    hs:("######" / "#####" / "####" / "###" / "##" / "#")
    S* inl:InlineLine? NL?
    { return N("md.heading", { level: hs.length }, inl ?? []); }

ThematicBreak
  = &{ return atBOL(); }
    S* (
      ("***" ("*" / S)*) /
      ("---" ("-" / S)*) /
      ("___" ("_" / S)*)
    ) S* NL?
    { return N("md.thematic_break"); }

FencedCode
  = &{ return atBOL(); }
    fence:(CodeFence)
    lang:(!NL .)* NL
    body:CodeFenceBody(fence.seq) 
    { return N("md.code_fence", { lang: lang.join("").trim() || null, text: body }); }

CodeFence
  = seq:("```"+ / "~~~"+) { return { seq: text() }; }

CodeFenceBody(seq)
  = chunks:(
      !(&{ return atBOL(); } seq NL?) .   // anything not starting with closing fence
    )* 
    close:&{ return atBOL(); } seq NL?
    { return chunks.join(""); }

Blockquote
  = first:BlockquoteLine more:BlockquoteLine* NL?
    { 
      const text = [first, ...more].join("\n");
      // Keep it simple: parse as one paragraph of inlines
      return N("md.blockquote", {}, [ N("md.paragraph", {}, parseInline(text)) ]);
    }

BlockquoteLine
  = &{ return atBOL(); } ">" S? l:LineText NL? { return l; }

List
  = UnorderedList / OrderedList

UnorderedList
  = first:UnorderedItem more:(NL UnorderedItem)* NL?
    { return N("md.list", { ordered:false }, [first, ...(more?.map(m=>m[1])||[])]); }

UnorderedItem
  = &{ return atBOL(); } S* ("-" / "+" / "*") S+ t:LineText { return N("md.list_item", {}, parseInline(t)); }

OrderedList
  = first:OrderedItem more:(NL OrderedItem)* NL?
    { return N("md.list", { ordered:true }, [first, ...(more?.map(m=>m[1])||[])]); }

OrderedItem
  = &{ return atBOL(); } S* n:[0-9]+ ("." / ")") S+ t:LineText { return N("md.list_item", { num: parseInt(n.join(""),10) }, parseInline(t)); }

Paragraph
  = lines:ParagraphLines { return N("md.paragraph", {}, parseInline(lines)); }

ParagraphLines
  = line:ParagraphLine more:(NL ParagraphLine)* NL?
    { 
      let s = line;
      if (more) for (const m of more) s += "\n" + m[1];
      return s;
    }

ParagraphLine
  = &{ return atBOL(); }
    !(ThematicBreak / AtxHeading / ListStart / BlockquoteStart / FencedStart)
    l:LineText
    { return l; }

ListStart
  = S* (("-" / "+" / "*") S+ / ([0-9]+ ("." / ")") S+))

BlockquoteStart
  = S* ">"

FencedStart
  = S* ("```" / "~~~")

/* -------------------- Inlines -------------------- */

// Parse inline for a single logical line (ParagraphLine/Heading content)
InlineLine
  = parts:InlinePart* { return parts.flat(); }

// Utility: allow calling inline parsing from JS (blockquote/paragraph)
{
  function parseInline(s) {
    // A tiny inline-only run: we feed "s\n" into InlineLine via a sub-parser-like trick.
    // Peggy doesn't support reentry easily, but we can simulate by scanning with a micro-parser here.
    // Simpler: split by tokens using JS regexes compatible with our rules.
    // For correctness inside grammar, we instead reuse a minimal JS tokenizer:
    const r = [];
    let i = 0;
    while (i < s.length) {
      // code span
      if (s[i] === '`') {
        let j = i+1, tick = 1;
        while (s[j] === '`') { tick++; j++; }
        const fence = "`".repeat(tick);
        let k = s.indexOf(fence, j);
        if (k === -1) { r.push({type:"md.text", value:s.slice(i)}); break; }
        r.push({type:"md.code", value:s.slice(j,k)});
        i = k + tick; continue;
      }
      // strong/em
      const two = s.slice(i,i+2), one = s[i];
      if (two === '**' || two === '__') {
        const k = s.indexOf(two, i+2);
        if (k !== -1) { r.push({type:"md.strong", children: parseInline(s.slice(i+2, k))}); i = k+2; continue; }
      }
      if (one === '*' || one === '_') {
        const k = s.indexOf(one, i+1);
        if (k !== -1) { r.push({type:"md.em", children: parseInline(s.slice(i+1, k))}); i = k+1; continue; }
      }
      // strikethrough
      if (two === '~~') {
        const k = s.indexOf('~~', i+2);
        if (k !== -1) { r.push({type:"md.del", children: parseInline(s.slice(i+2, k))}); i = k+2; continue; }
      }
      // link/image: ![alt](url) or [text](url)
      if (s[i] === '!' && s[i+1] === '[') {
        const close = s.indexOf(']', i+2);
        const openp = (close !== -1) ? s.indexOf('(', close+1) : -1;
        const closep = (openp !== -1) ? s.indexOf(')', openp+1) : -1;
        if (closep !== -1) {
          r.push({type:"md.image", alt:s.slice(i+2, close), url:s.slice(openp+1, closep)});
          i = closep+1; continue;
        }
      }
      if (s[i] === '[') {
        const close = s.indexOf(']', i+1);
        const openp = (close !== -1) ? s.indexOf('(', close+1) : -1;
        const closep = (openp !== -1) ? s.indexOf(')', openp+1) : -1;
        if (closep !== -1) {
          r.push({type:"md.link", url:s.slice(openp+1, closep), children: parseInline(s.slice(i+1, close))});
          i = closep+1; continue;
        }
      }
      // autolink <http://...>
      if (s[i] === '<') {
        const j = s.indexOf('>', i+1);
        if (j !== -1) {
          const url = s.slice(i+1, j);
          if (/^[a-z]+:\/\//i.test(url)) { r.push({type:"md.link", url, children:[{type:"md.text", value:url}]}); i = j+1; continue; }
        }
      }
      // plain char
      let j = i+1;
      while (j < s.length && !"*_~`<![".includes(s[j])) j++;
      r.push({type:"md.text", value: s.slice(i, j)});
      i = j;
    }
    return r;
  }
}

// Inline parts inside a single line (kept minimal here; JS helper does the heavy lifting)
InlinePart
  = chars:(!NL .)+ { return parseInline(text()); }

/* -------------------- Lexical -------------------- */

LineText
  = t:(!NL .)* { return t.join(""); }

S  = [ \t]
NL = "\r\n" / "\n" / "\r"
