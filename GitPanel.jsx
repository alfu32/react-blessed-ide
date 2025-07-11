// components/GitPanel.js
import React, { Component } from 'react';
import { List as list } from 'react-blessed';

export default function GitPanel({ gitStatus, onFileSelect }) {

    return (
        <list
            top={3}
            height="97%"
            items={gitStatus}
            keys mouse
            style={{ selected: { bg: 'blue' } }}
            onSelect={(_, idx) => {
                const line = gitStatus[idx];
                const file = line.split(' ').pop();
                onFileSelect(file);
            }}
        />
    );
}
