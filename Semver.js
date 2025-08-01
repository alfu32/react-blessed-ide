import {version} from "vite";

export class Semver {
    major = 0
    minor = 0
    patch = 0

    /**
     *
     * @param {string} v
     * @return {Semver}
     */
    static from(v){
        const [major,minor,patch] = v.split('.')
        return new Semver(major,minor,patch)
    }
    constructor(major,minor,patch) {
        this.major = major
        this.minor = minor
        this.patch = patch
    }

    /**
     *
     * @return {Semver}
     */
    nextMajor(){
        return new Semver((parseInt(this.major)+1).toString(), "0","0")
    }
    prevMajor(){
        let v = parseInt(this.major)
        v=v>0?v-1:v
        return new Semver(v.toString(), "0","0")
    }

    /**
     *
     * @return {Semver}
     */
    nextMinor(){
        return new Semver(this.major,(this.minor+1).toString(), "0")
    }
    prevMinor(){
        let v = parseInt(this.minor)
        v=v>0?v-1:v
        return new Semver(this.major,v.toString(), "0")
    }

    /**
     *
     * @return {Semver}
     */
    nextPatch(){
        return new Semver(this.major,this.minor, (parseInt(this.patch)+1).toString())
    }
    prevPatch(){
        let v = parseInt(this.patch)
        v=v>0?v-1:v
        return new Semver(this.major,this.minor, v.toString())
    }


    toString(){
        return `${this.major}.${this.minor}.${this.patch}`
    }
    copy(){
        return new Semver(this.major,this.minor, this.patch)
    }
}