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

        // Set initial content
        node.setValue(content);

        // Focus & start listening for input
        node.focus();
        node.readInput();
        node.screen.program.showCursor();

        // When this box regains focus, re-enable the cursor & input
        const onFocus = () => {
            node.readInput();
            node.screen.program.showCursor();
            node.screen.render();
        };
        node.on('focus', onFocus);

        return () => {
            node.removeListener('focus', onFocus);
            node.screen.program.hideCursor();
        };
    }, [content]);

    return (
        <textarea
            ref={ref}
            // turn on the “input” behavior
            input
            keys
            mouse
            clickable
            vi
            // show a scrollbar track
            scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}

            // explicitly enable a blinking line cursor
            cursor={{ blink: true, shape: 'line' }}

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
                if (key.name === 's' && key.ctrl) {
                    onSave && onSave(ref.current.getValue());
                }
                if (key.name === 'escape') {
                    onCancel && onCancel();
                }
            }}
        />
    );
}
