// components/VTabs.js
import React, { useState } from 'react';
import { BoxElement as box, TextElement as text } from 'react-blessed';
import { Grid,GridItem } from 'react-blessed-contrib-17'

/**
 * <VTabs tabWidth="20%">
 *   <Tab name="Project">…</Tab>
 *   <Tab name="Git">…</Tab>
 * </VTabs>
 */
export function VTabs({ children, ...boxProps}) {
    const tabs = React.Children.toArray(children)
        .filter(child => React.isValidElement(child) && child.props.name);

    const [activeIndex, setActiveIndex] = useState(0);
    const tabSelectorStyle={fg:'#ffaa00',bg:'#333333',hover:{bg:'#ffdd88',fg:'#333333'}}

    return (
        <box {...boxProps}>
        <Grid rows={1} cols={6} hideBorder>
            {/* Tab list */}
            <box row={0} col={0} rowSpan={1} colSpan={1}>
                {tabs.map((tab, i) => {
                    return (
                        <box
                            key={tab.props.name}
                            top={i * 3}
                            height={3}
                            tags={false}
                            mouse
                            clickable
                            onClick={() => setActiveIndex(i)}
                            style={{...tabSelectorStyle, inverse: (activeIndex == i)}}
                            content={'\n '+tab.props.name}
                        />
                    )
                })}
            </box>

            {/* Active tab panel */}
            <box row={0} col={1} rowSpan={1} colSpan={5}>
                {tabs[activeIndex].props.children}
            </box>
        </Grid>
        </box>
    );
}

/**
 * Just a semantic wrapper to carry the `name` prop
 */
export function Tab({ children }) {
    return <>{children}</>;
}
