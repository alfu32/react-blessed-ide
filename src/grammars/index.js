import { parse as markdown } from "./markdown.md.pegjs";
import { parse as javascript } from "./javascript.js.pegjs";

export const parsers={
    text:markdown,
    markdown:markdown,
    javascript:javascript
}