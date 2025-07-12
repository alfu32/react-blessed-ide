// components/TextEditor.js
import React, { useEffect, useRef } from 'react';

export function TextEditor({
                               content = '',
                               onSave,
                               onCancel,
                               // any blessed box props: top, left, width, height, etc.
                               ...boxProps
                           }) {
    const ref = useRef();

    useEffect(() => {
        const node = ref.current;
        if (!node) return;

        // initial focus & set content
        node.focus();
        node.setValue(content);
        node.screen.render();

        // also refocus on any mouse click inside the editor
        const handler = (el) => {
            if (el === node || el.parent === node) {
                node.focus();
                node.screen.render();
            }
        };
        node.screen.on('element click', handler);

        return () => {
            node.screen.off('element click', handler);
        };
    }, [content]);

    return (
        <textarea
            ref={ref}
            // enable keyboard, mouse & vi‐style navigation
            keys
            mouse
            clickable
            vi
            // show a scrollbar track
            scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
            // basic styling
            style={{ fg: 'white', bg: 'black' }}
            // position & size come from boxProps
            {...boxProps}
            onClick={() => {
                // direct onClick also ensures focus
                const node = ref.current;
                if (node) {
                    node.focus();
                    node.screen.render();
                }
            }}
            onKey={(ch, key) => {
                const node = ref.current;
                if (key.name === 's' && key.ctrl) {
                    onSave && onSave(node.getValue());
                }
                if (key.name === 'escape') {
                    onCancel && onCancel();
                }
            }}
        />
    );
}
