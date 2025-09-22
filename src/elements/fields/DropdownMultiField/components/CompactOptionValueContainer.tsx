import debounce from 'lodash.debounce';
import throttle from 'lodash.throttle';
import React, {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { flushSync } from 'react-dom';
import {
  components as SelectComponents,
  GroupBase,
  ValueContainerProps
} from 'react-select';

export type CompactOptionValueContainerHandle = {
  resetMoreCount: () => void;
};

const UPDATE_TIME_DELAY = 100;

const CompactOptionValueContainer = forwardRef(
  <Option, IsMulti extends boolean, Group extends GroupBase<Option>>(
    props: ValueContainerProps<Option, IsMulti, Group>,
    ref: React.Ref<CompactOptionValueContainerHandle>
  ) => {
    useImperativeHandle(ref, () => ({
      resetMoreCount() {
        // If moreCount is already greater than or equal to 1 and a new item is added,
        // it is sufficient to simply increment moreCount.
        // However, when an item is removed, items that were previously hidden in the "more items" group may become visible,
        // and since their widths are unknown, the widths of these items must be recalculated.
        // Therefore, the moreCount should be reset when the items are removed,
        // and the ref is exposed in order to handle the above case.
        setMoreCount(0);
      }
    }));

    const ValueContainerWrapper =
      SelectComponents.ValueContainer as unknown as React.ComponentType<
        ValueContainerProps<Option, IsMulti, Group>
      >;

    const valueContainerRef = useRef<HTMLDivElement | null>(null);
    const moreIndicatorRef = useRef<HTMLDivElement | null>(null);

    const [childrenContainer, setChildrenContainer] = useState<React.ReactNode>(
      []
    );

    const [moreCount, setMoreCount] = useState(0);

    const totalItems = props.getValue().length;

    // Calculate the total width of all the option items in order to show the +N more indicator.
    // We should avoid using flushSync and useLayoutEffect whenever possible,
    // but since it is required to calculate the width of the option items and then combine them with the more indicator,
    // it seems there is no alternative in this case.
    // @See: https://react.dev/reference/react-dom/flushSync
    // @See: https://react.dev/reference/react/useLayoutEffect

    const throttleUpdate = useMemo(
      () =>
        throttle(() => {
          const el = valueContainerRef.current;
          if (!el) return;

          const valueContainerWidth = el.clientWidth;
          const moreIndicatorWidth = moreIndicatorRef.current?.offsetWidth || 0;
          const containerWidth = valueContainerWidth - moreIndicatorWidth;

          const optionItems = Array.from(
            el.querySelectorAll('.react-select__multi-value')
          ) as HTMLElement[];

          let curItemWidth = 0;
          let itemTotalWidth = 0;

          for (let i = 0; i < optionItems.length; i++) {
            curItemWidth = optionItems[i]?.offsetWidth || 0;
            itemTotalWidth = (optionItems[i]?.offsetLeft || 0) + curItemWidth;

            if (itemTotalWidth - containerWidth > 0) {
              setMoreCount(totalItems - i);
              return;
            }
          }
        }, UPDATE_TIME_DELAY),
      [totalItems]
    );

    useLayoutEffect(() => {
      if (!valueContainerRef.current) return;

      let prevWidth = Number.MAX_VALUE;

      const debounceResetMoreCount = debounce(() => {
        flushSync(() => setMoreCount(0));
      }, UPDATE_TIME_DELAY);

      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        const { width } = entry.contentRect;

        // We need to reset the more count only when the browser width is increased.
        if (width > prevWidth) {
          debounceResetMoreCount();
        }

        prevWidth = width;

        throttleUpdate();
      });
      resizeObserver.observe(valueContainerRef.current);

      return () => resizeObserver.disconnect();
    }, [valueContainerRef.current, throttleUpdate, moreCount]);

    useLayoutEffect(() => {
      if (totalItems > 0 && Array.isArray(props.children)) {
        // It is required to show the option item array and the input element separately
        // in order to show the +N more indicator,
        // and this indicator will be located between the option items and the input element

        const optionItemContainer = [];
        const inputContainer = [];

        let optionItems = props.children[0];

        if (Array.isArray(optionItems)) {
          optionItems = optionItems.slice(0, totalItems - moreCount);
        }

        optionItemContainer.push(optionItems);

        const moreIndicator = moreCount > 0 && (
          <div
            key={`${props?.selectProps?.inputId}-moreIndicator`}
            ref={moreIndicatorRef}
            style={{
              display: 'flex',
              justifyContent: 'center',
              backgroundColor: '#e6e6e6',
              padding: '3px 6px',
              fontSize: '15px',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            +{moreCount} more
          </div>
        );

        inputContainer.push(props.children[1]);

        setChildrenContainer([
          ...optionItemContainer,
          moreIndicator,
          ...inputContainer
        ]);
      } else {
        // Show all the children (the optional placeholder and input element)
        // if there is no selected item.

        setChildrenContainer(props.children);
      }
    }, [totalItems, moreCount, props.children]);

    return (
      <ValueContainerWrapper
        {...props}
        innerProps={{ ...props.innerProps, ref: valueContainerRef }}
      >
        {childrenContainer}
      </ValueContainerWrapper>
    );
  }
);

export default CompactOptionValueContainer;
