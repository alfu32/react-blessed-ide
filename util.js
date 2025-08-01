export function safeStringify(obj,space=undefined) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
        switch(key){
            // case "content": return "[content]"
            case "screen": return "[screen]"
            case "parent": return "[parent]"
            case "lines": return "[lines]"
            case "children": return "[children]"
        }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return;            // Duplicate/circular reference → omit
        }
        seen.add(value);
      }
      return value;
    },space);
  }