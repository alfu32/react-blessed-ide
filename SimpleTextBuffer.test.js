import {SimpleTextBuffer} from "./SimpleTextBuffer.js";

// A tiny helper for deep equality
function assertDeepEqual(actual, expected, name) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    console.assert(a === e, `❌ ${name}\n  expected: ${e}\n       got: ${a}`);
    if (a === e) console.log(`✔️ ${name}`);
}

// 1) renderToLines
function testRenderToLines() {
    const ed = new SimpleTextBuffer();
    ed.buffer = "line1\nline2\nline3\nline4";
    assertDeepEqual(
        ed.renderToLines(1, 2),
        ["line2", "line3"],
        "renderToLines slices correctly"
    );
}

// 2) cursorIndex ↔ coords round-trip
function testCursorIndexCoordsConversion() {
    const ed = new SimpleTextBuffer();
    ed.buffer = "ab\ncde\nf";
    // pick index = 5 (0-based: a b \n c d e => index 5 is 'd')
    const idx = 5;
    const coords = ed.cursorIndexToCoords(idx);
    const idx2 = ed.cursorCoordsToIndex(coords);
    console.assert(idx2 === idx, `❌ round-trip coords ${JSON.stringify(coords)} for index ${idx} ${idx2}`);
    if (idx2 === idx) console.log(`✔️ cursorIndexToCoords ↔ cursorCoordsToIndex`);
}

// 3) basic cursor movements
function testCursorMovement() {
    const ed = new SimpleTextBuffer();
    ed.buffer = "0\n12\n345";
    // start at index of '2' (which is 3)
    ed.cursorIndex = 3;
    const pos1 = ed.cursorIndexToCoords(3)
    const posExpected = { x: 1, y: 2 }
    const indexExpected = ed.cursorCoordsToIndex(posExpected)
    ed.moveCursorDown(); // should go to same x on next line
    console.assert(
        ed.cursorIndex === indexExpected,
        `❌ ${ed.cursorIndex} moveCursorDown from 3 (${JSON.stringify(pos1)} to ${indexExpected} (${JSON.stringify(posExpected)})`
    );
    ed.moveCursorUp();
    console.assert(ed.cursorIndex === 3, `❌ moveCursorUp ${ed.cursorIndex}`);
    ed.moveCursorLeft();
    console.assert(ed.cursorIndex === 2, `❌ moveCursorLeft ${ed.cursorIndex}`);
    ed.moveCursorRight();
    console.assert(ed.cursorIndex === 3, `❌ moveCursorRight ${ed.cursorIndex}`);
    console.log(`✔️ moveCursor{Up,Down,Left,Right}`);
}

// 4) toHome / toEnd
function testHomeEnd() {
    const ed = new SimpleTextBuffer();
    ed.buffer = "first\nsecond\nthird";
    // position somewhere in "second"
    ed.cursorIndex = ed.cursorCoordsToIndex({ x: 3, y: 1 });
    ed.toHome();
    console.assert(
        ed.cursorCoords().x === 0 && ed.cursorCoords().y === 1,
        `❌ toHome`
    );
    ed.toEnd();
    console.assert(
        ed.cursorCoords().x === "second".length - 1 && ed.cursorCoords().y === 1,
        `❌ toEnd`
    );
    console.log(`✔️ toHome & toEnd`);
}

// 5) insert / backspace / delete
function testEditOps() {
    const ed = new SimpleTextBuffer();
    ed.buffer = "ABXC";
    ed.buffer = "ABC";
    ed.cursorIndex = 1; // between A and B
    ed.insert("X");
    console.assert(ed.cursorIndex === 2, `❌ backspace cursorIndex !== '${ed.cursorIndex}"'`);
    console.assert(ed.buffer === "ABXC", `❌ insert 'ABXC' !== '${ed.buffer}"'`);
    ed.backspace();    // removes 'X'
    console.assert(ed.cursorIndex === 1, `❌ backspace cursorIndex !== '${ed.cursorIndex}"'`);
    console.assert(ed.buffer === "ABC", `❌ backspace 'ABC' !== '${ed.buffer}"'`);
    ed.delete();       // deletes 'B'
    console.assert(ed.cursorIndex === 1, `❌ backspace cursorIndex !== '${ed.cursorIndex}"'`);
    console.assert(ed.buffer === "AB", `❌ delete 'AB' !== '${ed.buffer}"'`);
    console.log(`✔️ insert, backspace & delete`);
}

// 6) copy()
function testCopy() {
    const ed = new SimpleTextBuffer();
    ed.buffer = "foo";
    ed.cursorIndex = 2;
    const ed2 = ed.copy();
    // mutate original
    ed.insert("Z");
    console.assert(ed2.buffer === "foo", `❌ copy should freeze buffer`);
    console.assert(ed2.cursorIndex === 2, `❌ copy should freeze cursorIndex`);
    console.log(`✔️ copy creates an independent clone`);
}

// Run all
testRenderToLines();
testCursorIndexCoordsConversion();
testCursorMovement();
testHomeEnd();
testEditOps();
testCopy();
