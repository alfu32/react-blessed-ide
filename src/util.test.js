import {insertAt} from "./util";

function test_insertAt(){
    const a="012345678901234567890"
    const b="A----B"
    const c=insertAt(a,10,b)
    console.log(c)
    const d=insertAt(a,18,b)
    console.log(d)
}

test_insertAt();