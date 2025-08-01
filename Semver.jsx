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
        <box mouse focused clickable onClick={incMajor} left={2} height={1} width={1} content={semver.major}/>
        <box mouse focused clickable onClick={decMinor} left={3} height={1} width={1}  content={'.'}/>
        <box mouse focused clickable onClick={incMinor} left={4} height={1} width={1}  content={semver.minor}/>
        <box mouse focused clickable onClick={decPatch} left={5} height={1} width={1} content={'.'}/>
        <box mouse focused clickable onClick={incPatch} left={6} height={1} width={1} content={semver.patch}/>
    </box>)
}