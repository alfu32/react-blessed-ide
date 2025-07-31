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
import {getStatus,getCommits,getBranch,getCurrentTag,getRemotes,gitStage,gitUnstage,gitCommit,gitPush} from "./services/GitService";
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
    const [gitRemotes, setGitRemotes] = useState([]);
    const [commitMessage, setCommitMessage] = useState("");
    const sortFilesFn = (a,b) => a.substring(3)>b.substring(3)?1:(a.substring(3)===b.substring(3)?0:-1)
    async function refreshAll() {
        const result = await Promise.all([
            getStatus(rootDir),
            getCommits(rootDir),
            getBranch(rootDir),
            getCurrentTag(rootDir),
            getRemotes(rootDir),
        ])
        setGitStatus(Array.from(result[0]).toSorted(sortFilesFn))
        setGitCommits(result[1])
        setGitBranch(result[2])
        setGitCurrentTag(result[3])
        setGitRemotes(Array.from(result[4]).map(v =>{
            const tk = v.split(/\s+/gi)
            return {
                name: tk[0],
                url: tk[1],
                kind: tk[2],
            }
        }))
    }
    useEffect(() => {
        refreshAll()
    }, []);
    const onFilePathSelect = (event) => {
        const staged = event.content.substring(0,1)
        const changed = event.content.substring(1,2)

        const file = event.content.substring(3);
        if (staged === ' ' || staged === '?' || (changed !== ' ' && staged === changed)) {
            // setMessage(`git stage "${file}"`)
            gitStage(rootDir, file).then(result => {
                // setMessage(`git staged "${file} (${result})"`)
                return getStatus(rootDir)
            }).then(result => {
                setGitStatus(result.toSorted(sortFilesFn))
            }).catch(error => {
                setMessage(`git stage "${file} error (${error})"`)
            });
        }else if (changed === ' ' || changed === '?') {
            // setMessage(`git unstage "${file}"`)
            gitUnstage(rootDir, file).then(result => {
                // setMessage(`git unstaged "${file} (${result})"`)
                return getStatus(rootDir)
            }).then(result => {
                setGitStatus(result.toSorted(sortFilesFn))
            }).catch(error => {
                setMessage(`git unstaged "${file} error (${error})"`)
            });
        }
    };
    const onCommitSelect = (event) => {
        // setMessage(`commit selected ${event.content} ${process.cwd()}`)
        setCommitMessage(event.content.substring(9))
    };
    const onCommitMessageChanged = (event) => {
        // setMessage(`commit selected ${event.content} ${process.cwd()}`)
        setCommitMessage(event.content)
    };
    const commitStagedFiles = (event) => {
        if(commitMessage.trim() === ""){
            setMessage(`commit message cannot be empty`)
        }else{
            gitCommit(rootDir, commitMessage).then(result => {
                return refreshAll()
            }).then(result => {
                setMessage(`git commit -m "${commitMessage}"`)
            })
        }
        // setMessage(`commit selected ${event.content} ${process.cwd()}`)
    };
    const status = `{cyan-fg}${(gitRemotes[0]||{}).name}{/cyan-fg}/{red-fg}${gitBranch}{/red-fg}({yellow-fg}${gitCurrentTag}{/yellow-fg})`
    const statusLen=`${(gitRemotes[0]||{}).name}/${gitBranch}(${gitCurrentTag})`.length
    return (
        <box {...boxProps}>
            <box label={`Status`} height={9} border={{ type: 'line' }}>
                <list
                    mouse
                    keys
                    input
                    clickable
                    focused
                    scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
                    items={gitStatus}
                    style={{selected: {bg: 'blue'}}}
                    onSelect={onFilePathSelect}
                />
            </box>
            <box content={status} top={0} left={9} width={statusLen} height={1} tags={true}/>
            <box content={rootDir} top={8} left={2} width={rootDir.length} height={1}/>
            <textarea
                top={9}  height={9}
                input
                focused
                scrollable
                alwaysScroll
                content={commitMessage}
                label={'Commit Message'}
                border={{ type: 'line' }}
                inputOnFocus={true}
                onChange={onCommitMessageChanged}
            />
            <button
                top={18} left={'0%'} height={3} width={'48%'}
                mouse
                keys
                input
                clickable
                focused
                valign={'middle'}
                align={'center'}
                style={{bg:'#ffaa00',fg:'#333333',hover:{bg:'#ffdd88',fg:'#333333'}}}
                onClick={commitStagedFiles}
                content={'\ncommit\n'}
            />
            <button
                top={18} left={'52%'} height={3} width={'48%'}
                mouse
                keys
                input
                clickable
                focused
                valign={'middle'}
                align={'center'}
                style={{bg:'#ffaa00',fg:'#333333',hover:{bg:'#ffdd88',fg:'#333333'}}}
                content={'\nrevert\n'}
            />
            <box label={'Commits'} top={21} border={{ type: 'line' }}>
                <list
                    mouse
                    keys
                    input
                    clickable
                    focused
                    scrollbar={{ ch: '=', track: { fg:'blue', bg: 'grey' } }}
                    items={gitCommits}
                    style={{selected: {bg: 'blue'}}}
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
