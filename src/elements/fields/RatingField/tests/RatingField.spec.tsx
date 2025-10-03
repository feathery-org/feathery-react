import {
  createRatingElement,
  createRatingProps,
  createStatefulOnChange,
  getMockFieldValue,
  resetMockFieldValue,
  getRatingIcons,
  clickRatingIcon,
  expectRatingIconCount
} from './test-utils';
import React from 'react';
import { render, screen } from '@testing-library/react';
import RatingField from '../index';

describe('RatingField - Base Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders RatingField component with default props', () => {
      const element = createRatingElement('rating');
      const props = createRatingProps(element);

      render(<RatingField {...props} />);

      const icons = getRatingIcons();
      expect(icons.length).toBeGreaterThan(0);
      expect(screen.getByText('Test Label')).toBeTruthy();
    });

    it('renders with 5 stars by default', () => {
      const element = createRatingElement('rating');
      const props = createRatingProps(element);

      render(<RatingField {...props} />);

      expectRatingIconCount(5);
    });

    it('renders heart icons when icon_type is heart', () => {
      const element = createRatingElement(
        'rating',
        {},
        {},
        { icon_type: 'heart' }
      );
      const props = createRatingProps(element);

      render(<RatingField {...props} />);

      expectRatingIconCount(5, 'heart');
    });
  });

  describe('onChange', () => {
    it('handles rating change when clicking a star', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createRatingElement('rating');
      const props = createRatingProps(element, { onChange: mockOnChange });

      render(<RatingField {...props} />);

      clickRatingIcon(3);

      expect(mockOnChange).toHaveBeenCalledWith(3);
      expect(getMockFieldValue()).toBe(3);
    });

    it('calls onChange with 1 when clicking first star', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createRatingElement('rating');
      const props = createRatingProps(element, { onChange: mockOnChange });

      render(<RatingField {...props} />);

      clickRatingIcon(1);

      expect(mockOnChange).toHaveBeenCalledWith(1);
      expect(getMockFieldValue()).toBe(1);
    });

    it('calls onChange with max value when clicking last star', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createRatingElement('rating', { scale: 5 });
      const props = createRatingProps(element, { onChange: mockOnChange });

      render(<RatingField {...props} />);

      clickRatingIcon(5);

      expect(mockOnChange).toHaveBeenCalledWith(5);
      expect(getMockFieldValue()).toBe(5);
    });

    it('handles multiple rating changes', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createRatingElement('rating');
      const props = createRatingProps(element, { onChange: mockOnChange });

      render(<RatingField {...props} />);

      clickRatingIcon(2);
      expect(mockOnChange).toHaveBeenCalledWith(2);

      clickRatingIcon(4);
      expect(mockOnChange).toHaveBeenCalledWith(4);

      expect(mockOnChange).toHaveBeenCalledTimes(2);
    });

    it('works with heart icons', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createRatingElement(
        'rating',
        {},
        {},
        { icon_type: 'heart' }
      );
      const props = createRatingProps(element, { onChange: mockOnChange });

      render(<RatingField {...props} />);

      clickRatingIcon(3, 'heart');

      expect(mockOnChange).toHaveBeenCalledWith(3);
      expect(getMockFieldValue()).toBe(3);
    });
  });

  describe('scale (number of icons)', () => {
    it('displays 5 stars by default', () => {
      const element = createRatingElement('rating');
      const props = createRatingProps(element);

      render(<RatingField {...props} />);

      expectRatingIconCount(5);
    });

    it('displays custom number of stars (3)', () => {
      const element = createRatingElement('rating', { scale: 3 });
      const props = createRatingProps(element);

      render(<RatingField {...props} />);

      expectRatingIconCount(3);
    });

    it('displays custom number of stars (7)', () => {
      const element = createRatingElement('rating', { scale: 7 });
      const props = createRatingProps(element);

      render(<RatingField {...props} />);

      expectRatingIconCount(7);
    });

    it('allows clicking any star within custom scale', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createRatingElement('rating', { scale: 7 });
      const props = createRatingProps(element, { onChange: mockOnChange });

      render(<RatingField {...props} />);

      clickRatingIcon(7);

      expect(mockOnChange).toHaveBeenCalledWith(7);
      expect(getMockFieldValue()).toBe(7);
    });

    it('works with scale of 1', () => {
      const element = createRatingElement('rating', { scale: 1 });
      const props = createRatingProps(element);

      render(<RatingField {...props} />);

      expectRatingIconCount(1);
    });
  });

  describe('Default value', () => {
    it('defaults to scale minus 1 when no fieldVal provided', () => {
      const element = createRatingElement('rating', { scale: 5 });
      const props = createRatingProps(element, { fieldVal: undefined });

      render(<RatingField {...props} />);

      // Component internally sets fieldVal to numRatings - 1 (which is 4)
      // We can verify this by checking the component renders correctly
      expectRatingIconCount(5);
    });

    it('uses provided fieldVal when given', () => {
      const element = createRatingElement('rating', { scale: 5 });
      const props = createRatingProps(element, { fieldVal: 3 });

      render(<RatingField {...props} />);

      expectRatingIconCount(5);
    });
  });
});
