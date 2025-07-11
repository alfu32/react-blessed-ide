// components/GitPanel.js
import React, { Component } from 'react';
import { List as list } from 'react-blessed';

export default class GitPanel extends Component {
  render() {
    const { gitStatus, onFileSelect } = this.props;

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
}
