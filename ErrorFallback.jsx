import React from 'react'

export function ErrorFallback({ error, resetErrorBoundary }) {
    return (
        <box
            top="center"
            left="center"
            width="75%"
            height="75%"
            border={{ type: 'line' }}
            style={{ fg: 'red' }}
        >
            <button
                right={0} top={0} width={9} height={1}
                mouse
                clickable
                onPress={resetErrorBoundary}
                valign={'middle'}
                align={'center'}
                style={{bg:'#ffaa00',fg:'#333333',hover:{bg:'#ffdd88',fg:'#333333'}}}
                content={'close'}/>
            <box top={2} left={0}>{`Something went wrong:\n${error.message}\n${error.stack}`}</box>
        </box>
    )
}