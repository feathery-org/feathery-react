import React, { useMemo, useState } from 'react';
import { getNewStepUrl, getStepDepthMap } from '../utils/formHelperFunctions';
import {
  LeftChevronIcon,
  RightChevronIcon
} from '../elements/components/icons';

const lightGrey = 'rgb(235, 239, 242)';

function handleBoth(prevData, nextData, func) {
  return [func(prevData, nextData), func(nextData, prevData)];
}

export default function DevNavBar({ allSteps, curStep, history }) {
  const [activeNav, setActiveNav] = useState('');

  const [prevStepKeys, nextStepKeys] = useMemo(() => {
    const [prevStepKeys, nextStepKeys] = handleBoth(null, null, () => []);
    let [prevCondKeys, nextCondKeys] = handleBoth(
      [curStep.previous_conditions, 'previous_step_key'],
      [curStep.next_conditions, 'next_step_key'],
      ([conditions, attr]) => new Set(conditions.map((cond) => cond[attr]))
    );

    // Sort by branches
    [prevCondKeys, nextCondKeys] = handleBoth(
      [prevCondKeys, prevStepKeys],
      [nextCondKeys, nextStepKeys],
      ([prevCondKeys, prevStepKeys], [nextCondKeys]) =>
        [...prevCondKeys].filter((key) => {
          const bidirectional = nextCondKeys.has(key);
          if (!bidirectional) prevStepKeys.push(key);
          return bidirectional;
        })
    );

    const depthMap = getStepDepthMap(allSteps);
    if (curStep.key in depthMap) {
      // Then sort by step depth
      const curDepth = depthMap[curStep.key];
      [...prevCondKeys, ...nextCondKeys].forEach((key) => {
        const depth = depthMap[key];
        if (depth < curDepth) prevStepKeys.push(key);
        else nextStepKeys.push(key);
      });
    } else {
      // If step is floating, allow forward navigation to go to origin step
      const originStep = Object.values(allSteps).find((step) => step.origin);
      nextStepKeys.push(originStep.key);
    }

    // If step is the first, add floating steps to the previous navigation
    if (curStep.origin) {
      Object.keys(allSteps).map((stepKey) => {
        if (!(stepKey in depthMap)) prevStepKeys.push(stepKey);
      });
    }

    return [prevStepKeys, nextStepKeys];
  }, [curStep.id]);

  const navigate = (stepKey) => {
    setActiveNav('');
    history.push(getNewStepUrl(stepKey));
  };

  const stepSelector = useMemo(() => {
    if (!activeNav) return null;
    const isForward = activeNav === 'forward';
    const stepKeys = isForward ? nextStepKeys : prevStepKeys;
    return (
      <div
        css={{
          position: 'absolute',
          bottom: '-10px',
          width: '200px',
          backgroundColor: 'white',
          boxShadow: '0 4px 14px #00000040',
          borderRadius: '6px',
          ...(isForward ? { left: '300px' } : { right: '300px' })
        }}
      >
        {stepKeys.map((key) => (
          <div
            key={key}
            css={{
              height: '38px',
              borderBottom: `1px solid ${lightGrey}`,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '15px',
              cursor: 'pointer',
              '&:hover': { backgroundColor: lightGrey }
            }}
            onClick={() => navigate(key)}
          >
            {key}
          </div>
        ))}
      </div>
    );
  }, [prevStepKeys, nextStepKeys, activeNav]);

  return (
    <div
      css={{
        position: 'fixed',
        bottom: '30px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '288px',
        height: '56px',
        backgroundColor: 'white',
        borderRadius: '6px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 4px 14px #00000040'
      }}
    >
      <div
        css={navArrowCSS}
        onClick={() => {
          if (prevStepKeys.length === 1) navigate(prevStepKeys[0]);
          else setActiveNav(activeNav === 'back' ? '' : 'back');
        }}
        style={{ visibility: prevStepKeys.length === 0 ? 'hidden' : 'visible' }}
      >
        <LeftChevronIcon />
      </div>
      <span css={{ marginBottom: '4px', userSelect: 'none' }}>
        {curStep.key}
      </span>
      <div
        css={navArrowCSS}
        onClick={() => {
          if (nextStepKeys.length === 1) navigate(nextStepKeys[0]);
          else setActiveNav(activeNav === 'forward' ? '' : 'forward');
        }}
        style={{ visibility: nextStepKeys.length === 0 ? 'hidden' : 'visible' }}
      >
        <RightChevronIcon />
      </div>
      {stepSelector}
    </div>
  );
}

const navArrowCSS = {
  width: '32px',
  height: '32px',
  margin: '8px',
  borderRadius: '6px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  '&:hover': { backgroundColor: lightGrey }
};
