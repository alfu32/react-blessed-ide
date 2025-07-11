// components/ModalDialog.js
import React, { useEffect, useRef } from 'react';
import { BoxElement as box, TextElement as text } from 'react-blessed';

export default function ModalDialog({
    title = 'Dialog',
    width = '50%',
    height = '50%',
    onClose,
    children
}) {
    const boxRef = useRef();

    // focus the modal so it can catch keypresses
    useEffect(() => {
        const node = boxRef.current;
        if (node) node.focus();
    }, []);

    return (
        <box
            ref={boxRef}
            top="center"
            left="center"
            width={width}
            height={height}
            border={{ type: 'line' }}
            style={{ bg: 'black', fg: 'white' }}
            keys
            mouse
            clickable
            // close on ESC
            onKey={(ch, key) => {
                if (key.name === 'escape') onClose();
            }}
        >
            {/* Header with title and close button */}
            <box height={1} width="100%" style={{ fg: 'green' }}>
                <text bold>{` ${title}`} </text>
                <text
                    right={0}
                    mouse
                    clickable
                    underline
                    onClick={onClose}
                >[×]</text>
            </box>

            {/* Content area */}
            <box top={2} left={1} right={1} bottom={1} scrollable keys mouse alwaysScroll>
                {children}
            </box>
        </box>
    );
}
