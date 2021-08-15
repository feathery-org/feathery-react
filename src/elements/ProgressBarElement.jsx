import React from 'react';
import ProgressBar from 'react-bootstrap/ProgressBar';

function ProgressBarElement({ element, curDepth, maxDepth }) {
    const styles = element.applyStyles;

    const percent =
        element.progress || Math.round((100 * curDepth) / (maxDepth + 1));
    const progressBarElements = [
        <ProgressBar
            key='progress'
            style={{
                height: '0.4rem',
                width: '100%',
                borderRadius: 0,
                display: 'flex',
                backgroundColor: '#e9ecef'
            }}
            css={{
                '.progress-bar': {
                    margin: '0 0 0 0 !important',
                    transition: 'width 0.6s ease',
                    ...styles.getTarget('bar')
                }
            }}
            now={percent}
        />
    ];
    const completionPercentage = (
        <div
            key='completionPercentage'
            style={{ width: '100%', textAlign: 'center' }}
        >
            {`${percent}% completed`}
        </div>
    );
    if (element.styles.percent_text_layout === 'top') {
        progressBarElements.splice(0, 0, completionPercentage);
    } else if (element.styles.percent_text_layout === 'bottom') {
        progressBarElements.splice(1, 0, completionPercentage);
    }

    return (
        <div
            key='progress-bar'
            css={{
                display: 'flex',
                flexDirection: 'column',
                ...styles.getLayout(),
                ...styles.getTarget('container')
            }}
        >
            <div
                css={{
                    display: 'flex',
                    flexDirection: 'column',
                    ...styles.getTarget('barContainer')
                }}
            >
                {progressBarElements}
            </div>
        </div>
    );
}

export default ProgressBarElement;
