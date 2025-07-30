// components/GitPanel.js
import React, {Component, useEffect, useState} from 'react';
import {
    ListElement as list,
    BoxElement as box,
    ButtonElement as button,
    TextareaElement as textarea,
    TextElement as text
} from 'react-blessed';
import {Workspace} from "./services/WorkspaceService";
import {getStatus,getCommits,getBranch,getCurrentTag} from "./services/GitService";
import ModalDialog from "./ModalDialog";

export function GitPanel({
        rootDir,
        onFileSelect ,
        ...boxProps
    }) {
    const [message, setMessage] = useState(false);
    const [workspace, setWorkspace]   = useState(new Workspace());
    const [gitStatus, setGitStatus] = useState([]);
    const [gitCommits, setGitCommits] = useState([]);
    const [gitBranch, setGitBranch] = useState("");
    const [gitCurrentTag, setGitCurrentTag] = useState("");
    useEffect(() => {
        Promise.all([
            getStatus(rootDir),
            getCommits(rootDir),
            getBranch(rootDir),
            getCurrentTag(rootDir),
        ])
        .then((result)=> {
            setGitStatus(result[0])
            setGitCommits(result[1])
            setGitBranch(result[2])
            setGitCurrentTag(result[3])
        })
    }, []);
    const onFilePathSelect = (event) => {
        setMessage(`file path selected ${event.content} ${process.cwd()}`)
    };
    const onCommitSelect = (event) => {
        setMessage(`commit selected ${event.content} ${process.cwd()}`)
    };

    return (
        <box {...boxProps}>
            <box key={3} label={'Git'} height={9} border={{ type: 'line' }}>
                <list
                    mouse
                    keys
                    input
                    clickable
                    focused
                    scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
                    items={gitStatus}
                    keys mouse style={{selected: {bg: 'blue'}}}
                    onSelect={onFilePathSelect}
                    label={'Status'}
                />
            </box>
            <textarea
                key={4} top={9}  height={9}
                mouse
                keys
                input
                clickable
                focused
                label={'Comment'}
                border={{ type: 'line' }}
                inputOnFocus={true}/>
            <button
                key={5} top={18} left={'0%'} height={3} width={'48%'}
                mouse
                keys
                input
                clickable
                focused
                valign={'middle'}
                align={'center'}
                style={{bg:'#ffaa00',fg:'#333333'}}
                border={{ type: 'line',bg:'#ffaa00',fg:'#333333' }}
                content={'commit'}
            />
            <button
                key={5} top={18} left={'52%'} height={3} width={'48%'}
                mouse
                keys
                input
                clickable
                focused
                valign={'middle'}
                align={'center'}
                style={{bg:'#ffaa00',fg:'#333333'}}
                border={{ type: 'line',bg:'#ffaa00',fg:'#333333' }}
                content={'revert'}
            />
            <box key={3} label={'Commits'} top={21} border={{ type: 'line' }}>
                <list
                    mouse
                    keys
                    input
                    clickable
                    focused
                    scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
                    items={gitCommits}
                    keys mouse style={{selected: {bg: 'blue'}}}
                    onSelect={onCommitSelect}
                    label={'Status'}
                />
            </box>
            {message && (
                <ModalDialog
                    title="Message"
                    onClose={() => setMessage(false)}
                >
                    <text>{message}</text>
                </ModalDialog>
            )}
        </box>
    );
}
