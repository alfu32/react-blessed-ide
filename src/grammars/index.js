import { parse as text } from "grammar.txt.pegjs";
import { parse as javascript } from "javascript.js.pegjs";

export const parsers={
    text:text,
    javascript:javascript
}