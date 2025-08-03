// components/GitPanel.js
import React, {Component, useEffect, useRef, useState} from 'react';
import {
    ListElement as list,
    TableElement as table,
    BoxElement as box,
    ButtonElement as button,
    TextareaElement as textarea,
    TextElement as text
} from 'react-blessed';
import {Workspace} from "./Workspace";
import {getStatus,getCommits,getBranch,getCurrentTag,getRemotes,getTags,gitStage,gitUnstage,gitCommit,gitTag,gitPush} from "./GitComponent.service";
import ModalDialog from "./ModalDialog";
import {SimpleTextEditorComponent} from "./SimpleTextEditor.jsx";
import {SemverControl} from "./Semver.jsx";
import {safeStringify} from "./util";

export function GitComponent({
        rootDir,
        onFileSelect ,
        ...boxProps
    }) {
    const [message, setMessage] = useState(false);
    const [gitStatus, setGitStatus] = useState([]);
    const [gitCommits, setGitCommits] = useState([]);
    const [gitBranch, setGitBranch] = useState("");
    const [gitCurrentTag, setGitCurrentTag] = useState("");
    const [gitTags, setGitTags] = useState([]);
    const [gitRemotes, setGitRemotes] = useState([]);
    const [commitMessage, setCommitMessage] = useState(null);
    const [mouseCoords, setMouseCoords] = useState({x:0,y:0});

    const sortFilesFn = (a,b) => a.substring(3)>b.substring(3)?1:(a.substring(3)===b.substring(3)?0:-1)
    async function refreshAll() {
        const result = await Promise.all([
            getStatus(rootDir),
            getCommits(rootDir),
            getBranch(rootDir),
            getCurrentTag(rootDir),
            getRemotes(rootDir),
            getTags(rootDir),
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
        setGitTags(result[5])
    }
    useEffect(() => {
        refreshAll()
    }, []);
    const onFilePathSelect = (event) => {
        const staged = event.content.substring(0,1)
        const changed = event.content.substring(1,2)
        const {x,y} = mouseCoords

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
        // setMessage(`mouse @ ${x},${y}`)
    };
    const onCommitSelect = (event) => {
        // setMessage(`commit selected ${event.content} ${process.cwd()}`)
        const tag=event.content.substring(9,18).trim()
        const msg=event.content.substring(19)
        setCommitMessage(msg)

        if(tag.length>=5) {
            setGitCurrentTag(tag)
        }
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
    const tagLastCommit = (event) => {
        gitTag(rootDir, gitCurrentTag).then(result => {
            return refreshAll()
        }).then(result => {
            setMessage(`git tag -m "${gitCurrentTag}"`)
        })
        // setMessage(`commit selected ${event.content} ${process.cwd()}`)
    };
    const pushCommits = (event) => {
        setMessage(`git push "${gitRemotes[0].name}" "${gitBranch}"`)
        gitPush(rootDir, gitRemotes[0].name,gitBranch).then(result => {
            setMessage(`git push "${gitRemotes[0].name}" "${gitBranch}"`)
        })
        setMessage(`commit selected ${event.content} ${process.cwd()}`)
    };
    const commitMessageChanged=(bufferEditor) => {
        setCommitMessage(bufferEditor.buffer)
    }
    const mouseAction=(event) =>{
        const {x,y} = event

        switch(event.action){
            case 'mousemove':break;
            case 'mousedown':break;
            case 'mouseup':break;
            case 'wheelup':editor.moveCursorUp().slideViewportToCursor();setEditor(editor.copy());break;
            case 'wheeldown':editor.moveCursorDown().slideViewportToCursor();setEditor(editor.copy());break;
            default: throw new Error(safeStringify(event)); break;
        }
        setMouseCoords({x,y});
    }
    const status = `{cyan-fg}${(gitRemotes[0]||{}).name}{/cyan-fg}/{red-fg}${gitBranch}{/red-fg}({yellow-fg}${gitCurrentTag}{/yellow-fg})`
    const statusLen=`${(gitRemotes[0]||{}).name}/${gitBranch}(${gitCurrentTag})`.length
    return (
        <box {...boxProps}>
            <box label={``} height={9} border={{ type: 'line' }}>
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
                    onSelectItem={onFilePathSelect}
                    onMouse={mouseAction}
                />
                <box top={-1} left={25} width={7} height={1} content={`{${mouseCoords.x},${mouseCoords.y}}`}/>
            </box>
            <box content={status} top={0} left={3} width={statusLen} height={1} tags={true}/>
            <box content={rootDir} top={8} left={3} width={rootDir.length} height={1}/>
            <SimpleTextEditorComponent
                top={9}  height={9}
                label={'Message'}
                initialText={commitMessage}
                border={{ type: 'line' }}
                onChange={commitMessageChanged}
            />
            <SemverControl
                top={9} left={31} width={9} height={1}
                initial={gitCurrentTag}
                onChange={(s) => {
                    setGitCurrentTag(s.toString())
                }}
            />
            <button
                top={18} left={'0%'} height={3} width={'30%'}
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
                top={18} left={'35%'} height={3} width={'30%'}
                mouse
                keys
                input
                clickable
                focused
                valign={'middle'}
                align={'center'}
                style={{bg:'#ffaa00',fg:'#333333',hover:{bg:'#ffdd88',fg:'#333333'}}}
                onClick={tagLastCommit}
                content={`\ntag ${gitCurrentTag}\n`}
            />
            <button
                top={18} left={'70%'} height={3} width={'30%'}
                mouse
                keys
                input
                clickable
                focused
                valign={'middle'}
                align={'center'}
                style={{bg:'#ffaa00',fg:'#333333',hover:{bg:'#ffdd88',fg:'#333333'}}}
                onClick={pushCommits}
                content={'\npush\n'}
            />
            <box label={'Commits'} top={21} border={{ type: 'line' }} onMouse={(event)=>{
                const {x,y}=event;
                setCommitMessage(safeStringify({x,y}))
            }}>
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
                    onSelectItem={onCommitSelect}
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
