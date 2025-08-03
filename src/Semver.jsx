import React, {Component, useEffect, useRef, useState} from 'react';
import {
    ListElement as list,
    BoxElement as box,
    ButtonElement as button,
    TextareaElement as textarea,
    TextElement as text
} from 'react-blessed';
import {Semver} from "./Semver.js";


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
        <box mouse focused clickable onClick={decMajor} left={1} height={1} width={1}  content={'v'}/>
        <box mouse focused clickable onClick={incMajor} left={2} height={1} width={semver.major.length} content={semver.major}/>
        <box mouse focused clickable onClick={decMinor} left={2+semver.major.length} height={1} width={1}  content={'.'}/>
        <box mouse focused clickable onClick={incMinor} left={3+semver.major.length} height={1} width={semver.minor.length}  content={semver.minor}/>
        <box mouse focused clickable onClick={decPatch} left={3+semver.major.length+semver.minor.length} height={1} width={1} content={'.'}/>
        <box mouse focused clickable onClick={incPatch} left={4+semver.major.length+semver.minor.length} height={1} width={semver.patch.length} content={semver.patch}/>
    </box>)
}