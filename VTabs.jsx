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
    const styleActive={fg:'black',underline:true,bg:'orange'}
    const styleInactive={}

    return (
        <box {...boxProps}>
        <Grid rows={1} cols={6} hideBorder>
            {/* Tab list */}
            <box row={0} col={0} rowSpan={1} colSpan={1}>
                {tabs.map((tab, i) => (
                    <box
                        key={tab.props.name}
                        top={i}
                        mouse
                        clickable
                        bold={activeIndex === i}
                        onClick={() => setActiveIndex(i)}
                        style={activeIndex === i ? styleActive : styleInactive}
                    >
                        {activeIndex === i ? `> ${tab.props.name}` : `  ${tab.props.name}`}
                    </box>
                ))}
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
