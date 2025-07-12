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
        if (node) {
            node.focus();
            node.setValue(content);
            node.screen.render();
        }
    }, [content]);

    return (
        <textarea
            ref={ref}
            // enable keyboard, mouse & vi‐style navigation
            keys
            mouse
            vi
            // show a scrollbar track
            scrollbar={{ ch: ' ', track: { bg: 'grey' } }}
            // basic styling
            style={{ fg: 'white', bg: 'black' }}
            // position & size come from boxProps
            {...boxProps}
            onKey={(ch, key) => {
                const node = ref.current;
                if (key.name === 's' && key.ctrl) {
                    // Ctrl+S → commit changes
                    onSave && onSave(node.getValue());
                }
                if (key.name === 'escape') {
                    // Esc → cancel editing
                    onCancel && onCancel();
                }
            }}
        />
    );
}
