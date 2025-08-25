import React, {Component, useEffect, useRef, useState} from 'react';
import {
    ListElement as list,
    BoxElement as box,
    ButtonElement as button,
    TextareaElement as textarea,
    TextElement as text
} from 'react-blessed';
import {Semver} from "./Semver.js";

// comment 
export function SemverControl({initial,onChange,...boxProps}){
    const [semver, setSemver] = useState(Semver.from(initial));
    useEffect(()=>{
        setSemver(Semver.from(initial));
    },[initial])
    const decMajor=()=>{
        const newSemver=semver.prevMajor()
        onChange(newSemver)
        setSemver(newSemver)
    }
    const incMajor=()=>{
        const newSemver=semver.nextMajor()
        onChange(newSemver)
        setSemver(newSemver)
    }
    const decMinor=()=>{
        const newSemver=semver.prevMinor()
        onChange(newSemver)
        setSemver(newSemver)
    }
    const incMinor=()=>{
        const newSemver=semver.nextMinor()
        onChange(newSemver)
        setSemver(newSemver)
    }
    const decPatch=()=>{
        const newSemver=semver.prevPatch()
        onChange(newSemver)
        setSemver(newSemver)
    }
    const incPatch=()=>{
        const newSemver=semver.nextPatch()
        onChange(newSemver)
        setSemver(newSemver)
    }
    return (<box {...boxProps}>
        <box mouse focused clickable onClick={decMajor} height={1}
             left={1}
             width={1}
             content={'v'}/>
        <box mouse focused clickable onClick={incMajor} height={1}
             left={2}
             width={semver.major.length}
             content={semver.major}/>
        <box mouse focused clickable onClick={decMinor} height={1}
             left={2+semver.major.length}
             width={1}
             content={'.'}/>
        <box mouse focused clickable onClick={incMinor} height={1}
             left={3+semver.major.length}
             width={semver.minor.length}
             content={semver.minor}/>
        <box mouse focused clickable onClick={decPatch} height={1}
             left={3+semver.major.length+semver.minor.length}
             width={1}
             content={'.'}/>
        <box mouse focused clickable onClick={incPatch} height={1}
             left={4+semver.major.length+semver.minor.length}
             width={semver.patch.length}
             content={semver.patch}/>
    </box>)
}