import * as wss from "./services/WorkspaceService.js"



async function test_Workspace(){
    const ws=new wss.Workspace()
    await ws.init(process.cwd())
    let str = ws.flatten()
    console.log(str)
    await ws.rootNode.open(ws.rootDir,ws.ig)
    str = ws.flatten()
    console.log(str)
    ws.rootNode.close()
    str = ws.flatten()
    console.log(str)

}

