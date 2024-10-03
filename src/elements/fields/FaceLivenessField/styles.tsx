import React from 'react';
import { Global, css } from '@emotion/react';

export default function FaceLivenessStyles() {
  return (
    <>
      <Global
        styles={css`
          /*
 * Amplify UI Basic Theme
 */
          :root, [data-amplify-theme] {
            --amplify-components-accordion-background-color: var(--amplify-colors-background-primary);
            --amplify-components-accordion-item-border-color: var(--amplify-colors-border-secondary);
            --amplify-components-accordion-item-border-width: var(--amplify-border-widths-small);
            --amplify-components-accordion-item-border-style: solid;
            --amplify-components-accordion-item-border-radius: var(--amplify-radii-small);
            --amplify-components-accordion-item-trigger-align-items: center;
            --amplify-components-accordion-item-trigger-background-color: var(--amplify-colors-background-primary);
            --amplify-components-accordion-item-trigger-color: inherit;
            --amplify-components-accordion-item-trigger-gap: var(--amplify-space-small);
            --amplify-components-accordion-item-trigger-justify-content: space-between;
            --amplify-components-accordion-item-trigger-padding-block: var(--amplify-space-xs);
            --amplify-components-accordion-item-trigger-padding-inline: var(--amplify-space-small);
            --amplify-components-accordion-item-trigger-hover-color: inherit;
            --amplify-components-accordion-item-trigger-hover-background-color: var(--amplify-colors-overlay-5);
            --amplify-components-accordion-item-trigger-focus-border-color: var(--amplify-colors-border-focus);
            --amplify-components-accordion-item-trigger-focus-box-shadow: 0 0 0 2px var(--amplify-colors-border-focus);
            --amplify-components-accordion-item-content-color: inherit;
            --amplify-components-accordion-item-content-padding-inline: var(--amplify-space-small);
            --amplify-components-accordion-item-content-padding-block-end: var(--amplify-space-small);
            --amplify-components-accordion-item-content-padding-block-start: var(--amplify-space-xxxs);
            --amplify-components-accordion-item-icon-color: var(--amplify-colors-font-tertiary);
            --amplify-components-accordion-item-icon-transition-duration: var(--amplify-time-medium);
            --amplify-components-accordion-item-icon-transition-timing-function: cubic-bezier(0.87, 0, 0.13, 1);
            --amplify-components-alert-align-items: center;
            --amplify-components-alert-justify-content: space-between;
            --amplify-components-alert-color: var(--amplify-colors-font-primary);
            --amplify-components-alert-background-color: var(--amplify-colors-background-tertiary);
            --amplify-components-alert-padding-block: var(--amplify-space-small);
            --amplify-components-alert-padding-inline: var(--amplify-space-medium);
            --amplify-components-alert-icon-size: var(--amplify-font-sizes-xl);
            --amplify-components-alert-heading-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-alert-heading-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-alert-info-color: var(--amplify-colors-font-info);
            --amplify-components-alert-info-background-color: var(--amplify-colors-background-info);
            --amplify-components-alert-error-color: var(--amplify-colors-font-error);
            --amplify-components-alert-error-background-color: var(--amplify-colors-background-error);
            --amplify-components-alert-warning-color: var(--amplify-colors-font-warning);
            --amplify-components-alert-warning-background-color: var(--amplify-colors-background-warning);
            --amplify-components-alert-success-color: var(--amplify-colors-font-success);
            --amplify-components-alert-success-background-color: var(--amplify-colors-background-success);
            --amplify-components-authenticator-max-width: 60rem;
            --amplify-components-authenticator-modal-width: var(--amplify-space-relative-full);
            --amplify-components-authenticator-modal-height: var(--amplify-space-relative-full);
            --amplify-components-authenticator-modal-background-color: var(--amplify-colors-overlay-50);
            --amplify-components-authenticator-modal-top: var(--amplify-space-zero);
            --amplify-components-authenticator-modal-left: var(--amplify-space-zero);
            --amplify-components-authenticator-container-width-max: 30rem;
            --amplify-components-authenticator-router-border-width: var(--amplify-border-widths-small);
            --amplify-components-authenticator-router-border-style: solid;
            --amplify-components-authenticator-router-border-color: var(--amplify-colors-border-primary);
            --amplify-components-authenticator-router-background-color: var(--amplify-colors-background-primary);
            --amplify-components-authenticator-router-box-shadow: var(--amplify-shadows-medium);
            --amplify-components-authenticator-footer-padding-bottom: var(--amplify-space-medium);
            --amplify-components-authenticator-form-padding: var(--amplify-space-xl);
            --amplify-components-authenticator-state-inactive-background-color: var(--amplify-colors-background-secondary);
            --amplify-components-authenticator-or-container-color: var(--amplify-colors-neutral-80);
            --amplify-components-authenticator-or-container-or-line-background-color: var(--amplify-colors-background-primary);
            --amplify-components-autocomplete-menu-width: 100%;
            --amplify-components-autocomplete-menu-margin-block-start: var(--amplify-space-xxxs);
            --amplify-components-autocomplete-menu-background-color: var(--amplify-colors-background-primary);
            --amplify-components-autocomplete-menu-border-color: var(--amplify-colors-border-primary);
            --amplify-components-autocomplete-menu-border-width: var(--amplify-border-widths-small);
            --amplify-components-autocomplete-menu-border-style: solid;
            --amplify-components-autocomplete-menu-border-radius: var(--amplify-radii-small);
            --amplify-components-autocomplete-menu-options-display: flex;
            --amplify-components-autocomplete-menu-options-flex-direction: column;
            --amplify-components-autocomplete-menu-options-max-height: 300px;
            --amplify-components-autocomplete-menu-option-background-color: var(--amplify-colors-background-primary);
            --amplify-components-autocomplete-menu-option-color: currentcolor;
            --amplify-components-autocomplete-menu-option-cursor: pointer;
            --amplify-components-autocomplete-menu-option-transition-duration: var(--amplify-time-short);
            --amplify-components-autocomplete-menu-option-transition-property: background-color, color;
            --amplify-components-autocomplete-menu-option-transition-timing-function: ease;
            --amplify-components-autocomplete-menu-option-active-background-color: var(--amplify-colors-primary-80);
            --amplify-components-autocomplete-menu-option-active-color: var(--amplify-colors-white);
            --amplify-components-autocomplete-menu-empty-display: flex;
            --amplify-components-autocomplete-menu-loading-align-items: center;
            --amplify-components-autocomplete-menu-loading-display: flex;
            --amplify-components-autocomplete-menu-loading-gap: var(--amplify-space-xxxs);
            --amplify-components-autocomplete-menu-space-shared-padding-block: var(--amplify-space-xs);
            --amplify-components-autocomplete-menu-space-shared-padding-inline: var(--amplify-space-small);
            --amplify-components-avatar-color: var(--amplify-colors-font-tertiary);
            --amplify-components-avatar-line-height: 1;
            --amplify-components-avatar-font-weight: var(--amplify-font-weights-semibold);
            --amplify-components-avatar-font-size: var(--amplify-font-sizes-small);
            --amplify-components-avatar-text-align: center;
            --amplify-components-avatar-width: var(--amplify-font-sizes-xxl);
            --amplify-components-avatar-height: var(--amplify-font-sizes-xxl);
            --amplify-components-avatar-background-color: var(--amplify-colors-background-tertiary);
            --amplify-components-avatar-border-radius: 100%;
            --amplify-components-avatar-border-color: var(--amplify-colors-border-primary);
            --amplify-components-avatar-border-width: var(--amplify-border-widths-medium);
            --amplify-components-avatar-info-color: var(--amplify-colors-font-info);
            --amplify-components-avatar-info-background-color: var(--amplify-colors-background-info);
            --amplify-components-avatar-info-border-color: var(--amplify-colors-border-info);
            --amplify-components-avatar-warning-color: var(--amplify-colors-font-warning);
            --amplify-components-avatar-warning-background-color: var(--amplify-colors-background-warning);
            --amplify-components-avatar-warning-border-color: var(--amplify-colors-border-warning);
            --amplify-components-avatar-success-color: var(--amplify-colors-font-success);
            --amplify-components-avatar-success-background-color: var(--amplify-colors-background-success);
            --amplify-components-avatar-success-border-color: var(--amplify-colors-border-success);
            --amplify-components-avatar-error-color: var(--amplify-colors-font-error);
            --amplify-components-avatar-error-background-color: var(--amplify-colors-background-error);
            --amplify-components-avatar-error-border-color: var(--amplify-colors-border-error);
            --amplify-components-avatar-small-font-size: var(--amplify-font-sizes-xs);
            --amplify-components-avatar-small-width: var(--amplify-font-sizes-xl);
            --amplify-components-avatar-small-height: var(--amplify-font-sizes-xl);
            --amplify-components-avatar-large-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-avatar-large-width: var(--amplify-font-sizes-xxxl);
            --amplify-components-avatar-large-height: var(--amplify-font-sizes-xxxl);
            --amplify-components-badge-color: var(--amplify-colors-font-primary);
            --amplify-components-badge-line-height: 1;
            --amplify-components-badge-font-weight: var(--amplify-font-weights-semibold);
            --amplify-components-badge-font-size: var(--amplify-font-sizes-small);
            --amplify-components-badge-text-align: center;
            --amplify-components-badge-padding-vertical: var(--amplify-space-xs);
            --amplify-components-badge-padding-horizontal: var(--amplify-space-small);
            --amplify-components-badge-background-color: var(--amplify-colors-background-tertiary);
            --amplify-components-badge-border-radius: var(--amplify-radii-xl);
            --amplify-components-badge-info-color: var(--amplify-colors-font-info);
            --amplify-components-badge-info-background-color: var(--amplify-colors-background-info);
            --amplify-components-badge-warning-color: var(--amplify-colors-font-warning);
            --amplify-components-badge-warning-background-color: var(--amplify-colors-background-warning);
            --amplify-components-badge-success-color: var(--amplify-colors-font-success);
            --amplify-components-badge-success-background-color: var(--amplify-colors-background-success);
            --amplify-components-badge-error-color: var(--amplify-colors-font-error);
            --amplify-components-badge-error-background-color: var(--amplify-colors-background-error);
            --amplify-components-badge-small-font-size: var(--amplify-font-sizes-xs);
            --amplify-components-badge-small-padding-vertical: var(--amplify-space-xxs);
            --amplify-components-badge-small-padding-horizontal: var(--amplify-space-xs);
            --amplify-components-badge-large-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-badge-large-padding-vertical: var(--amplify-space-small);
            --amplify-components-badge-large-padding-horizontal: var(--amplify-space-medium);
            --amplify-components-breadcrumbs-flex-direction: row;
            --amplify-components-breadcrumbs-flex-wrap: wrap;
            --amplify-components-breadcrumbs-gap: 0;
            --amplify-components-breadcrumbs-color: var(--amplify-colors-font-tertiary);
            --amplify-components-breadcrumbs-item-flex-direction: row;
            --amplify-components-breadcrumbs-item-color: inherit;
            --amplify-components-breadcrumbs-item-font-size: inherit;
            --amplify-components-breadcrumbs-item-align-items: center;
            --amplify-components-breadcrumbs-item-line-height: 1;
            --amplify-components-breadcrumbs-separator-color: inherit;
            --amplify-components-breadcrumbs-separator-font-size: inherit;
            --amplify-components-breadcrumbs-separator-padding-inline: var(--amplify-space-xxs);
            --amplify-components-breadcrumbs-link-color: var(--amplify-components-link-color);
            --amplify-components-breadcrumbs-link-font-size: inherit;
            --amplify-components-breadcrumbs-link-font-weight: normal;
            --amplify-components-breadcrumbs-link-text-decoration: none;
            --amplify-components-breadcrumbs-link-padding-inline: var(--amplify-space-xs);
            --amplify-components-breadcrumbs-link-padding-block: var(--amplify-space-xxs);
            --amplify-components-breadcrumbs-link-current-color: inherit;
            --amplify-components-breadcrumbs-link-current-font-size: inherit;
            --amplify-components-breadcrumbs-link-current-font-weight: normal;
            --amplify-components-breadcrumbs-link-current-text-decoration: none;
            --amplify-components-button-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-button-transition-duration: var(--amplify-components-fieldcontrol-transition-duration);
            --amplify-components-button-font-size: var(--amplify-components-fieldcontrol-font-size);
            --amplify-components-button-line-height: var(--amplify-components-fieldcontrol-line-height);
            --amplify-components-button-padding-block-start: var(--amplify-components-fieldcontrol-padding-block-start);
            --amplify-components-button-padding-block-end: var(--amplify-components-fieldcontrol-padding-block-end);
            --amplify-components-button-padding-inline-start: var(--amplify-components-fieldcontrol-padding-inline-start);
            --amplify-components-button-padding-inline-end: var(--amplify-components-fieldcontrol-padding-inline-end);
            --amplify-components-button-background-color: transparent;
            --amplify-components-button-border-color: var(--amplify-components-fieldcontrol-border-color);
            --amplify-components-button-border-width: var(--amplify-components-fieldcontrol-border-width);
            --amplify-components-button-border-style: var(--amplify-components-fieldcontrol-border-style);
            --amplify-components-button-border-radius: var(--amplify-components-fieldcontrol-border-radius);
            --amplify-components-button-color: var(--amplify-colors-font-primary);
            --amplify-components-button-hover-color: var(--amplify-colors-font-focus);
            --amplify-components-button-hover-background-color: var(--amplify-colors-primary-10);
            --amplify-components-button-hover-border-color: var(--amplify-colors-primary-60);
            --amplify-components-button-focus-color: var(--amplify-colors-font-focus);
            --amplify-components-button-focus-background-color: var(--amplify-colors-primary-10);
            --amplify-components-button-focus-border-color: var(--amplify-colors-border-focus);
            --amplify-components-button-focus-box-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
            --amplify-components-button-active-color: var(--amplify-colors-font-active);
            --amplify-components-button-active-background-color: var(--amplify-colors-primary-20);
            --amplify-components-button-active-border-color: var(--amplify-colors-primary-100);
            --amplify-components-button-loading-color: var(--amplify-colors-font-disabled);
            --amplify-components-button-loading-background-color: transparent;
            --amplify-components-button-loading-border-color: var(--amplify-colors-border-tertiary);
            --amplify-components-button-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-button-disabled-background-color: transparent;
            --amplify-components-button-disabled-border-color: var(--amplify-colors-border-tertiary);
            --amplify-components-button-outlined-info-border-color: var(--amplify-colors-blue-60);
            --amplify-components-button-outlined-info-background-color: transparent;
            --amplify-components-button-outlined-info-color: var(--amplify-colors-blue-100);
            --amplify-components-button-outlined-info-hover-border-color: var(--amplify-colors-blue-60);
            --amplify-components-button-outlined-info-hover-background-color: var(--amplify-colors-blue-10);
            --amplify-components-button-outlined-info-hover-color: var(--amplify-colors-blue-100);
            --amplify-components-button-outlined-info-focus-border-color: var(--amplify-colors-blue-100);
            --amplify-components-button-outlined-info-focus-background-color: var(--amplify-colors-blue-10);
            --amplify-components-button-outlined-info-focus-color: var(--amplify-colors-blue-100);
            --amplify-components-button-outlined-info-focus-box-shadow: var(--amplify-components-fieldcontrol-info-focus-box-shadow);
            --amplify-components-button-outlined-info-active-border-color: var(--amplify-colors-blue-100);
            --amplify-components-button-outlined-info-active-background-color: var(--amplify-colors-blue-20);
            --amplify-components-button-outlined-info-active-color: var(--amplify-colors-blue-100);
            --amplify-components-button-outlined-warning-border-color: var(--amplify-colors-orange-60);
            --amplify-components-button-outlined-warning-background-color: transparent;
            --amplify-components-button-outlined-warning-color: var(--amplify-colors-orange-100);
            --amplify-components-button-outlined-warning-hover-border-color: var(--amplify-colors-orange-60);
            --amplify-components-button-outlined-warning-hover-background-color: var(--amplify-colors-orange-10);
            --amplify-components-button-outlined-warning-hover-color: var(--amplify-colors-orange-100);
            --amplify-components-button-outlined-warning-focus-border-color: var(--amplify-colors-orange-100);
            --amplify-components-button-outlined-warning-focus-background-color: var(--amplify-colors-orange-10);
            --amplify-components-button-outlined-warning-focus-color: var(--amplify-colors-orange-100);
            --amplify-components-button-outlined-warning-focus-box-shadow: var(--amplify-components-fieldcontrol-warning-focus-box-shadow);
            --amplify-components-button-outlined-warning-active-border-color: var(--amplify-colors-orange-100);
            --amplify-components-button-outlined-warning-active-background-color: var(--amplify-colors-orange-20);
            --amplify-components-button-outlined-warning-active-color: var(--amplify-colors-orange-100);
            --amplify-components-button-outlined-success-border-color: var(--amplify-colors-green-60);
            --amplify-components-button-outlined-success-background-color: transparent;
            --amplify-components-button-outlined-success-color: var(--amplify-colors-green-100);
            --amplify-components-button-outlined-success-hover-border-color: var(--amplify-colors-green-60);
            --amplify-components-button-outlined-success-hover-background-color: var(--amplify-colors-green-10);
            --amplify-components-button-outlined-success-hover-color: var(--amplify-colors-green-100);
            --amplify-components-button-outlined-success-focus-border-color: var(--amplify-colors-green-100);
            --amplify-components-button-outlined-success-focus-background-color: var(--amplify-colors-green-10);
            --amplify-components-button-outlined-success-focus-color: var(--amplify-colors-green-100);
            --amplify-components-button-outlined-success-focus-box-shadow: var(--amplify-components-fieldcontrol-success-focus-box-shadow);
            --amplify-components-button-outlined-success-active-border-color: var(--amplify-colors-green-100);
            --amplify-components-button-outlined-success-active-background-color: var(--amplify-colors-green-20);
            --amplify-components-button-outlined-success-active-color: var(--amplify-colors-green-100);
            --amplify-components-button-outlined-error-border-color: var(--amplify-colors-red-80);
            --amplify-components-button-outlined-error-background-color: transparent;
            --amplify-components-button-outlined-error-color: var(--amplify-colors-red-100);
            --amplify-components-button-outlined-error-hover-border-color: var(--amplify-colors-red-80);
            --amplify-components-button-outlined-error-hover-background-color: var(--amplify-colors-red-10);
            --amplify-components-button-outlined-error-hover-color: var(--amplify-colors-red-100);
            --amplify-components-button-outlined-error-focus-border-color: var(--amplify-colors-red-100);
            --amplify-components-button-outlined-error-focus-background-color: var(--amplify-colors-red-10);
            --amplify-components-button-outlined-error-focus-color: var(--amplify-colors-red-100);
            --amplify-components-button-outlined-error-focus-box-shadow: var(--amplify-components-fieldcontrol-error-focus-box-shadow);
            --amplify-components-button-outlined-error-active-border-color: var(--amplify-colors-red-100);
            --amplify-components-button-outlined-error-active-background-color: var(--amplify-colors-red-20);
            --amplify-components-button-outlined-error-active-color: var(--amplify-colors-red-100);
            --amplify-components-button-outlined-overlay-border-color: var(--amplify-colors-overlay-60);
            --amplify-components-button-outlined-overlay-background-color: transparent;
            --amplify-components-button-outlined-overlay-color: var(--amplify-colors-font-primary);
            --amplify-components-button-outlined-overlay-hover-border-color: var(--amplify-colors-overlay-60);
            --amplify-components-button-outlined-overlay-hover-background-color: var(--amplify-colors-overlay-5);
            --amplify-components-button-outlined-overlay-hover-color: var(--amplify-colors-neutral-90);
            --amplify-components-button-outlined-overlay-focus-border-color: var(--amplify-colors-overlay-90);
            --amplify-components-button-outlined-overlay-focus-background-color: var(--amplify-colors-overlay-5);
            --amplify-components-button-outlined-overlay-focus-color: var(--amplify-colors-neutral-90);
            --amplify-components-button-outlined-overlay-focus-box-shadow: var(--amplify-components-fieldcontrol-overlay-focus-box-shadow);
            --amplify-components-button-outlined-overlay-active-border-color: var(--amplify-colors-overlay-90);
            --amplify-components-button-outlined-overlay-active-background-color: var(--amplify-colors-overlay-10);
            --amplify-components-button-outlined-overlay-active-color: var(--amplify-colors-neutral-100);
            --amplify-components-button-primary-border-color: transparent;
            --amplify-components-button-primary-border-width: var(--amplify-border-widths-small);
            --amplify-components-button-primary-border-style: solid;
            --amplify-components-button-primary-background-color: var(--amplify-colors-primary-80);
            --amplify-components-button-primary-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-disabled-border-color: transparent;
            --amplify-components-button-primary-disabled-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-button-primary-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-button-primary-loading-border-color: transparent;
            --amplify-components-button-primary-loading-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-button-primary-loading-color: var(--amplify-colors-font-disabled);
            --amplify-components-button-primary-hover-border-color: transparent;
            --amplify-components-button-primary-hover-background-color: var(--amplify-colors-primary-90);
            --amplify-components-button-primary-hover-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-focus-border-color: transparent;
            --amplify-components-button-primary-focus-background-color: var(--amplify-colors-primary-90);
            --amplify-components-button-primary-focus-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-focus-box-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
            --amplify-components-button-primary-active-border-color: transparent;
            --amplify-components-button-primary-active-background-color: var(--amplify-colors-primary-100);
            --amplify-components-button-primary-active-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-info-border-color: transparent;
            --amplify-components-button-primary-info-background-color: var(--amplify-colors-blue-80);
            --amplify-components-button-primary-info-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-info-hover-border-color: transparent;
            --amplify-components-button-primary-info-hover-background-color: var(--amplify-colors-blue-90);
            --amplify-components-button-primary-info-hover-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-info-focus-border-color: transparent;
            --amplify-components-button-primary-info-focus-background-color: var(--amplify-colors-blue-90);
            --amplify-components-button-primary-info-focus-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-info-focus-box-shadow: var(--amplify-components-fieldcontrol-info-focus-box-shadow);
            --amplify-components-button-primary-info-active-border-color: transparent;
            --amplify-components-button-primary-info-active-background-color: var(--amplify-colors-blue-100);
            --amplify-components-button-primary-info-active-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-warning-border-color: transparent;
            --amplify-components-button-primary-warning-background-color: var(--amplify-colors-orange-80);
            --amplify-components-button-primary-warning-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-warning-hover-border-color: transparent;
            --amplify-components-button-primary-warning-hover-background-color: var(--amplify-colors-orange-90);
            --amplify-components-button-primary-warning-hover-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-warning-focus-border-color: transparent;
            --amplify-components-button-primary-warning-focus-background-color: var(--amplify-colors-orange-90);
            --amplify-components-button-primary-warning-focus-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-warning-focus-box-shadow: var(--amplify-components-fieldcontrol-overlay-focus-box-shadow);
            --amplify-components-button-primary-warning-active-border-color: transparent;
            --amplify-components-button-primary-warning-active-background-color: var(--amplify-colors-orange-100);
            --amplify-components-button-primary-warning-active-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-error-border-color: transparent;
            --amplify-components-button-primary-error-background-color: var(--amplify-colors-red-80);
            --amplify-components-button-primary-error-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-error-hover-border-color: transparent;
            --amplify-components-button-primary-error-hover-background-color: var(--amplify-colors-red-90);
            --amplify-components-button-primary-error-hover-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-error-focus-border-color: transparent;
            --amplify-components-button-primary-error-focus-background-color: var(--amplify-colors-red-90);
            --amplify-components-button-primary-error-focus-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-error-focus-box-shadow: var(--amplify-components-fieldcontrol-error-focus-box-shadow);
            --amplify-components-button-primary-error-active-border-color: transparent;
            --amplify-components-button-primary-error-active-background-color: var(--amplify-colors-red-100);
            --amplify-components-button-primary-error-active-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-success-border-color: transparent;
            --amplify-components-button-primary-success-background-color: var(--amplify-colors-green-80);
            --amplify-components-button-primary-success-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-success-hover-border-color: transparent;
            --amplify-components-button-primary-success-hover-background-color: var(--amplify-colors-green-90);
            --amplify-components-button-primary-success-hover-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-success-focus-border-color: transparent;
            --amplify-components-button-primary-success-focus-background-color: var(--amplify-colors-green-90);
            --amplify-components-button-primary-success-focus-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-success-focus-box-shadow: var(--amplify-components-fieldcontrol-success-focus-box-shadow);
            --amplify-components-button-primary-success-active-border-color: transparent;
            --amplify-components-button-primary-success-active-background-color: var(--amplify-colors-green-100);
            --amplify-components-button-primary-success-active-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-overlay-border-color: transparent;
            --amplify-components-button-primary-overlay-background-color: var(--amplify-colors-overlay-70);
            --amplify-components-button-primary-overlay-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-overlay-hover-border-color: transparent;
            --amplify-components-button-primary-overlay-hover-background-color: var(--amplify-colors-overlay-90);
            --amplify-components-button-primary-overlay-hover-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-overlay-focus-border-color: transparent;
            --amplify-components-button-primary-overlay-focus-background-color: var(--amplify-colors-overlay-90);
            --amplify-components-button-primary-overlay-focus-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-primary-overlay-focus-box-shadow: var(--amplify-components-fieldcontrol-overlay-focus-box-shadow);
            --amplify-components-button-primary-overlay-active-border-color: transparent;
            --amplify-components-button-primary-overlay-active-background-color: var(--amplify-colors-overlay-90);
            --amplify-components-button-primary-overlay-active-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-menu-border-width: var(--amplify-space-zero);
            --amplify-components-button-menu-background-color: transparent;
            --amplify-components-button-menu-justify-content: start;
            --amplify-components-button-menu-hover-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-menu-hover-background-color: var(--amplify-colors-primary-80);
            --amplify-components-button-menu-focus-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-menu-focus-background-color: var(--amplify-colors-primary-80);
            --amplify-components-button-menu-active-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-menu-active-background-color: var(--amplify-colors-primary-90);
            --amplify-components-button-menu-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-button-link-background-color: transparent;
            --amplify-components-button-link-border-color: transparent;
            --amplify-components-button-link-border-width: var(--amplify-border-widths-small);
            --amplify-components-button-link-color: var(--amplify-colors-font-interactive);
            --amplify-components-button-link-hover-border-color: transparent;
            --amplify-components-button-link-hover-background-color: var(--amplify-colors-primary-10);
            --amplify-components-button-link-hover-color: var(--amplify-colors-font-hover);
            --amplify-components-button-link-focus-border-color: transparent;
            --amplify-components-button-link-focus-background-color: var(--amplify-colors-primary-10);
            --amplify-components-button-link-focus-color: var(--amplify-colors-font-focus);
            --amplify-components-button-link-focus-box-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
            --amplify-components-button-link-active-border-color: transparent;
            --amplify-components-button-link-active-background-color: var(--amplify-colors-primary-20);
            --amplify-components-button-link-active-color: var(--amplify-colors-font-active);
            --amplify-components-button-link-disabled-border-color: transparent;
            --amplify-components-button-link-disabled-background-color: transparent;
            --amplify-components-button-link-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-button-link-loading-border-color: transparent;
            --amplify-components-button-link-loading-background-color: transparent;
            --amplify-components-button-link-loading-color: var(--amplify-colors-font-disabled);
            --amplify-components-button-link-info-border-color: transparent;
            --amplify-components-button-link-info-background-color: transparent;
            --amplify-components-button-link-info-color: var(--amplify-colors-blue-100);
            --amplify-components-button-link-info-hover-border-color: transparent;
            --amplify-components-button-link-info-hover-background-color: var(--amplify-colors-blue-10);
            --amplify-components-button-link-info-hover-color: var(--amplify-colors-blue-90);
            --amplify-components-button-link-info-focus-border-color: transparent;
            --amplify-components-button-link-info-focus-background-color: var(--amplify-colors-blue-10);
            --amplify-components-button-link-info-focus-color: var(--amplify-colors-blue-100);
            --amplify-components-button-link-info-focus-box-shadow: var(--amplify-components-fieldcontrol-info-focus-box-shadow);
            --amplify-components-button-link-info-active-border-color: transparent;
            --amplify-components-button-link-info-active-background-color: var(--amplify-colors-blue-20);
            --amplify-components-button-link-info-active-color: var(--amplify-colors-blue-100);
            --amplify-components-button-link-warning-border-color: transparent;
            --amplify-components-button-link-warning-background-color: transparent;
            --amplify-components-button-link-warning-color: var(--amplify-colors-orange-100);
            --amplify-components-button-link-warning-hover-border-color: transparent;
            --amplify-components-button-link-warning-hover-background-color: var(--amplify-colors-orange-10);
            --amplify-components-button-link-warning-hover-color: var(--amplify-colors-orange-90);
            --amplify-components-button-link-warning-focus-border-color: transparent;
            --amplify-components-button-link-warning-focus-background-color: var(--amplify-colors-orange-10);
            --amplify-components-button-link-warning-focus-color: var(--amplify-colors-orange-100);
            --amplify-components-button-link-warning-focus-box-shadow: var(--amplify-components-fieldcontrol-warning-focus-box-shadow);
            --amplify-components-button-link-warning-active-border-color: transparent;
            --amplify-components-button-link-warning-active-background-color: var(--amplify-colors-orange-20);
            --amplify-components-button-link-warning-active-color: var(--amplify-colors-orange-100);
            --amplify-components-button-link-success-border-color: transparent;
            --amplify-components-button-link-success-background-color: transparent;
            --amplify-components-button-link-success-color: var(--amplify-colors-green-100);
            --amplify-components-button-link-success-hover-border-color: transparent;
            --amplify-components-button-link-success-hover-background-color: var(--amplify-colors-green-10);
            --amplify-components-button-link-success-hover-color: var(--amplify-colors-green-90);
            --amplify-components-button-link-success-focus-border-color: transparent;
            --amplify-components-button-link-success-focus-background-color: var(--amplify-colors-green-10);
            --amplify-components-button-link-success-focus-color: var(--amplify-colors-green-100);
            --amplify-components-button-link-success-focus-box-shadow: var(--amplify-components-fieldcontrol-success-focus-box-shadow);
            --amplify-components-button-link-success-active-border-color: transparent;
            --amplify-components-button-link-success-active-background-color: var(--amplify-colors-green-20);
            --amplify-components-button-link-success-active-color: var(--amplify-colors-green-100);
            --amplify-components-button-link-error-border-color: transparent;
            --amplify-components-button-link-error-background-color: transparent;
            --amplify-components-button-link-error-color: var(--amplify-colors-red-100);
            --amplify-components-button-link-error-hover-border-color: transparent;
            --amplify-components-button-link-error-hover-background-color: var(--amplify-colors-red-10);
            --amplify-components-button-link-error-hover-color: var(--amplify-colors-red-90);
            --amplify-components-button-link-error-focus-border-color: transparent;
            --amplify-components-button-link-error-focus-background-color: var(--amplify-colors-red-10);
            --amplify-components-button-link-error-focus-color: var(--amplify-colors-red-100);
            --amplify-components-button-link-error-focus-box-shadow: var(--amplify-components-fieldcontrol-error-focus-box-shadow);
            --amplify-components-button-link-error-active-border-color: transparent;
            --amplify-components-button-link-error-active-background-color: var(--amplify-colors-red-20);
            --amplify-components-button-link-error-active-color: var(--amplify-colors-red-100);
            --amplify-components-button-link-overlay-border-color: transparent;
            --amplify-components-button-link-overlay-background-color: transparent;
            --amplify-components-button-link-overlay-color: var(--amplify-colors-neutral-100);
            --amplify-components-button-link-overlay-hover-border-color: transparent;
            --amplify-components-button-link-overlay-hover-background-color: var(--amplify-colors-overlay-5);
            --amplify-components-button-link-overlay-hover-color: var(--amplify-colors-overlay-80);
            --amplify-components-button-link-overlay-focus-border-color: transparent;
            --amplify-components-button-link-overlay-focus-background-color: var(--amplify-colors-overlay-5);
            --amplify-components-button-link-overlay-focus-color: var(--amplify-colors-overlay-90);
            --amplify-components-button-link-overlay-focus-box-shadow: var(--amplify-components-fieldcontrol-overlay-focus-box-shadow);
            --amplify-components-button-link-overlay-active-border-color: transparent;
            --amplify-components-button-link-overlay-active-background-color: var(--amplify-colors-overlay-10);
            --amplify-components-button-link-overlay-active-color: var(--amplify-colors-overlay-90);
            --amplify-components-button-warning-background-color: transparent;
            --amplify-components-button-warning-border-color: var(--amplify-colors-red-60);
            --amplify-components-button-warning-border-width: var(--amplify-border-widths-small);
            --amplify-components-button-warning-color: var(--amplify-colors-red-60);
            --amplify-components-button-warning-hover-border-color: var(--amplify-colors-red-80);
            --amplify-components-button-warning-hover-background-color: var(--amplify-colors-red-10);
            --amplify-components-button-warning-hover-color: var(--amplify-colors-font-error);
            --amplify-components-button-warning-focus-border-color: var(--amplify-colors-red-80);
            --amplify-components-button-warning-focus-background-color: var(--amplify-colors-red-10);
            --amplify-components-button-warning-focus-color: var(--amplify-colors-red-80);
            --amplify-components-button-warning-focus-box-shadow: var(--amplify-components-fieldcontrol-error-focus-box-shadow);
            --amplify-components-button-warning-active-border-color: var(--amplify-colors-red-100);
            --amplify-components-button-warning-active-background-color: var(--amplify-colors-red-20);
            --amplify-components-button-warning-active-color: var(--amplify-colors-red-100);
            --amplify-components-button-warning-disabled-border-color: var(--amplify-colors-border-tertiary);
            --amplify-components-button-warning-disabled-background-color: transparent;
            --amplify-components-button-warning-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-button-warning-loading-border-color: var(--amplify-colors-border-tertiary);
            --amplify-components-button-warning-loading-background-color: transparent;
            --amplify-components-button-warning-loading-color: var(--amplify-colors-font-disabled);
            --amplify-components-button-destructive-border-color: transparent;
            --amplify-components-button-destructive-border-width: var(--amplify-border-widths-small);
            --amplify-components-button-destructive-border-style: solid;
            --amplify-components-button-destructive-background-color: var(--amplify-colors-red-60);
            --amplify-components-button-destructive-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-destructive-disabled-border-color: transparent;
            --amplify-components-button-destructive-disabled-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-button-destructive-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-button-destructive-loading-border-color: transparent;
            --amplify-components-button-destructive-loading-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-button-destructive-loading-color: var(--amplify-colors-font-disabled);
            --amplify-components-button-destructive-hover-border-color: transparent;
            --amplify-components-button-destructive-hover-background-color: var(--amplify-colors-red-80);
            --amplify-components-button-destructive-hover-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-destructive-focus-border-color: transparent;
            --amplify-components-button-destructive-focus-background-color: var(--amplify-colors-red-80);
            --amplify-components-button-destructive-focus-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-destructive-focus-box-shadow: var(--amplify-components-fieldcontrol-error-focus-box-shadow);
            --amplify-components-button-destructive-active-border-color: transparent;
            --amplify-components-button-destructive-active-background-color: var(--amplify-colors-red-100);
            --amplify-components-button-destructive-active-color: var(--amplify-colors-font-inverse);
            --amplify-components-button-small-font-size: var(--amplify-components-fieldcontrol-small-font-size);
            --amplify-components-button-small-padding-block-start: var(--amplify-components-fieldcontrol-small-padding-block-start);
            --amplify-components-button-small-padding-block-end: var(--amplify-components-fieldcontrol-small-padding-block-end);
            --amplify-components-button-small-padding-inline-start: var(--amplify-components-fieldcontrol-small-padding-inline-start);
            --amplify-components-button-small-padding-inline-end: var(--amplify-components-fieldcontrol-small-padding-inline-end);
            --amplify-components-button-large-font-size: var(--amplify-components-fieldcontrol-large-font-size);
            --amplify-components-button-large-padding-block-start: var(--amplify-components-fieldcontrol-large-padding-block-start);
            --amplify-components-button-large-padding-block-end: var(--amplify-components-fieldcontrol-large-padding-block-end);
            --amplify-components-button-large-padding-inline-start: var(--amplify-components-fieldcontrol-large-padding-inline-start);
            --amplify-components-button-large-padding-inline-end: var(--amplify-components-fieldcontrol-large-padding-inline-end);
            --amplify-components-button-loader-wrapper-align-items: center;
            --amplify-components-button-loader-wrapper-gap: var(--amplify-space-xs);
            --amplify-components-card-background-color: var(--amplify-colors-background-primary);
            --amplify-components-card-border-radius: var(--amplify-radii-xs);
            --amplify-components-card-border-width: 0;
            --amplify-components-card-border-style: solid;
            --amplify-components-card-border-color: transparent;
            --amplify-components-card-box-shadow: none;
            --amplify-components-card-padding: var(--amplify-space-medium);
            --amplify-components-card-outlined-background-color: var(--amplify-components-card-background-color);
            --amplify-components-card-outlined-border-radius: var(--amplify-radii-xs);
            --amplify-components-card-outlined-border-width: var(--amplify-border-widths-small);
            --amplify-components-card-outlined-border-style: solid;
            --amplify-components-card-outlined-border-color: var(--amplify-colors-border-primary);
            --amplify-components-card-outlined-box-shadow: var(--amplify-components-card-box-shadow);
            --amplify-components-card-elevated-background-color: var(--amplify-components-card-background-color);
            --amplify-components-card-elevated-border-radius: var(--amplify-radii-xs);
            --amplify-components-card-elevated-border-width: 0;
            --amplify-components-card-elevated-border-style: solid;
            --amplify-components-card-elevated-border-color: transparent;
            --amplify-components-card-elevated-box-shadow: var(--amplify-shadows-medium);
            --amplify-components-checkbox-cursor: pointer;
            --amplify-components-checkbox-align-items: center;
            --amplify-components-checkbox-disabled-cursor: not-allowed;
            --amplify-components-checkbox-button-position: relative;
            --amplify-components-checkbox-button-align-items: center;
            --amplify-components-checkbox-button-justify-content: center;
            --amplify-components-checkbox-button-color: var(--amplify-colors-font-inverse);
            --amplify-components-checkbox-button-before-width: 100%;
            --amplify-components-checkbox-button-before-height: 100%;
            --amplify-components-checkbox-button-before-border-width: var(--amplify-border-widths-medium);
            --amplify-components-checkbox-button-before-border-radius: 20%;
            --amplify-components-checkbox-button-before-border-style: solid;
            --amplify-components-checkbox-button-before-border-color: var(--amplify-colors-border-primary);
            --amplify-components-checkbox-button-focus-outline-color: var(--amplify-colors-transparent);
            --amplify-components-checkbox-button-focus-outline-style: solid;
            --amplify-components-checkbox-button-focus-outline-width: var(--amplify-outline-widths-medium);
            --amplify-components-checkbox-button-focus-outline-offset: var(--amplify-outline-offsets-medium);
            --amplify-components-checkbox-button-focus-border-color: var(--amplify-colors-border-focus);
            --amplify-components-checkbox-button-focus-box-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
            --amplify-components-checkbox-button-disabled-border-color: var(--amplify-colors-border-disabled);
            --amplify-components-checkbox-button-error-border-color: var(--amplify-colors-border-error);
            --amplify-components-checkbox-button-error-focus-border-color: var(--amplify-colors-border-error);
            --amplify-components-checkbox-button-error-focus-box-shadow: var(--amplify-components-fieldcontrol-error-focus-box-shadow);
            --amplify-components-checkbox-icon-background-color: var(--amplify-colors-primary-80);
            --amplify-components-checkbox-icon-border-radius: 20%;
            --amplify-components-checkbox-icon-opacity: var(--amplify-opacities-0);
            --amplify-components-checkbox-icon-transform: scale(0);
            --amplify-components-checkbox-icon-transition-property: all;
            --amplify-components-checkbox-icon-transition-duration: var(--amplify-time-short);
            --amplify-components-checkbox-icon-transition-timing-function: ease-in-out;
            --amplify-components-checkbox-icon-checked-opacity: var(--amplify-opacities-100);
            --amplify-components-checkbox-icon-checked-transform: scale(1);
            --amplify-components-checkbox-icon-checked-disabled-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-checkbox-icon-indeterminate-opacity: var(--amplify-opacities-100);
            --amplify-components-checkbox-icon-indeterminate-transform: scale(1);
            --amplify-components-checkbox-icon-indeterminate-disabled-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-checkbox-label-color: var(--amplify-components-text-color);
            --amplify-components-checkbox-label-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-checkboxfield-align-items: flex-start;
            --amplify-components-checkboxfield-align-content: center;
            --amplify-components-checkboxfield-flex-direction: column;
            --amplify-components-checkboxfield-justify-content: center;
            --amplify-components-collection-pagination-current-color: var(--amplify-components-pagination-current-color);
            --amplify-components-collection-pagination-current-background-color: var(--amplify-components-pagination-current-background-color);
            --amplify-components-collection-pagination-button-color: var(--amplify-components-pagination-button-color);
            --amplify-components-collection-pagination-button-hover-background-color: var(--amplify-components-pagination-button-hover-background-color);
            --amplify-components-collection-pagination-button-hover-color: var(--amplify-components-pagination-button-hover-color);
            --amplify-components-collection-pagination-button-disabled-color: var(--amplify-components-pagination-button-disabled-color);
            --amplify-components-collection-search-input-color: var(--amplify-components-searchfield-color);
            --amplify-components-collection-search-button-color: var(--amplify-components-searchfield-button-color);
            --amplify-components-collection-search-button-active-background-color: var(--amplify-components-searchfield-button-active-background-color);
            --amplify-components-collection-search-button-active-border-color: var(--amplify-components-searchfield-button-active-border-color);
            --amplify-components-collection-search-button-active-color: var(--amplify-components-searchfield-button-active-color);
            --amplify-components-collection-search-button-disabled-background-color: var(--amplify-components-searchfield-button-disabled-background-color);
            --amplify-components-collection-search-button-disabled-border-color: var(--amplify-components-searchfield-button-disabled-border-color);
            --amplify-components-collection-search-button-disabled-color: var(--amplify-components-searchfield-button-disabled-color);
            --amplify-components-collection-search-button-focus-background-color: var(--amplify-components-searchfield-button-focus-background-color);
            --amplify-components-collection-search-button-focus-border-color: var(--amplify-components-searchfield-button-focus-border-color);
            --amplify-components-collection-search-button-focus-color: var(--amplify-components-searchfield-button-focus-color);
            --amplify-components-collection-search-button-hover-background-color: var(--amplify-components-searchfield-button-hover-background-color);
            --amplify-components-collection-search-button-hover-border-color: var(--amplify-components-searchfield-button-hover-border-color);
            --amplify-components-collection-search-button-hover-color: var(--amplify-components-searchfield-button-hover-color);
            --amplify-components-copy-font-size: var(--amplify-font-sizes-xs);
            --amplify-components-copy-gap: var(--amplify-space-relative-medium);
            --amplify-components-copy-svg-path-fill: var(--amplify-colors-font-primary);
            --amplify-components-copy-tool-tip-bottom: var(--amplify-space-large);
            --amplify-components-copy-tool-tip-color: var(--amplify-colors-teal-100);
            --amplify-components-copy-tool-tip-font-size: var(--amplify-font-sizes-xxs);
            --amplify-components-countrycodeselect-height: var(--amplify-space-relative-full);
            --amplify-components-divider-border-style: solid;
            --amplify-components-divider-border-color: var(--amplify-colors-border-primary);
            --amplify-components-divider-border-width: var(--amplify-border-widths-medium);
            --amplify-components-divider-label-color: var(--amplify-colors-font-tertiary);
            --amplify-components-divider-label-padding-inline: var(--amplify-space-medium);
            --amplify-components-divider-label-font-size: var(--amplify-font-sizes-small);
            --amplify-components-divider-label-background-color: var(--amplify-colors-background-primary);
            --amplify-components-divider-small-border-width: var(--amplify-border-widths-small);
            --amplify-components-divider-large-border-width: var(--amplify-border-widths-large);
            --amplify-components-divider-opacity: var(--amplify-opacities-60);
            --amplify-components-dropzone-background-color: var(--amplify-colors-background-primary);
            --amplify-components-dropzone-border-radius: var(--amplify-radii-small);
            --amplify-components-dropzone-border-color: var(--amplify-colors-border-primary);
            --amplify-components-dropzone-border-style: dashed;
            --amplify-components-dropzone-border-width: var(--amplify-border-widths-small);
            --amplify-components-dropzone-color: var(--amplify-colors-font-primary);
            --amplify-components-dropzone-gap: var(--amplify-space-small);
            --amplify-components-dropzone-padding-block: var(--amplify-space-xl);
            --amplify-components-dropzone-padding-inline: var(--amplify-space-large);
            --amplify-components-dropzone-text-align: center;
            --amplify-components-dropzone-active-background-color: var(--amplify-colors-primary-10);
            --amplify-components-dropzone-active-border-radius: var(--amplify-components-dropzone-border-radius);
            --amplify-components-dropzone-active-border-color: var(--amplify-colors-border-pressed);
            --amplify-components-dropzone-active-border-style: var(--amplify-components-dropzone-border-style);
            --amplify-components-dropzone-active-border-width: var(--amplify-components-dropzone-border-width);
            --amplify-components-dropzone-active-color: var(--amplify-colors-font-primary);
            --amplify-components-dropzone-disabled-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-dropzone-disabled-border-radius: var(--amplify-components-dropzone-border-radius);
            --amplify-components-dropzone-disabled-border-color: var(--amplify-colors-border-disabled);
            --amplify-components-dropzone-disabled-border-style: var(--amplify-components-dropzone-border-style);
            --amplify-components-dropzone-disabled-border-width: var(--amplify-components-dropzone-border-width);
            --amplify-components-dropzone-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-dropzone-accepted-background-color: var(--amplify-colors-background-success);
            --amplify-components-dropzone-accepted-border-radius: var(--amplify-components-dropzone-border-radius);
            --amplify-components-dropzone-accepted-border-color: var(--amplify-colors-border-success);
            --amplify-components-dropzone-accepted-border-style: var(--amplify-components-dropzone-border-style);
            --amplify-components-dropzone-accepted-border-width: var(--amplify-components-dropzone-border-width);
            --amplify-components-dropzone-accepted-color: var(--amplify-colors-font-success);
            --amplify-components-dropzone-rejected-background-color: var(--amplify-colors-background-error);
            --amplify-components-dropzone-rejected-border-radius: var(--amplify-components-dropzone-border-radius);
            --amplify-components-dropzone-rejected-border-color: var(--amplify-colors-border-pressed);
            --amplify-components-dropzone-rejected-border-style: var(--amplify-components-dropzone-border-style);
            --amplify-components-dropzone-rejected-border-width: var(--amplify-components-dropzone-border-width);
            --amplify-components-dropzone-rejected-color: var(--amplify-colors-font-error);
            --amplify-components-field-gap: var(--amplify-space-xs);
            --amplify-components-field-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-field-flex-direction: column;
            --amplify-components-field-small-gap: var(--amplify-space-xxxs);
            --amplify-components-field-small-font-size: var(--amplify-font-sizes-small);
            --amplify-components-field-large-gap: var(--amplify-space-small);
            --amplify-components-field-large-font-size: var(--amplify-font-sizes-large);
            --amplify-components-field-label-color: var(--amplify-colors-font-secondary);
            --amplify-components-fieldcontrol-border-style: solid;
            --amplify-components-fieldcontrol-border-color: var(--amplify-colors-border-primary);
            --amplify-components-fieldcontrol-border-width: var(--amplify-border-widths-small);
            --amplify-components-fieldcontrol-border-radius: var(--amplify-radii-small);
            --amplify-components-fieldcontrol-color: var(--amplify-colors-font-primary);
            --amplify-components-fieldcontrol-padding-block-start: var(--amplify-space-xs);
            --amplify-components-fieldcontrol-padding-block-end: var(--amplify-space-xs);
            --amplify-components-fieldcontrol-padding-inline-start: var(--amplify-space-medium);
            --amplify-components-fieldcontrol-padding-inline-end: var(--amplify-space-medium);
            --amplify-components-fieldcontrol-font-size: var(--amplify-components-field-font-size);
            --amplify-components-fieldcontrol-line-height: var(--amplify-line-heights-medium);
            --amplify-components-fieldcontrol-transition-duration: var(--amplify-time-medium);
            --amplify-components-fieldcontrol-outline-color: var(--amplify-colors-transparent);
            --amplify-components-fieldcontrol-outline-style: solid;
            --amplify-components-fieldcontrol-outline-width: var(--amplify-outline-widths-medium);
            --amplify-components-fieldcontrol-outline-offset: var(--amplify-outline-offsets-medium);
            --amplify-components-fieldcontrol-small-font-size: var(--amplify-components-field-small-font-size);
            --amplify-components-fieldcontrol-small-padding-block-start: var(--amplify-space-xxs);
            --amplify-components-fieldcontrol-small-padding-block-end: var(--amplify-space-xxs);
            --amplify-components-fieldcontrol-small-padding-inline-start: var(--amplify-space-small);
            --amplify-components-fieldcontrol-small-padding-inline-end: var(--amplify-space-small);
            --amplify-components-fieldcontrol-large-font-size: var(--amplify-components-field-large-font-size);
            --amplify-components-fieldcontrol-large-padding-block-start: var(--amplify-space-xs);
            --amplify-components-fieldcontrol-large-padding-block-end: var(--amplify-space-xs);
            --amplify-components-fieldcontrol-large-padding-inline-start: var(--amplify-space-medium);
            --amplify-components-fieldcontrol-large-padding-inline-end: var(--amplify-space-medium);
            --amplify-components-fieldcontrol-quiet-border-style: none;
            --amplify-components-fieldcontrol-quiet-border-inline-start: none;
            --amplify-components-fieldcontrol-quiet-border-inline-end: none;
            --amplify-components-fieldcontrol-quiet-border-block-start: none;
            --amplify-components-fieldcontrol-quiet-border-radius: 0;
            --amplify-components-fieldcontrol-quiet-focus-border-block-end-color: transparent;
            --amplify-components-fieldcontrol-quiet-focus-box-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
            --amplify-components-fieldcontrol-quiet-error-border-block-end-color: var(--amplify-colors-border-error);
            --amplify-components-fieldcontrol-quiet-error-focus-border-block-end-color: transparent;
            --amplify-components-fieldcontrol-quiet-error-focus-box-shadow: var(--amplify-components-fieldcontrol-error-focus-box-shadow);
            --amplify-components-fieldcontrol-focus-border-color: var(--amplify-colors-border-focus);
            --amplify-components-fieldcontrol-focus-box-shadow: 0px 0px 0px 2px var(--amplify-colors-border-focus);
            --amplify-components-fieldcontrol-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-fieldcontrol-disabled-cursor: not-allowed;
            --amplify-components-fieldcontrol-disabled-border-color: var(--amplify-colors-transparent);
            --amplify-components-fieldcontrol-disabled-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-fieldcontrol-error-border-color: var(--amplify-colors-border-error);
            --amplify-components-fieldcontrol-error-color: var(--amplify-colors-font-error);
            --amplify-components-fieldcontrol-error-focus-box-shadow: 0px 0px 0px 2px var(--amplify-colors-border-error);
            --amplify-components-fieldcontrol-info-focus-box-shadow: 0px 0px 0px 2px var(--amplify-colors-blue-100);
            --amplify-components-fieldcontrol-warning-focus-box-shadow: 0px 0px 0px 2px var(--amplify-colors-orange-100);
            --amplify-components-fieldcontrol-success-focus-box-shadow: 0px 0px 0px 2px var(--amplify-colors-green-100);
            --amplify-components-fieldcontrol-overlay-focus-box-shadow: 0px 0px 0px 2px var(--amplify-colors-overlay-90);
            --amplify-components-fieldgroup-gap: var(--amplify-space-zero);
            --amplify-components-fieldgroup-vertical-align-items: center;
            --amplify-components-fieldgroup-outer-align-items: center;
            --amplify-components-fieldmessages-error-color: var(--amplify-colors-font-error);
            --amplify-components-fieldmessages-error-font-size: var(--amplify-font-sizes-small);
            --amplify-components-fieldmessages-description-color: var(--amplify-colors-font-secondary);
            --amplify-components-fieldmessages-description-font-style: italic;
            --amplify-components-fieldmessages-description-font-size: var(--amplify-font-sizes-small);
            --amplify-components-fieldset-background-color: transparent;
            --amplify-components-fieldset-border-radius: var(--amplify-radii-xs);
            --amplify-components-fieldset-flex-direction: column;
            --amplify-components-fieldset-gap: var(--amplify-components-field-gap);
            --amplify-components-fieldset-legend-color: var(--amplify-colors-font-primary);
            --amplify-components-fieldset-legend-font-size: var(--amplify-components-field-font-size);
            --amplify-components-fieldset-legend-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-fieldset-legend-line-height: var(--amplify-line-heights-medium);
            --amplify-components-fieldset-legend-small-font-size: var(--amplify-components-field-small-font-size);
            --amplify-components-fieldset-legend-large-font-size: var(--amplify-components-field-large-font-size);
            --amplify-components-fieldset-outlined-padding: var(--amplify-space-medium);
            --amplify-components-fieldset-outlined-border-color: var(--amplify-colors-neutral-40);
            --amplify-components-fieldset-outlined-border-width: var(--amplify-border-widths-small);
            --amplify-components-fieldset-outlined-border-style: solid;
            --amplify-components-fieldset-outlined-small-padding: var(--amplify-space-small);
            --amplify-components-fieldset-outlined-large-padding: var(--amplify-space-large);
            --amplify-components-fieldset-small-gap: var(--amplify-components-field-small-gap);
            --amplify-components-fieldset-large-gap: var(--amplify-components-field-large-gap);
            --amplify-components-fileuploader-dropzone-background-color: var(--amplify-colors-background-primary);
            --amplify-components-fileuploader-dropzone-border-radius: var(--amplify-radii-small);
            --amplify-components-fileuploader-dropzone-border-color: var(--amplify-colors-border-primary);
            --amplify-components-fileuploader-dropzone-border-style: dashed;
            --amplify-components-fileuploader-dropzone-border-width: var(--amplify-border-widths-small);
            --amplify-components-fileuploader-dropzone-gap: var(--amplify-space-small);
            --amplify-components-fileuploader-dropzone-padding-block: var(--amplify-space-xl);
            --amplify-components-fileuploader-dropzone-padding-inline: var(--amplify-space-large);
            --amplify-components-fileuploader-dropzone-text-align: center;
            --amplify-components-fileuploader-dropzone-active-background-color: var(--amplify-colors-primary-10);
            --amplify-components-fileuploader-dropzone-active-border-radius: var(--amplify-components-fileuploader-dropzone-border-radius);
            --amplify-components-fileuploader-dropzone-active-border-color: var(--amplify-colors-border-pressed);
            --amplify-components-fileuploader-dropzone-active-border-style: var(--amplify-components-fileuploader-dropzone-border-style);
            --amplify-components-fileuploader-dropzone-active-border-width: var(--amplify-border-widths-medium);
            --amplify-components-fileuploader-dropzone-icon-color: var(--amplify-colors-border-primary);
            --amplify-components-fileuploader-dropzone-icon-font-size: var(--amplify-font-sizes-xxl);
            --amplify-components-fileuploader-dropzone-text-color: var(--amplify-colors-font-tertiary);
            --amplify-components-fileuploader-dropzone-text-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-fileuploader-dropzone-text-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-fileuploader-file-background-color: var(--amplify-colors-background-primary);
            --amplify-components-fileuploader-file-border-radius: var(--amplify-radii-small);
            --amplify-components-fileuploader-file-border-color: var(--amplify-colors-border-primary);
            --amplify-components-fileuploader-file-border-style: solid;
            --amplify-components-fileuploader-file-border-width: var(--amplify-border-widths-small);
            --amplify-components-fileuploader-file-padding-block: var(--amplify-space-xs);
            --amplify-components-fileuploader-file-padding-inline: var(--amplify-space-small);
            --amplify-components-fileuploader-file-gap: var(--amplify-space-small);
            --amplify-components-fileuploader-file-align-items: baseline;
            --amplify-components-fileuploader-file-name-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-fileuploader-file-name-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-fileuploader-file-name-color: var(--amplify-colors-font-primary);
            --amplify-components-fileuploader-file-size-font-size: var(--amplify-font-sizes-small);
            --amplify-components-fileuploader-file-size-font-weight: var(--amplify-font-weights-normal);
            --amplify-components-fileuploader-file-size-color: var(--amplify-colors-font-tertiary);
            --amplify-components-fileuploader-file-image-width: var(--amplify-space-xxl);
            --amplify-components-fileuploader-file-image-height: var(--amplify-space-xxl);
            --amplify-components-fileuploader-file-image-background-color: var(--amplify-colors-background-secondary);
            --amplify-components-fileuploader-file-image-color: var(--amplify-colors-font-tertiary);
            --amplify-components-fileuploader-file-image-border-radius: var(--amplify-radii-small);
            --amplify-components-fileuploader-filelist-flex-direction: column;
            --amplify-components-fileuploader-filelist-gap: var(--amplify-space-small);
            --amplify-components-fileuploader-loader-stroke-linecap: round;
            --amplify-components-fileuploader-loader-stroke-empty: var(--amplify-colors-border-secondary);
            --amplify-components-fileuploader-loader-stroke-filled: var(--amplify-components-loader-stroke-filled);
            --amplify-components-fileuploader-loader-stroke-width: var(--amplify-border-widths-large);
            --amplify-components-fileuploader-previewer-background-color: var(--amplify-colors-background-primary);
            --amplify-components-fileuploader-previewer-border-color: var(--amplify-colors-border-primary);
            --amplify-components-fileuploader-previewer-border-style: solid;
            --amplify-components-fileuploader-previewer-border-width: var(--amplify-border-widths-small);
            --amplify-components-fileuploader-previewer-border-radius: var(--amplify-radii-small);
            --amplify-components-fileuploader-previewer-padding-block: var(--amplify-space-zero);
            --amplify-components-fileuploader-previewer-padding-inline: var(--amplify-space-zero);
            --amplify-components-fileuploader-previewer-max-height: 40rem;
            --amplify-components-fileuploader-previewer-max-width: auto;
            --amplify-components-fileuploader-previewer-text-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-fileuploader-previewer-text-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-fileuploader-previewer-text-color: var(--amplify-colors-font-primary);
            --amplify-components-fileuploader-previewer-body-padding-block: var(--amplify-space-medium);
            --amplify-components-fileuploader-previewer-body-padding-inline: var(--amplify-space-medium);
            --amplify-components-fileuploader-previewer-body-gap: var(--amplify-space-small);
            --amplify-components-fileuploader-previewer-footer-justify-content: flex-end;
            --amplify-components-flex-gap: var(--amplify-space-medium);
            --amplify-components-flex-justify-content: normal;
            --amplify-components-flex-align-items: stretch;
            --amplify-components-flex-align-content: normal;
            --amplify-components-flex-flex-wrap: nowrap;
            --amplify-components-heading-1-font-size: var(--amplify-font-sizes-xxxxl);
            --amplify-components-heading-1-font-weight: var(--amplify-font-weights-light);
            --amplify-components-heading-2-font-size: var(--amplify-font-sizes-xxxl);
            --amplify-components-heading-2-font-weight: var(--amplify-font-weights-normal);
            --amplify-components-heading-3-font-size: var(--amplify-font-sizes-xxl);
            --amplify-components-heading-3-font-weight: var(--amplify-font-weights-medium);
            --amplify-components-heading-4-font-size: var(--amplify-font-sizes-xl);
            --amplify-components-heading-4-font-weight: var(--amplify-font-weights-semibold);
            --amplify-components-heading-5-font-size: var(--amplify-font-sizes-large);
            --amplify-components-heading-5-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-heading-6-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-heading-6-font-weight: var(--amplify-font-weights-extrabold);
            --amplify-components-heading-color: var(--amplify-colors-font-primary);
            --amplify-components-heading-line-height: var(--amplify-line-heights-small);
            --amplify-components-icon-line-height: 1;
            --amplify-components-icon-height: 1em;
            --amplify-components-highlightmatch-highlighted-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-image-max-width: 100%;
            --amplify-components-image-height: auto;
            --amplify-components-image-object-fit: initial;
            --amplify-components-image-object-position: initial;
            --amplify-components-inappmessaging-banner-height: 150px ;
            --amplify-components-inappmessaging-banner-width: 400px ;
            --amplify-components-inappmessaging-button-background-color: #e8e8e8;
            --amplify-components-inappmessaging-button-border-radius: 5px;
            --amplify-components-inappmessaging-button-color: black;
            --amplify-components-inappmessaging-dialog-height: 50vh;
            --amplify-components-inappmessaging-dialog-min-height: 400px;
            --amplify-components-inappmessaging-dialog-min-width: 400px;
            --amplify-components-inappmessaging-dialog-width: 30vw;
            --amplify-components-inappmessaging-header-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-inappmessaging-header-font-weight: var(--amplify-font-weights-extrabold);
            --amplify-components-input-color: var(--amplify-components-fieldcontrol-color);
            --amplify-components-input-border-color: var(--amplify-components-fieldcontrol-border-color);
            --amplify-components-input-font-size: var(--amplify-components-fieldcontrol-font-size);
            --amplify-components-input-focus-border-color: var(--amplify-components-fieldcontrol-focus-border-color);
            --amplify-components-link-active-color: var(--amplify-colors-font-active);
            --amplify-components-link-color: var(--amplify-colors-font-interactive);
            --amplify-components-link-focus-color: var(--amplify-colors-font-focus);
            --amplify-components-link-hover-color: var(--amplify-colors-font-hover);
            --amplify-components-link-visited-color: var(--amplify-colors-font-interactive);
            --amplify-components-liveness-camera-module-background-color: var(--amplify-colors-background-primary);
            --amplify-components-loader-width: var(--amplify-font-sizes-medium);
            --amplify-components-loader-height: var(--amplify-font-sizes-medium);
            --amplify-components-loader-font-size: var(--amplify-font-sizes-xs);
            --amplify-components-loader-stroke-empty: var(--amplify-colors-neutral-20);
            --amplify-components-loader-stroke-filled: var(--amplify-colors-primary-80);
            --amplify-components-loader-stroke-linecap: round;
            --amplify-components-loader-animation-duration: 1s;
            --amplify-components-loader-small-width: var(--amplify-font-sizes-small);
            --amplify-components-loader-small-height: var(--amplify-font-sizes-small);
            --amplify-components-loader-small-font-size: var(--amplify-font-sizes-xxs);
            --amplify-components-loader-large-width: var(--amplify-font-sizes-large);
            --amplify-components-loader-large-height: var(--amplify-font-sizes-large);
            --amplify-components-loader-large-font-size: var(--amplify-font-sizes-small);
            --amplify-components-loader-linear-width: 100%;
            --amplify-components-loader-linear-min-width: 5rem;
            --amplify-components-loader-linear-font-size: var(--amplify-font-sizes-xxs);
            --amplify-components-loader-linear-stroke-width: var(--amplify-font-sizes-xxs);
            --amplify-components-loader-linear-stroke-filled: var(--amplify-colors-primary-80);
            --amplify-components-loader-linear-stroke-empty: var(--amplify-colors-neutral-20);
            --amplify-components-loader-linear-stroke-linecap: round;
            --amplify-components-loader-linear-animation-duration: 1s;
            --amplify-components-loader-linear-small-stroke-width: var(--amplify-font-sizes-xxxs);
            --amplify-components-loader-linear-small-font-size: var(--amplify-font-sizes-xxxs);
            --amplify-components-loader-linear-large-stroke-width: var(--amplify-font-sizes-xs);
            --amplify-components-loader-linear-large-font-size: var(--amplify-font-sizes-xs);
            --amplify-components-loader-text-fill: var(--amplify-colors-font-primary);
            --amplify-components-menu-background-color: var(--amplify-colors-background-primary);
            --amplify-components-menu-border-radius: var(--amplify-radii-medium);
            --amplify-components-menu-border-width: var(--amplify-border-widths-small);
            --amplify-components-menu-border-style: solid;
            --amplify-components-menu-border-color: var(--amplify-colors-border-primary);
            --amplify-components-menu-box-shadow: var(--amplify-shadows-large);
            --amplify-components-menu-flex-direction: column;
            --amplify-components-menu-gap: var(--amplify-space-zero);
            --amplify-components-menu-max-width: 30rem;
            --amplify-components-menu-min-width: 14rem;
            --amplify-components-menu-small-width: var(--amplify-font-sizes-medium);
            --amplify-components-menu-small-height: var(--amplify-font-sizes-medium);
            --amplify-components-menu-large-width: var(--amplify-font-sizes-xxxl);
            --amplify-components-menu-large-height: var(--amplify-font-sizes-xxxl);
            --amplify-components-menu-item-min-height: 2.5rem;
            --amplify-components-menu-item-padding-inline-start: var(--amplify-space-medium);
            --amplify-components-menu-item-padding-inline-end: var(--amplify-space-medium);
            --amplify-components-message-align-items: center;
            --amplify-components-message-background-color: var(--amplify-colors-background-tertiary);
            --amplify-components-message-border-color: transparent;
            --amplify-components-message-border-style: solid;
            --amplify-components-message-border-width: var(--amplify-border-widths-small);
            --amplify-components-message-border-radius: var(--amplify-radii-xs);
            --amplify-components-message-color: var(--amplify-colors-font-primary);
            --amplify-components-message-justify-content: flex-start;
            --amplify-components-message-padding-block: var(--amplify-space-small);
            --amplify-components-message-padding-inline: var(--amplify-space-medium);
            --amplify-components-message-line-height: var(--amplify-line-heights-small);
            --amplify-components-message-icon-size: var(--amplify-font-sizes-xl);
            --amplify-components-message-heading-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-message-heading-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-message-dismiss-gap: var(--amplify-space-xxs);
            --amplify-components-message-plain-color: var(--amplify-colors-font-primary);
            --amplify-components-message-plain-background-color: var(--amplify-colors-background-primary);
            --amplify-components-message-plain-border-color: transparent;
            --amplify-components-message-plain-info-color: var(--amplify-colors-font-info);
            --amplify-components-message-plain-info-background-color: var(--amplify-colors-background-primary);
            --amplify-components-message-plain-info-border-color: transparent;
            --amplify-components-message-plain-error-color: var(--amplify-colors-font-error);
            --amplify-components-message-plain-error-background-color: var(--amplify-colors-background-primary);
            --amplify-components-message-plain-error-border-color: transparent;
            --amplify-components-message-plain-success-color: var(--amplify-colors-font-success);
            --amplify-components-message-plain-success-background-color: var(--amplify-colors-background-primary);
            --amplify-components-message-plain-success-border-color: transparent;
            --amplify-components-message-plain-warning-color: var(--amplify-colors-font-warning);
            --amplify-components-message-plain-warning-background-color: var(--amplify-colors-background-primary);
            --amplify-components-message-plain-warning-border-color: transparent;
            --amplify-components-message-outlined-color: var(--amplify-colors-font-primary);
            --amplify-components-message-outlined-background-color: var(--amplify-colors-background-primary);
            --amplify-components-message-outlined-border-color: var(--amplify-colors-border-primary);
            --amplify-components-message-outlined-info-color: var(--amplify-colors-font-info);
            --amplify-components-message-outlined-info-background-color: var(--amplify-colors-background-primary);
            --amplify-components-message-outlined-info-border-color: var(--amplify-colors-border-info);
            --amplify-components-message-outlined-error-color: var(--amplify-colors-font-error);
            --amplify-components-message-outlined-error-background-color: var(--amplify-colors-background-primary);
            --amplify-components-message-outlined-error-border-color: var(--amplify-colors-border-error);
            --amplify-components-message-outlined-success-color: var(--amplify-colors-font-success);
            --amplify-components-message-outlined-success-background-color: var(--amplify-colors-background-primary);
            --amplify-components-message-outlined-success-border-color: var(--amplify-colors-border-success);
            --amplify-components-message-outlined-warning-color: var(--amplify-colors-font-warning);
            --amplify-components-message-outlined-warning-background-color: var(--amplify-colors-background-primary);
            --amplify-components-message-outlined-warning-border-color: var(--amplify-colors-border-warning);
            --amplify-components-message-filled-color: var(--amplify-colors-font-primary);
            --amplify-components-message-filled-background-color: var(--amplify-colors-background-secondary);
            --amplify-components-message-filled-border-color: transparent;
            --amplify-components-message-filled-info-color: var(--amplify-colors-font-info);
            --amplify-components-message-filled-info-background-color: var(--amplify-colors-background-info);
            --amplify-components-message-filled-info-border-color: transparent;
            --amplify-components-message-filled-error-color: var(--amplify-colors-font-error);
            --amplify-components-message-filled-error-background-color: var(--amplify-colors-background-error);
            --amplify-components-message-filled-error-border-color: transparent;
            --amplify-components-message-filled-success-color: var(--amplify-colors-font-success);
            --amplify-components-message-filled-success-background-color: var(--amplify-colors-background-success);
            --amplify-components-message-filled-success-border-color: transparent;
            --amplify-components-message-filled-warning-color: var(--amplify-colors-font-warning);
            --amplify-components-message-filled-warning-background-color: var(--amplify-colors-background-warning);
            --amplify-components-message-filled-warning-border-color: transparent;
            --amplify-components-pagination-current-align-items: center;
            --amplify-components-pagination-current-justify-content: center;
            --amplify-components-pagination-current-color: var(--amplify-colors-font-inverse);
            --amplify-components-pagination-current-font-size: var(--amplify-font-sizes-small);
            --amplify-components-pagination-current-background-color: var(--amplify-colors-overlay-40);
            --amplify-components-pagination-button-color: var(--amplify-colors-font-primary);
            --amplify-components-pagination-button-padding-inline-start: var(--amplify-space-xxs);
            --amplify-components-pagination-button-padding-inline-end: var(--amplify-space-xxs);
            --amplify-components-pagination-button-transition-property: background-color;
            --amplify-components-pagination-button-transition-duration: var(--amplify-time-medium);
            --amplify-components-pagination-button-hover-background-color: var(--amplify-colors-overlay-10);
            --amplify-components-pagination-button-hover-color: var(--amplify-colors-font-primary);
            --amplify-components-pagination-button-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-pagination-ellipsis-align-items: baseline;
            --amplify-components-pagination-ellipsis-justify-content: center;
            --amplify-components-pagination-ellipsis-padding-inline-start: var(--amplify-space-xs);
            --amplify-components-pagination-ellipsis-padding-inline-end: var(--amplify-space-xs);
            --amplify-components-pagination-item-container-margin-left: var(--amplify-space-xxxs);
            --amplify-components-pagination-item-container-margin-right: var(--amplify-space-xxxs);
            --amplify-components-pagination-item-shared-height: var(--amplify-font-sizes-xxl);
            --amplify-components-pagination-item-shared-min-width: var(--amplify-font-sizes-xxl);
            --amplify-components-pagination-item-shared-border-radius: var(--amplify-font-sizes-medium);
            --amplify-components-passwordfield-color: var(--amplify-components-fieldcontrol-color);
            --amplify-components-passwordfield-button-color: var(--amplify-components-button-color);
            --amplify-components-passwordfield-button-active-background-color: var(--amplify-components-button-active-background-color);
            --amplify-components-passwordfield-button-active-border-color: var(--amplify-components-button-active-border-color);
            --amplify-components-passwordfield-button-active-color: var(--amplify-components-button-active-color);
            --amplify-components-passwordfield-button-disabled-background-color: var(--amplify-components-button-disabled-background-color);
            --amplify-components-passwordfield-button-disabled-border-color: var(--amplify-components-button-disabled-border-color);
            --amplify-components-passwordfield-button-disabled-color: var(--amplify-components-button-disabled-color);
            --amplify-components-passwordfield-button-error-color: var(--amplify-components-button-outlined-error-color);
            --amplify-components-passwordfield-button-error-background-color: var(--amplify-components-button-outlined-error-background-color);
            --amplify-components-passwordfield-button-error-border-color: var(--amplify-components-button-outlined-error-border-color);
            --amplify-components-passwordfield-button-error-active-border-color: var(--amplify-components-button-outlined-error-active-border-color);
            --amplify-components-passwordfield-button-error-active-background-color: var(--amplify-components-button-outlined-error-active-background-color);
            --amplify-components-passwordfield-button-error-active-color: var(--amplify-components-button-outlined-error-active-color);
            --amplify-components-passwordfield-button-error-focus-border-color: var(--amplify-components-button-outlined-error-focus-border-color);
            --amplify-components-passwordfield-button-error-focus-background-color: var(--amplify-components-button-outlined-error-focus-background-color);
            --amplify-components-passwordfield-button-error-focus-color: var(--amplify-components-button-outlined-error-focus-color);
            --amplify-components-passwordfield-button-error-focus-box-shadow: var(--amplify-components-button-outlined-error-focus-box-shadow);
            --amplify-components-passwordfield-button-error-hover-border-color: var(--amplify-components-button-outlined-error-hover-border-color);
            --amplify-components-passwordfield-button-error-hover-background-color: var(--amplify-components-button-outlined-error-hover-background-color);
            --amplify-components-passwordfield-button-error-hover-color: var(--amplify-components-button-outlined-error-hover-color);
            --amplify-components-passwordfield-button-focus-background-color: var(--amplify-components-button-focus-background-color);
            --amplify-components-passwordfield-button-focus-border-color: var(--amplify-components-button-focus-border-color);
            --amplify-components-passwordfield-button-focus-color: var(--amplify-components-button-focus-color);
            --amplify-components-passwordfield-button-hover-background-color: var(--amplify-components-button-hover-background-color);
            --amplify-components-passwordfield-button-hover-border-color: var(--amplify-components-button-hover-border-color);
            --amplify-components-passwordfield-button-hover-color: var(--amplify-components-button-hover-color);
            --amplify-components-phonenumberfield-color: var(--amplify-components-fieldcontrol-color);
            --amplify-components-phonenumberfield-border-color: var(--amplify-components-fieldcontrol-border-color);
            --amplify-components-phonenumberfield-font-size: var(--amplify-components-fieldcontrol-font-size);
            --amplify-components-phonenumberfield-focus-border-color: var(--amplify-components-fieldcontrol-focus-border-color);
            --amplify-components-placeholder-border-radius: var(--amplify-radii-small);
            --amplify-components-placeholder-transition-duration: var(--amplify-time-long);
            --amplify-components-placeholder-start-color: var(--amplify-colors-background-secondary);
            --amplify-components-placeholder-end-color: var(--amplify-colors-background-tertiary);
            --amplify-components-placeholder-small-height: var(--amplify-space-small);
            --amplify-components-placeholder-default-height: var(--amplify-space-medium);
            --amplify-components-placeholder-large-height: var(--amplify-space-large);
            --amplify-components-radio-align-items: center;
            --amplify-components-radio-justify-content: flex-start;
            --amplify-components-radio-gap: inherit;
            --amplify-components-radio-disabled-cursor: not-allowed;
            --amplify-components-radio-button-align-items: center;
            --amplify-components-radio-button-justify-content: center;
            --amplify-components-radio-button-width: var(--amplify-font-sizes-medium);
            --amplify-components-radio-button-height: var(--amplify-font-sizes-medium);
            --amplify-components-radio-button-box-sizing: border-box;
            --amplify-components-radio-button-border-width: var(--amplify-border-widths-medium);
            --amplify-components-radio-button-border-style: solid;
            --amplify-components-radio-button-border-radius: 50%;
            --amplify-components-radio-button-border-color: var(--amplify-colors-border-primary);
            --amplify-components-radio-button-color: var(--amplify-colors-background-primary);
            --amplify-components-radio-button-background-color: var(--amplify-colors-background-primary);
            --amplify-components-radio-button-transition-property: all;
            --amplify-components-radio-button-transition-duration: var(--amplify-time-medium);
            --amplify-components-radio-button-outline-color: var(--amplify-colors-transparent);
            --amplify-components-radio-button-outline-style: solid;
            --amplify-components-radio-button-outline-width: var(--amplify-outline-widths-medium);
            --amplify-components-radio-button-outline-offset: var(--amplify-outline-offsets-medium);
            --amplify-components-radio-button-padding: var(--amplify-border-widths-medium);
            --amplify-components-radio-button-small-width: var(--amplify-font-sizes-small);
            --amplify-components-radio-button-small-height: var(--amplify-font-sizes-small);
            --amplify-components-radio-button-large-width: var(--amplify-font-sizes-large);
            --amplify-components-radio-button-large-height: var(--amplify-font-sizes-large);
            --amplify-components-radio-button-checked-color: var(--amplify-colors-primary-80);
            --amplify-components-radio-button-checked-disabled-color: var(--amplify-colors-background-disabled);
            --amplify-components-radio-button-focus-border-color: var(--amplify-colors-border-focus);
            --amplify-components-radio-button-focus-box-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
            --amplify-components-radio-button-error-border-color: var(--amplify-colors-border-error);
            --amplify-components-radio-button-error-focus-box-shadow: var(--amplify-components-fieldcontrol-error-focus-box-shadow);
            --amplify-components-radio-button-disabled-border-color: var(--amplify-colors-border-disabled);
            --amplify-components-radio-button-disabled-background-color: var(--amplify-colors-background-primary);
            --amplify-components-radio-label-color: var(--amplify-components-text-color);
            --amplify-components-radio-label-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-radiogroup-radio-border-width: var(--amplify-components-radio-button-border-width);
            --amplify-components-radiogroup-radio-border-color: var(--amplify-components-radio-button-border-color);
            --amplify-components-radiogroup-radio-background-color: var(--amplify-components-radio-button-background-color);
            --amplify-components-radiogroup-radio-checked-color: var(--amplify-components-radio-button-checked-color);
            --amplify-components-radiogroup-radio-label-color: var(--amplify-components-radio-label-color);
            --amplify-components-radiogroup-legend-color: var(--amplify-components-fieldset-legend-color);
            --amplify-components-radiogroup-legend-font-weight: var(--amplify-font-weights-normal);
            --amplify-components-rating-large-size: var(--amplify-font-sizes-xxxl);
            --amplify-components-rating-default-size: var(--amplify-font-sizes-xl);
            --amplify-components-rating-small-size: var(--amplify-font-sizes-small);
            --amplify-components-rating-filled-color: var(--amplify-colors-secondary-80);
            --amplify-components-rating-empty-color: var(--amplify-colors-background-tertiary);
            --amplify-components-searchfield-color: var(--amplify-components-fieldcontrol-color);
            --amplify-components-searchfield-button-color: var(--amplify-components-button-color);
            --amplify-components-searchfield-button-background-color: var(--amplify-colors-background-primary);
            --amplify-components-searchfield-button-active-background-color: var(--amplify-components-button-active-background-color);
            --amplify-components-searchfield-button-active-border-color: var(--amplify-components-button-active-border-color);
            --amplify-components-searchfield-button-active-color: var(--amplify-components-button-active-color);
            --amplify-components-searchfield-button-disabled-background-color: var(--amplify-components-button-disabled-background-color);
            --amplify-components-searchfield-button-disabled-border-color: var(--amplify-components-button-disabled-border-color);
            --amplify-components-searchfield-button-disabled-color: var(--amplify-components-button-disabled-color);
            --amplify-components-searchfield-button-focus-background-color: var(--amplify-components-button-focus-background-color);
            --amplify-components-searchfield-button-focus-border-color: var(--amplify-components-button-focus-border-color);
            --amplify-components-searchfield-button-focus-color: var(--amplify-components-button-focus-color);
            --amplify-components-searchfield-button-hover-background-color: var(--amplify-components-button-hover-background-color);
            --amplify-components-searchfield-button-hover-border-color: var(--amplify-components-button-hover-border-color);
            --amplify-components-searchfield-button-hover-color: var(--amplify-components-button-hover-color);
            --amplify-components-select-color: var(--amplify-components-fieldcontrol-color);
            --amplify-components-select-background-color: var(--amplify-colors-background-primary);
            --amplify-components-select-padding-inline-end: var(--amplify-space-xxl);
            --amplify-components-select-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-select-disabled-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-select-wrapper-flex: 1;
            --amplify-components-select-wrapper-display: block;
            --amplify-components-select-wrapper-position: relative;
            --amplify-components-select-wrapper-cursor: pointer;
            --amplify-components-select-icon-wrapper-align-items: center;
            --amplify-components-select-icon-wrapper-position: absolute;
            --amplify-components-select-icon-wrapper-top: 50%;
            --amplify-components-select-icon-wrapper-right: var(--amplify-space-medium);
            --amplify-components-select-icon-wrapper-transform: translateY(-50%);
            --amplify-components-select-icon-wrapper-pointer-events: none;
            --amplify-components-select-icon-wrapper-small-right: var(--amplify-space-xs);
            --amplify-components-select-icon-wrapper-large-right: var(--amplify-space-medium);
            --amplify-components-select-option-background-color: transparent;
            --amplify-components-select-option-color: var(--amplify-colors-font-primary);
            --amplify-components-select-option-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-select-option-disabled-background-color: transparent;
            --amplify-components-select-white-space: nowrap;
            --amplify-components-select-min-width: 6.5rem;
            --amplify-components-select-small-min-width: 5.5rem;
            --amplify-components-select-small-padding-inline-end: var(--amplify-space-xl);
            --amplify-components-select-large-min-width: 7.5rem;
            --amplify-components-select-large-padding-inline-end: var(--amplify-space-xxl);
            --amplify-components-select-expanded-padding-block: var(--amplify-space-xs);
            --amplify-components-select-expanded-padding-inline: var(--amplify-space-small);
            --amplify-components-select-expanded-option-padding-block: var(--amplify-space-xs);
            --amplify-components-select-expanded-option-padding-inline: var(--amplify-space-small);
            --amplify-components-selectfield-border-color: var(--amplify-components-fieldcontrol-border-color);
            --amplify-components-selectfield-color: var(--amplify-components-fieldcontrol-color);
            --amplify-components-selectfield-flex-direction: column;
            --amplify-components-selectfield-font-size: var(--amplify-components-fieldcontrol-font-size);
            --amplify-components-selectfield-focus-border-color: var(--amplify-components-fieldcontrol-focus-border-color);
            --amplify-components-selectfield-label-color: var(--amplify-components-field-label-color);
            --amplify-components-sliderfield-padding-block: var(--amplify-space-xs);
            --amplify-components-sliderfield-track-background-color: var(--amplify-colors-background-quaternary);
            --amplify-components-sliderfield-track-border-radius: 9999px;
            --amplify-components-sliderfield-track-height: 0.375rem;
            --amplify-components-sliderfield-track-min-width: 10rem;
            --amplify-components-sliderfield-range-background-color: var(--amplify-colors-primary-80);
            --amplify-components-sliderfield-range-border-radius: 9999px;
            --amplify-components-sliderfield-range-disabled-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-sliderfield-thumb-width: 1.25rem;
            --amplify-components-sliderfield-thumb-height: 1.25rem;
            --amplify-components-sliderfield-thumb-background-color: var(--amplify-colors-background-primary);
            --amplify-components-sliderfield-thumb-box-shadow: var(--amplify-shadows-small);
            --amplify-components-sliderfield-thumb-border-radius: 50%;
            --amplify-components-sliderfield-thumb-border-width: var(--amplify-border-widths-medium);
            --amplify-components-sliderfield-thumb-border-color: var(--amplify-colors-border-primary);
            --amplify-components-sliderfield-thumb-border-style: solid;
            --amplify-components-sliderfield-thumb-disabled-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-sliderfield-thumb-disabled-border-color: transparent;
            --amplify-components-sliderfield-thumb-disabled-box-shadow: none;
            --amplify-components-sliderfield-thumb-hover-background-color: var(--amplify-colors-background-primary);
            --amplify-components-sliderfield-thumb-hover-border-color: var(--amplify-colors-border-focus);
            --amplify-components-sliderfield-thumb-focus-border-color: var(--amplify-colors-border-focus);
            --amplify-components-sliderfield-thumb-focus-box-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
            --amplify-components-sliderfield-small-track-height: 0.25rem;
            --amplify-components-sliderfield-small-thumb-width: 1rem;
            --amplify-components-sliderfield-small-thumb-height: 1rem;
            --amplify-components-sliderfield-large-track-height: 0.625rem;
            --amplify-components-sliderfield-large-thumb-width: 1.5rem;
            --amplify-components-sliderfield-large-thumb-height: 1.5rem;
            --amplify-components-stepperfield-border-color: var(--amplify-components-fieldcontrol-border-color);
            --amplify-components-stepperfield-flex-direction: column;
            --amplify-components-stepperfield-input-color: var(--amplify-components-fieldcontrol-color);
            --amplify-components-stepperfield-input-font-size: var(--amplify-components-fieldcontrol-font-size);
            --amplify-components-stepperfield-input-text-align: center;
            --amplify-components-stepperfield-button-color: var(--amplify-components-button-color);
            --amplify-components-stepperfield-button-background-color: var(--amplify-colors-transparent);
            --amplify-components-stepperfield-button-active-color: var(--amplify-components-button-active-color);
            --amplify-components-stepperfield-button-active-background-color: var(--amplify-components-button-active-background-color);
            --amplify-components-stepperfield-button-focus-color: var(--amplify-components-button-focus-color);
            --amplify-components-stepperfield-button-focus-background-color: var(--amplify-components-button-focus-background-color);
            --amplify-components-stepperfield-button-disabled-color: var(--amplify-components-button-disabled-color);
            --amplify-components-stepperfield-button-disabled-background-color: var(--amplify-components-fieldcontrol-disabled-background-color);
            --amplify-components-stepperfield-button-hover-color: var(--amplify-components-button-hover-color);
            --amplify-components-stepperfield-button-hover-background-color: var(--amplify-components-button-hover-background-color);
            --amplify-components-storagemanager-dropzone-background-color: var(--amplify-colors-background-primary);
            --amplify-components-storagemanager-dropzone-border-radius: var(--amplify-radii-small);
            --amplify-components-storagemanager-dropzone-border-color: var(--amplify-colors-border-primary);
            --amplify-components-storagemanager-dropzone-border-style: dashed;
            --amplify-components-storagemanager-dropzone-border-width: var(--amplify-border-widths-small);
            --amplify-components-storagemanager-dropzone-gap: var(--amplify-space-small);
            --amplify-components-storagemanager-dropzone-padding-block: var(--amplify-space-xl);
            --amplify-components-storagemanager-dropzone-padding-inline: var(--amplify-space-large);
            --amplify-components-storagemanager-dropzone-text-align: center;
            --amplify-components-storagemanager-dropzone-active-background-color: var(--amplify-colors-primary-10);
            --amplify-components-storagemanager-dropzone-active-border-radius: var(--amplify-components-storagemanager-dropzone-border-radius);
            --amplify-components-storagemanager-dropzone-active-border-color: var(--amplify-colors-border-pressed);
            --amplify-components-storagemanager-dropzone-active-border-style: var(--amplify-components-storagemanager-dropzone-border-style);
            --amplify-components-storagemanager-dropzone-active-border-width: var(--amplify-border-widths-medium);
            --amplify-components-storagemanager-dropzone-icon-color: var(--amplify-colors-border-primary);
            --amplify-components-storagemanager-dropzone-icon-font-size: var(--amplify-font-sizes-xxl);
            --amplify-components-storagemanager-dropzone-text-color: var(--amplify-colors-font-tertiary);
            --amplify-components-storagemanager-dropzone-text-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-storagemanager-dropzone-text-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-storagemanager-file-background-color: var(--amplify-colors-background-primary);
            --amplify-components-storagemanager-file-border-radius: var(--amplify-radii-small);
            --amplify-components-storagemanager-file-border-color: var(--amplify-colors-border-primary);
            --amplify-components-storagemanager-file-border-style: solid;
            --amplify-components-storagemanager-file-border-width: var(--amplify-border-widths-small);
            --amplify-components-storagemanager-file-padding-block: var(--amplify-space-xs);
            --amplify-components-storagemanager-file-padding-inline: var(--amplify-space-small);
            --amplify-components-storagemanager-file-gap: var(--amplify-space-small);
            --amplify-components-storagemanager-file-align-items: baseline;
            --amplify-components-storagemanager-file-name-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-storagemanager-file-name-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-storagemanager-file-name-color: var(--amplify-colors-font-primary);
            --amplify-components-storagemanager-file-size-font-size: var(--amplify-font-sizes-small);
            --amplify-components-storagemanager-file-size-font-weight: var(--amplify-font-weights-normal);
            --amplify-components-storagemanager-file-size-color: var(--amplify-colors-font-tertiary);
            --amplify-components-storagemanager-file-image-width: var(--amplify-space-xxl);
            --amplify-components-storagemanager-file-image-height: var(--amplify-space-xxl);
            --amplify-components-storagemanager-file-image-background-color: var(--amplify-colors-background-secondary);
            --amplify-components-storagemanager-file-image-color: var(--amplify-colors-font-tertiary);
            --amplify-components-storagemanager-file-image-border-radius: var(--amplify-radii-small);
            --amplify-components-storagemanager-filelist-flex-direction: column;
            --amplify-components-storagemanager-filelist-gap: var(--amplify-space-small);
            --amplify-components-storagemanager-loader-stroke-linecap: round;
            --amplify-components-storagemanager-loader-stroke-empty: var(--amplify-colors-border-secondary);
            --amplify-components-storagemanager-loader-stroke-filled: var(--amplify-components-loader-stroke-filled);
            --amplify-components-storagemanager-loader-stroke-width: var(--amplify-border-widths-large);
            --amplify-components-storagemanager-previewer-background-color: var(--amplify-colors-background-primary);
            --amplify-components-storagemanager-previewer-border-color: var(--amplify-colors-border-primary);
            --amplify-components-storagemanager-previewer-border-style: solid;
            --amplify-components-storagemanager-previewer-border-width: var(--amplify-border-widths-small);
            --amplify-components-storagemanager-previewer-border-radius: var(--amplify-radii-small);
            --amplify-components-storagemanager-previewer-padding-block: var(--amplify-space-zero);
            --amplify-components-storagemanager-previewer-padding-inline: var(--amplify-space-zero);
            --amplify-components-storagemanager-previewer-max-height: 40rem;
            --amplify-components-storagemanager-previewer-max-width: auto;
            --amplify-components-storagemanager-previewer-text-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-storagemanager-previewer-text-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-storagemanager-previewer-text-color: var(--amplify-colors-font-primary);
            --amplify-components-storagemanager-previewer-body-padding-block: var(--amplify-space-medium);
            --amplify-components-storagemanager-previewer-body-padding-inline: var(--amplify-space-medium);
            --amplify-components-storagemanager-previewer-body-gap: var(--amplify-space-small);
            --amplify-components-storagemanager-previewer-footer-justify-content: flex-end;
            --amplify-components-switchfield-disabled-opacity: var(--amplify-opacities-60);
            --amplify-components-switchfield-focused-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
            --amplify-components-switchfield-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-switchfield-large-font-size: var(--amplify-font-sizes-large);
            --amplify-components-switchfield-small-font-size: var(--amplify-font-sizes-small);
            --amplify-components-switchfield-label-padding: var(--amplify-space-xs);
            --amplify-components-switchfield-thumb-background-color: var(--amplify-colors-background-primary);
            --amplify-components-switchfield-thumb-border-color: transparent;
            --amplify-components-switchfield-thumb-border-width: var(--amplify-border-widths-small);
            --amplify-components-switchfield-thumb-border-style: solid;
            --amplify-components-switchfield-thumb-border-radius: var(--amplify-radii-xxxl);
            --amplify-components-switchfield-thumb-checked-transform: var(--amplify-transforms-slide-x-medium);
            --amplify-components-switchfield-thumb-transition-duration: var(--amplify-time-medium);
            --amplify-components-switchfield-thumb-width: var(--amplify-space-relative-medium);
            --amplify-components-switchfield-track-background-color: var(--amplify-colors-background-quaternary);
            --amplify-components-switchfield-track-border-radius: var(--amplify-radii-xxxl);
            --amplify-components-switchfield-track-checked-background-color: var(--amplify-colors-primary-80);
            --amplify-components-switchfield-track-height: var(--amplify-space-relative-medium);
            --amplify-components-switchfield-track-padding: var(--amplify-outline-widths-medium);
            --amplify-components-switchfield-track-transition-duration: var(--amplify-time-short);
            --amplify-components-switchfield-track-width: var(--amplify-space-relative-xl);
            --amplify-components-switchfield-track-error-background-color: var(--amplify-colors-background-error);
            --amplify-components-table-border-collapse: collapse;
            --amplify-components-table-display: table;
            --amplify-components-table-width: 100%;
            --amplify-components-table-head-display: table-header-group;
            --amplify-components-table-head-vertical-align: middle;
            --amplify-components-table-body-display: table-row-group;
            --amplify-components-table-body-vertical-align: middle;
            --amplify-components-table-foot-display: table-footer-group;
            --amplify-components-table-foot-vertical-align: middle;
            --amplify-components-table-row-display: table-row;
            --amplify-components-table-row-vertical-align: middle;
            --amplify-components-table-row-hover-background-color: var(--amplify-colors-background-tertiary);
            --amplify-components-table-row-striped-background-color: var(--amplify-colors-background-secondary);
            --amplify-components-table-header-border-color: var(--amplify-colors-border-tertiary);
            --amplify-components-table-header-border-style: solid;
            --amplify-components-table-header-border-width: var(--amplify-border-widths-small);
            --amplify-components-table-header-color: var(--amplify-colors-font-primary);
            --amplify-components-table-header-display: table-cell;
            --amplify-components-table-header-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-table-header-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-table-header-padding: var(--amplify-space-medium);
            --amplify-components-table-header-vertical-align: middle;
            --amplify-components-table-header-large-font-size: var(--amplify-font-sizes-large);
            --amplify-components-table-header-large-padding: var(--amplify-space-large);
            --amplify-components-table-header-small-font-size: var(--amplify-font-sizes-small);
            --amplify-components-table-header-small-padding: var(--amplify-space-xs);
            --amplify-components-table-data-border-color: var(--amplify-colors-border-tertiary);
            --amplify-components-table-data-border-style: solid;
            --amplify-components-table-data-border-width: var(--amplify-border-widths-small);
            --amplify-components-table-data-color: var(--amplify-colors-font-primary);
            --amplify-components-table-data-display: table-cell;
            --amplify-components-table-data-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-table-data-font-weight: var(--amplify-font-weights-normal);
            --amplify-components-table-data-padding: var(--amplify-space-medium);
            --amplify-components-table-data-vertical-align: middle;
            --amplify-components-table-data-large-font-size: var(--amplify-font-sizes-large);
            --amplify-components-table-data-large-padding: var(--amplify-space-large);
            --amplify-components-table-data-small-font-size: var(--amplify-font-sizes-small);
            --amplify-components-table-data-small-padding: var(--amplify-space-xs);
            --amplify-components-table-caption-caption-side: bottom;
            --amplify-components-table-caption-color: var(--amplify-colors-font-primary);
            --amplify-components-table-caption-display: table-caption;
            --amplify-components-table-caption-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-table-caption-text-align: center;
            --amplify-components-table-caption-word-break: break-all;
            --amplify-components-table-caption-large-font-size: var(--amplify-font-sizes-large);
            --amplify-components-table-caption-small-font-size: var(--amplify-font-sizes-small);
            --amplify-components-tabs-background-color: transparent;
            --amplify-components-tabs-border-color: var(--amplify-colors-border-secondary);
            --amplify-components-tabs-border-style: solid;
            --amplify-components-tabs-border-width: var(--amplify-border-widths-medium);
            --amplify-components-tabs-gap: 0;
            --amplify-components-tabs-item-background-color: transparent;
            --amplify-components-tabs-item-border-color: var(--amplify-colors-border-secondary);
            --amplify-components-tabs-item-border-style: solid;
            --amplify-components-tabs-item-border-width: var(--amplify-border-widths-medium);
            --amplify-components-tabs-item-color: var(--amplify-colors-font-secondary);
            --amplify-components-tabs-item-font-size: var(--amplify-font-sizes-medium);
            --amplify-components-tabs-item-font-weight: var(--amplify-font-weights-bold);
            --amplify-components-tabs-item-padding-vertical: var(--amplify-space-small);
            --amplify-components-tabs-item-padding-horizontal: var(--amplify-space-medium);
            --amplify-components-tabs-item-text-align: center;
            --amplify-components-tabs-item-transition-duration: var(--amplify-time-medium);
            --amplify-components-tabs-item-hover-background-color: transparent;
            --amplify-components-tabs-item-hover-border-color: var(--amplify-colors-border-focus);
            --amplify-components-tabs-item-hover-box-shadow: none;
            --amplify-components-tabs-item-hover-color: var(--amplify-colors-font-hover);
            --amplify-components-tabs-item-focus-background-color: transparent;
            --amplify-components-tabs-item-focus-border-color: var(--amplify-colors-border-focus);
            --amplify-components-tabs-item-focus-box-shadow: 0px 0px 0px var(--amplify-border-widths-medium) var(--amplify-colors-border-focus);
            --amplify-components-tabs-item-focus-color: var(--amplify-colors-font-focus);
            --amplify-components-tabs-item-active-background-color: transparent;
            --amplify-components-tabs-item-active-border-color: var(--amplify-colors-font-interactive);
            --amplify-components-tabs-item-active-box-shadow: none;
            --amplify-components-tabs-item-active-color: var(--amplify-colors-font-interactive);
            --amplify-components-tabs-item-disabled-background-color: transparent;
            --amplify-components-tabs-item-disabled-border-color: var(--amplify-colors-border-tertiary);
            --amplify-components-tabs-item-disabled-box-shadow: none;
            --amplify-components-tabs-item-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-tabs-panel-background-color: transparent;
            --amplify-components-tabs-panel-padding-inline: 0;
            --amplify-components-tabs-panel-padding-block: var(--amplify-space-small);
            --amplify-components-text-color: var(--amplify-colors-font-primary);
            --amplify-components-text-primary-color: var(--amplify-colors-font-primary);
            --amplify-components-text-secondary-color: var(--amplify-colors-font-secondary);
            --amplify-components-text-tertiary-color: var(--amplify-colors-font-tertiary);
            --amplify-components-text-error-color: var(--amplify-colors-font-error);
            --amplify-components-text-warning-color: var(--amplify-colors-font-warning);
            --amplify-components-text-success-color: var(--amplify-colors-font-success);
            --amplify-components-text-info-color: var(--amplify-colors-font-info);
            --amplify-components-textareafield-color: var(--amplify-components-fieldcontrol-color);
            --amplify-components-textareafield-border-color: var(--amplify-components-fieldcontrol-border-color);
            --amplify-components-textareafield-focus-border-color: var(--amplify-components-fieldcontrol-focus-border-color);
            --amplify-components-textfield-color: var(--amplify-components-fieldcontrol-color);
            --amplify-components-textfield-border-color: var(--amplify-components-fieldcontrol-border-color);
            --amplify-components-textfield-font-size: var(--amplify-components-fieldcontrol-font-size);
            --amplify-components-textfield-focus-border-color: var(--amplify-components-fieldcontrol-focus-border-color);
            --amplify-components-togglebutton-border-color: var(--amplify-colors-border-primary);
            --amplify-components-togglebutton-color: var(--amplify-colors-font-primary);
            --amplify-components-togglebutton-hover-background-color: var(--amplify-colors-overlay-10);
            --amplify-components-togglebutton-focus-border-color: var(--amplify-colors-border-focus);
            --amplify-components-togglebutton-focus-color: var(--amplify-colors-font-primary);
            --amplify-components-togglebutton-active-background-color: var(--amplify-colors-transparent);
            --amplify-components-togglebutton-disabled-background-color: var(--amplify-colors-transparent);
            --amplify-components-togglebutton-disabled-border-color: var(--amplify-colors-border-disabled);
            --amplify-components-togglebutton-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-togglebutton-pressed-border-color: var(--amplify-colors-border-pressed);
            --amplify-components-togglebutton-pressed-color: var(--amplify-colors-font-primary);
            --amplify-components-togglebutton-pressed-background-color: var(--amplify-colors-overlay-20);
            --amplify-components-togglebutton-pressed-hover-background-color: var(--amplify-colors-overlay-30);
            --amplify-components-togglebutton-primary-background-color: var(--amplify-colors-transparent);
            --amplify-components-togglebutton-primary-border-width: var(--amplify-border-widths-small);
            --amplify-components-togglebutton-primary-focus-border-color: var(--amplify-colors-border-focus);
            --amplify-components-togglebutton-primary-focus-background-color: var(--amplify-colors-transparent);
            --amplify-components-togglebutton-primary-focus-box-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
            --amplify-components-togglebutton-primary-focus-color: var(--amplify-colors-font-primary);
            --amplify-components-togglebutton-primary-hover-background-color: var(--amplify-colors-overlay-10);
            --amplify-components-togglebutton-primary-hover-color: var(--amplify-colors-font-primary);
            --amplify-components-togglebutton-primary-disabled-border-color: var(--amplify-colors-border-disabled);
            --amplify-components-togglebutton-primary-disabled-background-color: var(--amplify-colors-background-disabled);
            --amplify-components-togglebutton-primary-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-togglebutton-primary-pressed-background-color: var(--amplify-colors-primary-80);
            --amplify-components-togglebutton-primary-pressed-border-color: var(--amplify-colors-primary-80);
            --amplify-components-togglebutton-primary-pressed-color: var(--amplify-colors-background-primary);
            --amplify-components-togglebutton-primary-pressed-focus-background-color: var(--amplify-colors-border-focus);
            --amplify-components-togglebutton-primary-pressed-focus-border-color: var(--amplify-colors-border-focus);
            --amplify-components-togglebutton-primary-pressed-focus-color: var(--amplify-colors-background-primary);
            --amplify-components-togglebutton-primary-pressed-hover-border-color: var(--amplify-colors-primary-60);
            --amplify-components-togglebutton-primary-pressed-hover-background-color: var(--amplify-colors-primary-60);
            --amplify-components-togglebutton-primary-pressed-hover-box-shadow: var(--amplify-colors-primary-60);
            --amplify-components-togglebutton-primary-pressed-hover-color: var(--amplify-colors-background-primary);
            --amplify-components-togglebutton-link-background-color: var(--amplify-colors-transparent);
            --amplify-components-togglebutton-link-color: var(--amplify-colors-overlay-50);
            --amplify-components-togglebutton-link-hover-background-color: var(--amplify-colors-transparent);
            --amplify-components-togglebutton-link-hover-color: var(--amplify-colors-overlay-50);
            --amplify-components-togglebutton-link-focus-background-color: var(--amplify-colors-transparent);
            --amplify-components-togglebutton-link-focus-color: var(--amplify-colors-overlay-50);
            --amplify-components-togglebutton-link-disabled-background-color: var(--amplify-colors-transparent);
            --amplify-components-togglebutton-link-disabled-color: var(--amplify-colors-font-disabled);
            --amplify-components-togglebutton-link-pressed-background-color: var(--amplify-colors-transparent);
            --amplify-components-togglebutton-link-pressed-color: var(--amplify-colors-overlay-90);
            --amplify-components-togglebutton-link-pressed-focus-background-color: var(--amplify-colors-transparent);
            --amplify-components-togglebutton-link-pressed-focus-color: var(--amplify-colors-overlay-90);
            --amplify-components-togglebutton-link-pressed-hover-color: var(--amplify-colors-overlay-90);
            --amplify-components-togglebutton-link-pressed-hover-background-color: var(--amplify-colors-transparent);
            --amplify-components-togglebuttongroup-align-items: center;
            --amplify-components-togglebuttongroup-align-content: center;
            --amplify-components-togglebuttongroup-justify-content: flex-start;
            --amplify-border-widths-small: 1px;
            --amplify-border-widths-medium: 2px;
            --amplify-border-widths-large: 3px;
            --amplify-colors-red-10: hsl(0, 75%, 95%);
            --amplify-colors-red-20: hsl(0, 75%, 85%);
            --amplify-colors-red-40: hsl(0, 75%, 75%);
            --amplify-colors-red-60: hsl(0, 50%, 50%);
            --amplify-colors-red-80: hsl(0, 95%, 30%);
            --amplify-colors-red-90: hsl(0, 100%, 20%);
            --amplify-colors-red-100: hsl(0, 100%, 15%);
            --amplify-colors-orange-10: hsl(30, 75%, 95%);
            --amplify-colors-orange-20: hsl(30, 75%, 85%);
            --amplify-colors-orange-40: hsl(30, 75%, 75%);
            --amplify-colors-orange-60: hsl(30, 50%, 50%);
            --amplify-colors-orange-80: hsl(30, 95%, 30%);
            --amplify-colors-orange-90: hsl(30, 100%, 20%);
            --amplify-colors-orange-100: hsl(30, 100%, 15%);
            --amplify-colors-yellow-10: hsl(60, 75%, 95%);
            --amplify-colors-yellow-20: hsl(60, 75%, 85%);
            --amplify-colors-yellow-40: hsl(60, 75%, 75%);
            --amplify-colors-yellow-60: hsl(60, 50%, 50%);
            --amplify-colors-yellow-80: hsl(60, 95%, 30%);
            --amplify-colors-yellow-90: hsl(60, 100%, 20%);
            --amplify-colors-yellow-100: hsl(60, 100%, 15%);
            --amplify-colors-green-10: hsl(130, 60%, 95%);
            --amplify-colors-green-20: hsl(130, 60%, 90%);
            --amplify-colors-green-40: hsl(130, 44%, 63%);
            --amplify-colors-green-60: hsl(130, 43%, 46%);
            --amplify-colors-green-80: hsl(130, 33%, 37%);
            --amplify-colors-green-90: hsl(130, 27%, 29%);
            --amplify-colors-green-100: hsl(130, 22%, 23%);
            --amplify-colors-teal-10: hsl(190, 75%, 95%);
            --amplify-colors-teal-20: hsl(190, 75%, 85%);
            --amplify-colors-teal-40: hsl(190, 70%, 70%);
            --amplify-colors-teal-60: hsl(190, 50%, 50%);
            --amplify-colors-teal-80: hsl(190, 95%, 30%);
            --amplify-colors-teal-90: hsl(190, 100%, 20%);
            --amplify-colors-teal-100: hsl(190, 100%, 15%);
            --amplify-colors-blue-10: hsl(220, 95%, 95%);
            --amplify-colors-blue-20: hsl(220, 85%, 85%);
            --amplify-colors-blue-40: hsl(220, 70%, 70%);
            --amplify-colors-blue-60: hsl(220, 50%, 50%);
            --amplify-colors-blue-80: hsl(220, 95%, 30%);
            --amplify-colors-blue-90: hsl(220, 100%, 20%);
            --amplify-colors-blue-100: hsl(220, 100%, 15%);
            --amplify-colors-purple-10: hsl(300, 95%, 95%);
            --amplify-colors-purple-20: hsl(300, 85%, 85%);
            --amplify-colors-purple-40: hsl(300, 70%, 70%);
            --amplify-colors-purple-60: hsl(300, 50%, 50%);
            --amplify-colors-purple-80: hsl(300, 95%, 30%);
            --amplify-colors-purple-90: hsl(300, 100%, 20%);
            --amplify-colors-purple-100: hsl(300, 100%, 15%);
            --amplify-colors-pink-10: hsl(340, 95%, 95%);
            --amplify-colors-pink-20: hsl(340, 90%, 85%);
            --amplify-colors-pink-40: hsl(340, 70%, 70%);
            --amplify-colors-pink-60: hsl(340, 50%, 50%);
            --amplify-colors-pink-80: hsl(340, 95%, 30%);
            --amplify-colors-pink-90: hsl(340, 100%, 20%);
            --amplify-colors-pink-100: hsl(340, 100%, 15%);
            --amplify-colors-neutral-10: hsl(210, 5%, 98%);
            --amplify-colors-neutral-20: hsl(210, 5%, 94%);
            --amplify-colors-neutral-40: hsl(210, 5%, 87%);
            --amplify-colors-neutral-60: hsl(210, 10%, 58%);
            --amplify-colors-neutral-80: hsl(210, 10%, 40%);
            --amplify-colors-neutral-90: hsl(210, 25%, 25%);
            --amplify-colors-neutral-100: hsl(210, 50%, 10%);
            --amplify-colors-primary-10: var(--amplify-colors-teal-10);
            --amplify-colors-primary-20: var(--amplify-colors-teal-20);
            --amplify-colors-primary-40: var(--amplify-colors-teal-40);
            --amplify-colors-primary-60: var(--amplify-colors-teal-60);
            --amplify-colors-primary-80: var(--amplify-colors-teal-80);
            --amplify-colors-primary-90: var(--amplify-colors-teal-90);
            --amplify-colors-primary-100: var(--amplify-colors-teal-100);
            --amplify-colors-secondary-10: var(--amplify-colors-purple-10);
            --amplify-colors-secondary-20: var(--amplify-colors-purple-20);
            --amplify-colors-secondary-40: var(--amplify-colors-purple-40);
            --amplify-colors-secondary-60: var(--amplify-colors-purple-60);
            --amplify-colors-secondary-80: var(--amplify-colors-purple-80);
            --amplify-colors-secondary-90: var(--amplify-colors-purple-90);
            --amplify-colors-secondary-100: var(--amplify-colors-purple-100);
            --amplify-colors-font-primary: var(--amplify-colors-neutral-100);
            --amplify-colors-font-secondary: var(--amplify-colors-neutral-90);
            --amplify-colors-font-tertiary: var(--amplify-colors-neutral-80);
            --amplify-colors-font-disabled: var(--amplify-colors-neutral-60);
            --amplify-colors-font-inverse: var(--amplify-colors-white);
            --amplify-colors-font-interactive: var(--amplify-colors-primary-80);
            --amplify-colors-font-hover: var(--amplify-colors-primary-90);
            --amplify-colors-font-focus: var(--amplify-colors-primary-100);
            --amplify-colors-font-active: var(--amplify-colors-primary-100);
            --amplify-colors-font-info: var(--amplify-colors-blue-90);
            --amplify-colors-font-warning: var(--amplify-colors-orange-90);
            --amplify-colors-font-error: var(--amplify-colors-red-90);
            --amplify-colors-font-success: var(--amplify-colors-green-90);
            --amplify-colors-background-primary: var(--amplify-colors-white);
            --amplify-colors-background-secondary: var(--amplify-colors-neutral-10);
            --amplify-colors-background-tertiary: var(--amplify-colors-neutral-20);
            --amplify-colors-background-quaternary: var(--amplify-colors-neutral-60);
            --amplify-colors-background-disabled: var(--amplify-colors-background-tertiary);
            --amplify-colors-background-info: var(--amplify-colors-blue-10);
            --amplify-colors-background-warning: var(--amplify-colors-orange-10);
            --amplify-colors-background-error: var(--amplify-colors-red-10);
            --amplify-colors-background-success: var(--amplify-colors-green-10);
            --amplify-colors-border-primary: var(--amplify-colors-neutral-60);
            --amplify-colors-border-secondary: var(--amplify-colors-neutral-40);
            --amplify-colors-border-tertiary: var(--amplify-colors-neutral-20);
            --amplify-colors-border-disabled: var(--amplify-colors-border-tertiary);
            --amplify-colors-border-pressed: var(--amplify-colors-primary-100);
            --amplify-colors-border-focus: var(--amplify-colors-primary-100);
            --amplify-colors-border-error: var(--amplify-colors-red-80);
            --amplify-colors-border-info: var(--amplify-colors-blue-80);
            --amplify-colors-border-success: var(--amplify-colors-green-80);
            --amplify-colors-border-warning: var(--amplify-colors-orange-80);
            --amplify-colors-shadow-primary: hsla(210, 50%, 10%, 0.25);
            --amplify-colors-shadow-secondary: hsla(210, 50%, 10%, 0.15);
            --amplify-colors-shadow-tertiary: hsla(210, 50%, 10%, 0.05);
            --amplify-colors-overlay-5: hsla(0, 0%, 0%, 0.05);
            --amplify-colors-overlay-10: hsla(0, 0%, 0%, 0.1);
            --amplify-colors-overlay-20: hsla(0, 0%, 0%, 0.2);
            --amplify-colors-overlay-30: hsla(0, 0%, 0%, 0.3);
            --amplify-colors-overlay-40: hsla(0, 0%, 0%, 0.4);
            --amplify-colors-overlay-50: hsla(0, 0%, 0%, 0.5);
            --amplify-colors-overlay-60: hsla(0, 0%, 0%, 0.6);
            --amplify-colors-overlay-70: hsla(0, 0%, 0%, 0.7);
            --amplify-colors-overlay-80: hsla(0, 0%, 0%, 0.8);
            --amplify-colors-overlay-90: hsla(0, 0%, 0%, 0.9);
            --amplify-colors-black: hsl(0, 0%, 0%);
            --amplify-colors-white: hsl(0, 0%, 100%);
            --amplify-colors-transparent: transparent;
            --amplify-fonts-default-variable: "InterVariable", "Inter var", "Inter", -apple-system, BlinkMacSystemFont,
            "Helvetica Neue", "Segoe UI", Oxygen, Ubuntu, Cantarell, "Open Sans",
            sans-serif;
            --amplify-fonts-default-static: "Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue",
            "Segoe UI", Oxygen, Ubuntu, Cantarell, "Open Sans", sans-serif;
            --amplify-font-sizes-xxxs: 0.375rem;
            --amplify-font-sizes-xxs: 0.5rem;
            --amplify-font-sizes-xs: 0.75rem;
            --amplify-font-sizes-small: 0.875rem;
            --amplify-font-sizes-medium: 1rem;
            --amplify-font-sizes-large: 1.25rem;
            --amplify-font-sizes-xl: 1.5rem;
            --amplify-font-sizes-xxl: 2rem;
            --amplify-font-sizes-xxxl: 2.5rem;
            --amplify-font-sizes-xxxxl: 3rem;
            --amplify-font-weights-hairline: 100;
            --amplify-font-weights-thin: 200;
            --amplify-font-weights-light: 300;
            --amplify-font-weights-normal: 400;
            --amplify-font-weights-medium: 500;
            --amplify-font-weights-semibold: 600;
            --amplify-font-weights-bold: 700;
            --amplify-font-weights-extrabold: 800;
            --amplify-font-weights-black: 900;
            --amplify-line-heights-small: 1.25;
            --amplify-line-heights-medium: 1.5;
            --amplify-line-heights-large: 2;
            --amplify-opacities-0: 0;
            --amplify-opacities-10: 0.1;
            --amplify-opacities-20: 0.2;
            --amplify-opacities-30: 0.3;
            --amplify-opacities-40: 0.4;
            --amplify-opacities-50: 0.5;
            --amplify-opacities-60: 0.6;
            --amplify-opacities-70: 0.7;
            --amplify-opacities-80: 0.8;
            --amplify-opacities-90: 0.9;
            --amplify-opacities-100: 1;
            --amplify-outline-offsets-small: 1px;
            --amplify-outline-offsets-medium: 2px;
            --amplify-outline-offsets-large: 3px;
            --amplify-outline-widths-small: 1px;
            --amplify-outline-widths-medium: 2px;
            --amplify-outline-widths-large: 3px;
            --amplify-radii-xs: 0.125rem;
            --amplify-radii-small: 0.25rem;
            --amplify-radii-medium: 0.5rem;
            --amplify-radii-large: 1rem;
            --amplify-radii-xl: 2rem;
            --amplify-radii-xxl: 4rem;
            --amplify-radii-xxxl: 8rem;
            --amplify-shadows-small: 0px 2px 4px var(--amplify-colors-shadow-tertiary);
            --amplify-shadows-medium: 0px 2px 6px var(--amplify-colors-shadow-secondary);
            --amplify-shadows-large: 0px 4px 12px var(--amplify-colors-shadow-primary);
            --amplify-space-zero: 0;
            --amplify-space-xxxs: 0.25rem;
            --amplify-space-xxs: 0.375rem;
            --amplify-space-xs: 0.5rem;
            --amplify-space-small: 0.75rem;
            --amplify-space-medium: 1rem;
            --amplify-space-large: 1.5rem;
            --amplify-space-xl: 2.0rem;
            --amplify-space-xxl: 3.0rem;
            --amplify-space-xxxl: 4.5rem;
            --amplify-space-relative-xxxs: 0.25em;
            --amplify-space-relative-xxs: 0.375em;
            --amplify-space-relative-xs: 0.5em;
            --amplify-space-relative-small: 0.75em;
            --amplify-space-relative-medium: 1em;
            --amplify-space-relative-large: 1.5em;
            --amplify-space-relative-xl: 2.0em;
            --amplify-space-relative-xxl: 3.0em;
            --amplify-space-relative-xxxl: 4.5em;
            --amplify-space-relative-full: 100%;
            --amplify-time-short: 100ms;
            --amplify-time-medium: 250ms;
            --amplify-time-long: 500ms;
            --amplify-transforms-slide-x-small: translateX(0.5em);
            --amplify-transforms-slide-x-medium: translateX(1em);
            --amplify-transforms-slide-x-large: translateX(2em);
          }

          html,
          [data-amplify-theme] {
            font-family: var(--amplify-fonts-default-static);
          }

          @supports (font-variation-settings: normal) {
            html,
            [data-amplify-theme] {
              font-family: var(--amplify-fonts-default-variable);
            }
          }
          html:focus-within {
            scroll-behavior: smooth;
          }

          body {
            min-height: 100vh;
            text-rendering: optimizeSpeed;
            line-height: var(--amplify-line-heights-medium);
          }

          * {
            box-sizing: border-box;
          }

          input,
          button,
          textarea,
          select {
            font: inherit;
          }

          @media (prefers-reduced-motion: reduce) {
            html:focus-within {
              scroll-behavior: auto;
            }
          }
          [class*=amplify] {
            all: unset; /* protect against external styles */
            box-sizing: border-box; /* set box-sizing after unset above */
          }

          .amplify-flex {
            align-content: var(--amplify-components-flex-align-content);
            align-items: var(--amplify-components-flex-align-items);
            display: flex;
            flex-wrap: var(--amplify-components-flex-flex-wrap);
            gap: var(--amplify-components-flex-gap);
            justify-content: var(--amplify-components-flex-justify-content);
          }

          .amplify-grid {
            display: grid;
          }

          .amplify-scrollview {
            display: block;
            overflow: auto;
          }

          .amplify-text {
            display: block;
            color: var(--amplify-components-text-color);
          }
          b.amplify-text,
          em.amplify-text,
          i.amplify-text,
          span.amplify-text,
          strong.amplify-text {
            display: inline;
          }

          .amplify-text--truncated {
            display: inline-block;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .amplify-text--primary {
            color: var(--amplify-components-text-primary-color);
          }
          .amplify-text--secondary {
            color: var(--amplify-components-text-secondary-color);
          }
          .amplify-text--tertiary {
            color: var(--amplify-components-text-tertiary-color);
          }
          .amplify-text--error {
            color: var(--amplify-components-text-error-color);
          }
          .amplify-text--info {
            color: var(--amplify-components-text-info-color);
          }
          .amplify-text--success {
            color: var(--amplify-components-text-success-color);
          }
          .amplify-text--warning {
            color: var(--amplify-components-text-warning-color);
          }

          .amplify-badge {
            background-color: var(--amplify-components-badge-background-color);
            border-radius: var(--amplify-components-badge-border-radius);
            color: var(--amplify-components-badge-color);
            display: inline-flex;
            font-size: var(--amplify-components-badge-font-size);
            font-weight: var(--amplify-components-badge-font-weight);
            line-height: var(--amplify-components-badge-line-height);
            padding: var(--amplify-components-badge-padding-vertical) var(--amplify-components-badge-padding-horizontal);
            text-align: var(--amplify-components-badge-text-align);
          }
          .amplify-badge--info {
            color: var(--amplify-components-badge-info-color);
            background-color: var(--amplify-components-badge-info-background-color);
          }
          .amplify-badge--error {
            color: var(--amplify-components-badge-error-color);
            background-color: var(--amplify-components-badge-error-background-color);
          }
          .amplify-badge--warning {
            color: var(--amplify-components-badge-warning-color);
            background-color: var(--amplify-components-badge-warning-background-color);
          }
          .amplify-badge--success {
            color: var(--amplify-components-badge-success-color);
            background-color: var(--amplify-components-badge-success-background-color);
          }
          .amplify-badge--small {
            font-size: var(--amplify-components-badge-small-font-size);
            padding: var(--amplify-components-badge-small-padding-vertical) var(--amplify-components-badge-small-padding-horizontal);
          }
          .amplify-badge--large {
            font-size: var(--amplify-components-badge-large-font-size);
            padding: var(--amplify-components-badge-large-padding-vertical) var(--amplify-components-badge-large-padding-horizontal);
          }

          /*
 * Button base styles
 */
          .amplify-button {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-border-color
            );
            --amplify-internal-button-color: var(--amplify-components-button-color);
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-focus-box-shadow
            );
            --amplify-internal-button-border-width: var(
              --amplify-components-button-border-width
            );
            align-items: center;
            background-color: var(--amplify-internal-button-background-color);
            border-color: var(--amplify-internal-button-border-color);
            border-radius: var(--amplify-components-button-border-radius);
            border-style: var(--amplify-components-button-border-style);
            border-width: var(--amplify-internal-button-border-width);
            box-sizing: border-box;
            color: var(--amplify-internal-button-color);
            cursor: pointer;
            display: inline-flex;
            font-size: var(--amplify-components-button-font-size);
            font-weight: var(--amplify-components-button-font-weight);
            justify-content: center;
            line-height: var(--amplify-components-button-line-height);
            padding-block-start: var(--amplify-components-button-padding-block-start);
            padding-block-end: var(--amplify-components-button-padding-block-end);
            padding-inline-start: var(--amplify-components-button-padding-inline-start);
            padding-inline-end: var(--amplify-components-button-padding-inline-end);
            transition: all var(--amplify-components-button-transition-duration);
            -webkit-user-select: none;
            -moz-user-select: none;
            user-select: none;
            --amplify-internal-button-disabled-color: var(
              --amplify-components-button-disabled-color
            );
            --amplify-internal-button-disabled-background-color: var(
              --amplify-components-button-disabled-background-color
            );
            --amplify-internal-button-disabled-border-color: var(
              --amplify-components-button-disabled-border-color
            );
            --amplify-internal-button-disabled-text-decoration: initial;
            --amplify-internal-button-loading-background-color: var(
              --amplify-components-button-loading-background-color
            );
            --amplify-internal-button-loading-border-color: var(
              --amplify-components-button-loading-border-color
            );
            --amplify-internal-button-loading-color: var(
              --amplify-components-button-loading-color
            );
            --amplify-internal-button-loading-text-decoration: initial;
          }
          .amplify-button:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-hover-color
            );
          }
          .amplify-button:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-focus-color
            );
            box-shadow: var(--amplify-internal-button-focus-box-shadow);
          }
          .amplify-button:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-active-color
            );
          }
          .amplify-button--fullwidth {
            width: 100%;
          }
          .amplify-button--outlined--info {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-info-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-info-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-info-color
            );
          }
          .amplify-button--outlined--info:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-info-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-info-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-info-hover-color
            );
          }
          .amplify-button--outlined--info:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-info-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-info-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-info-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-outlined-info-focus-box-shadow
            );
          }
          .amplify-button--outlined--info:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-info-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-info-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-info-active-color
            );
          }
          .amplify-button--outlined--warning {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-warning-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-warning-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-warning-color
            );
          }
          .amplify-button--outlined--warning:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-warning-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-warning-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-warning-hover-color
            );
          }
          .amplify-button--outlined--warning:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-warning-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-warning-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-warning-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-outlined-warning-focus-box-shadow
            );
          }
          .amplify-button--outlined--warning:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-warning-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-warning-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-warning-active-color
            );
          }
          .amplify-button--outlined--error {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-error-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-error-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-error-color
            );
          }
          .amplify-button--outlined--error:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-error-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-error-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-error-hover-color
            );
          }
          .amplify-button--outlined--error:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-error-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-error-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-error-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-outlined-error-focus-box-shadow
            );
          }
          .amplify-button--outlined--error:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-error-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-error-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-error-active-color
            );
          }
          .amplify-button--outlined--success {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-success-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-success-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-success-color
            );
          }
          .amplify-button--outlined--success:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-success-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-success-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-success-hover-color
            );
          }
          .amplify-button--outlined--success:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-success-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-success-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-success-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-outlined-success-focus-box-shadow
            );
          }
          .amplify-button--outlined--success:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-success-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-success-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-success-active-color
            );
          }
          .amplify-button--outlined--overlay {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-overlay-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-overlay-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-overlay-color
            );
          }
          .amplify-button--outlined--overlay:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-overlay-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-overlay-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-overlay-hover-color
            );
          }
          .amplify-button--outlined--overlay:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-overlay-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-overlay-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-overlay-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-outlined-overlay-focus-box-shadow
            );
          }
          .amplify-button--outlined--overlay:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-outlined-overlay-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-outlined-overlay-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-outlined-overlay-active-color
            );
          }
          .amplify-button--menu {
            border-width: var(--amplify-components-button-menu-border-width);
            background-color: var(--amplify-components-button-menu-background-color);
            justify-content: var(--amplify-components-button-menu-justify-content);
            --amplify-internal-button-disabled-color: var(
              --amplify-components-button-menu-disabled-color
            );
          }
          .amplify-button--menu:hover {
            color: var(--amplify-components-button-menu-hover-color);
            background-color: var(--amplify-components-button-menu-hover-background-color);
          }
          .amplify-button--menu:focus {
            box-shadow: none;
            color: var(--amplify-components-button-menu-focus-color);
            background-color: var(--amplify-components-button-menu-focus-background-color);
          }
          .amplify-button--menu:active {
            color: var(--amplify-components-button-menu-active-color);
            background-color: var(--amplify-components-button-menu-active-background-color);
          }
          .amplify-button--primary {
            --amplify-internal-button-border-width: var(
              --amplify-components-button-primary-border-width
            );
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-color
            );
            --amplify-internal-button-disabled-border-color: var(
              --amplify-components-button-primary-disabled-border-color
            );
            --amplify-internal-button-disabled-background-color: var(
              --amplify-components-button-primary-disabled-background-color
            );
            --amplify-internal-button-disabled-color: var(
              --amplify-components-button-primary-disabled-color
            );
            --amplify-internal-button-loading-background-color: var(
              --amplify-components-button-primary-loading-background-color
            );
            --amplify-internal-button-loading-border-color: var(
              --amplify-components-button-primary-loading-border-color
            );
            --amplify-internal-button-loading-color: var(
              --amplify-components-button-primary-loading-color
            );
          }
          .amplify-button--primary:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-hover-color
            );
          }
          .amplify-button--primary:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-primary-focus-box-shadow
            );
          }
          .amplify-button--primary:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-active-color
            );
          }
          .amplify-button--primary--info {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-info-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-info-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-info-color
            );
          }
          .amplify-button--primary--info:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-info-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-info-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-info-hover-color
            );
          }
          .amplify-button--primary--info:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-info-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-info-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-info-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-primary-info-focus-box-shadow
            );
          }
          .amplify-button--primary--info:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-info-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-info-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-info-active-color
            );
          }
          .amplify-button--primary--warning {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-warning-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-warning-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-warning-color
            );
          }
          .amplify-button--primary--warning:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-warning-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-warning-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-warning-hover-color
            );
          }
          .amplify-button--primary--warning:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-warning-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-warning-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-warning-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-primary-warning-focus-box-shadow
            );
          }
          .amplify-button--primary--warning:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-warning-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-warning-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-warning-active-color
            );
          }
          .amplify-button--primary--error {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-error-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-error-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-error-color
            );
          }
          .amplify-button--primary--error:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-error-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-error-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-error-hover-color
            );
          }
          .amplify-button--primary--error:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-error-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-error-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-error-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-primary-error-focus-box-shadow
            );
          }
          .amplify-button--primary--error:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-error-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-error-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-error-active-color
            );
          }
          .amplify-button--primary--success {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-success-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-success-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-success-color
            );
          }
          .amplify-button--primary--success:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-success-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-success-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-success-hover-color
            );
          }
          .amplify-button--primary--success:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-success-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-success-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-success-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-primary-success-focus-box-shadow
            );
          }
          .amplify-button--primary--success:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-success-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-success-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-success-active-color
            );
          }
          .amplify-button--primary--overlay {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-overlay-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-overlay-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-overlay-color
            );
          }
          .amplify-button--primary--overlay:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-overlay-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-overlay-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-overlay-hover-color
            );
          }
          .amplify-button--primary--overlay:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-overlay-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-overlay-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-overlay-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-primary-overlay-focus-box-shadow
            );
          }
          .amplify-button--primary--overlay:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-primary-overlay-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-primary-overlay-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-primary-overlay-active-color
            );
          }
          .amplify-button--link {
            --amplify-internal-button-border-width: var(
              --amplify-components-button-link-border-width
            );
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-color
            );
            --amplify-internal-button-disabled-border-color: var(
              --amplify-components-button-link-disabled-border-color
            );
            --amplify-internal-button-disabled-background-color: var(
              --amplify-components-button-link-disabled-background-color
            );
            --amplify-internal-button-disabled-color: var(
              --amplify-components-button-link-disabled-color
            );
            --amplify-internal-button-loading-background-color: var(
              --amplify-components-button-link-loading-background-color
            );
            --amplify-internal-button-loading-border-color: var(
              --amplify-components-button-link-loading-border-color
            );
            --amplify-internal-button-loading-color: var(
              --amplify-components-button-link-loading-color
            );
          }
          .amplify-button--link:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-hover-color
            );
          }
          .amplify-button--link:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-link-focus-box-shadow
            );
          }
          .amplify-button--link:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-active-color
            );
          }
          .amplify-button--link--info {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-info-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-info-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-info-color
            );
          }
          .amplify-button--link--info:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-info-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-info-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-info-hover-color
            );
          }
          .amplify-button--link--info:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-info-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-info-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-info-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-link-info-focus-box-shadow
            );
          }
          .amplify-button--link--info:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-info-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-info-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-info-active-color
            );
          }
          .amplify-button--link--warning {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-warning-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-warning-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-warning-color
            );
          }
          .amplify-button--link--warning:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-warning-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-warning-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-warning-hover-color
            );
          }
          .amplify-button--link--warning:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-warning-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-warning-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-warning-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-link-warning-focus-box-shadow
            );
          }
          .amplify-button--link--warning:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-warning-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-warning-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-warning-active-color
            );
          }
          .amplify-button--link--error {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-error-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-error-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-error-color
            );
          }
          .amplify-button--link--error:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-error-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-error-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-error-hover-color
            );
          }
          .amplify-button--link--error:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-error-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-error-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-error-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-link-error-focus-box-shadow
            );
          }
          .amplify-button--link--error:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-error-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-error-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-error-active-color
            );
          }
          .amplify-button--link--success {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-success-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-success-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-success-color
            );
          }
          .amplify-button--link--success:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-success-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-success-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-success-hover-color
            );
          }
          .amplify-button--link--success:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-success-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-success-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-success-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-link-success-focus-box-shadow
            );
          }
          .amplify-button--link--success:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-success-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-success-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-success-active-color
            );
          }
          .amplify-button--link--overlay {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-overlay-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-overlay-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-overlay-color
            );
          }
          .amplify-button--link--overlay:hover {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-overlay-hover-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-overlay-hover-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-overlay-hover-color
            );
          }
          .amplify-button--link--overlay:focus {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-overlay-focus-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-overlay-focus-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-overlay-focus-color
            );
            --amplify-internal-button-focus-box-shadow: var(
              --amplify-components-button-link-overlay-focus-box-shadow
            );
          }
          .amplify-button--link--overlay:active {
            --amplify-internal-button-background-color: var(
              --amplify-components-button-link-overlay-active-background-color
            );
            --amplify-internal-button-border-color: var(
              --amplify-components-button-link-overlay-active-border-color
            );
            --amplify-internal-button-color: var(
              --amplify-components-button-link-overlay-active-color
            );
          }
          .amplify-button--destructive {
            border-width: var(--amplify-components-button-destructive-border-width);
            background-color: var(--amplify-components-button-destructive-background-color);
            border-color: var(--amplify-components-button-destructive-border-color);
            color: var(--amplify-components-button-destructive-color);
            --amplify-internal-button-disabled-border-color: var(
              --amplify-components-button-destructive-disabled-border-color
            );
            --amplify-internal-button-disabled-background-color: var(
              --amplify-components-button-destructive-disabled-background-color
            );
            --amplify-internal-button-disabled-color: var(
              --amplify-components-button-destructive-disabled-color
            );
            --amplify-internal-button-loading-background-color: var(
              --amplify-components-button-destructive-loading-background-color
            );
            --amplify-internal-button-loading-border-color: var(
              --amplify-components-button-destructive-loading-border-color
            );
            --amplify-internal-button-loading-color: var(
              --amplify-components-button-destructive-loading-color
            );
          }
          .amplify-button--destructive:hover {
            background-color: var(--amplify-components-button-destructive-hover-background-color);
            border-color: var(--amplify-components-button-destructive-hover-border-color);
            color: var(--amplify-components-button-destructive-hover-color);
          }
          .amplify-button--destructive:focus {
            background-color: var(--amplify-components-button-destructive-focus-background-color);
            border-color: var(--amplify-components-button-destructive-focus-border-color);
            color: var(--amplify-components-button-destructive-focus-color);
            box-shadow: var(--amplify-components-button-destructive-focus-box-shadow);
          }
          .amplify-button--destructive:active {
            background-color: var(--amplify-components-button-destructive-active-background-color);
            border-color: var(--amplify-components-button-destructive-active-border-color);
            color: var(--amplify-components-button-destructive-active-color);
          }
          .amplify-button--warning {
            background-color: var(--amplify-components-button-warning-background-color);
            border-color: var(--amplify-components-button-warning-border-color);
            border-width: var(--amplify-components-button-warning-border-width);
            color: var(--amplify-components-button-warning-color);
            --amplify-internal-button-disabled-text-decoration: none;
            --amplify-internal-button-disabled-border-color: var(
              --amplify-components-button-warning-disabled-border-color
            );
            --amplify-internal-button-disabled-background-color: var(
              --amplify-components-button-warning-disabled-background-color
            );
            --amplify-internal-button-disabled-color: var(
              --amplify-components-button-warning-disabled-color
            );
            --amplify-internal-button-loading-background-color: var(
              --amplify-components-button-warning-loading-background-color
            );
            --amplify-internal-button-loading-border-color: var(
              --amplify-components-button-warning-loading-border-color
            );
            --amplify-internal-button-loading-color: var(
              --amplify-components-button-warning-loading-color
            );
            --amplify-internal-button-loading-text-decoration: none;
          }
          .amplify-button--warning:hover {
            background-color: var(--amplify-components-button-warning-hover-background-color);
            border-color: var(--amplify-components-button-warning-hover-border-color);
            color: var(--amplify-components-button-warning-hover-color);
          }
          .amplify-button--warning:focus {
            background-color: var(--amplify-components-button-warning-focus-background-color);
            border-color: var(--amplify-components-button-warning-focus-border-color);
            color: var(--amplify-components-button-warning-focus-color);
            box-shadow: var(--amplify-components-button-warning-focus-box-shadow);
          }
          .amplify-button--warning:active {
            background-color: var(--amplify-components-button-warning-active-background-color);
            border-color: var(--amplify-components-button-warning-active-border-color);
            color: var(--amplify-components-button-warning-active-color);
          }
          .amplify-button--small {
            font-size: var(--amplify-components-button-small-font-size);
            padding-block-start: var(--amplify-components-button-small-padding-block-start);
            padding-block-end: var(--amplify-components-button-small-padding-block-end);
            padding-inline-start: var(--amplify-components-button-small-padding-inline-start);
            padding-inline-end: var(--amplify-components-button-small-padding-inline-end);
          }
          .amplify-button--large {
            font-size: var(--amplify-components-button-large-font-size);
            padding-block-start: var(--amplify-components-button-large-padding-block-start);
            padding-block-end: var(--amplify-components-button-large-padding-block-end);
            padding-inline-start: var(--amplify-components-button-large-padding-inline-start);
            padding-inline-end: var(--amplify-components-button-large-padding-inline-end);
          }
          .amplify-button--disabled {
            background-color: var(--amplify-internal-button-disabled-background-color);
            border-color: var(--amplify-internal-button-disabled-border-color);
            color: var(--amplify-internal-button-disabled-color);
            -webkit-text-decoration: var(--amplify-internal-button-disabled-text-decoration);
            text-decoration: var(--amplify-internal-button-disabled-text-decoration);
            cursor: not-allowed;
          }
          .amplify-button--disabled:hover {
            background-color: var(--amplify-internal-button-disabled-background-color);
            border-color: var(--amplify-internal-button-disabled-border-color);
            color: var(--amplify-internal-button-disabled-color);
            -webkit-text-decoration: var(--amplify-internal-button-disabled-text-decoration);
            text-decoration: var(--amplify-internal-button-disabled-text-decoration);
          }
          .amplify-button--disabled :focus {
            background-color: var(--amplify-internal-button-disabled-background-color);
            border-color: var(--amplify-internal-button-disabled-border-color);
            color: var(--amplify-internal-button-disabled-color);
            -webkit-text-decoration: var(--amplify-internal-button-disabled-text-decoration);
            text-decoration: var(--amplify-internal-button-disabled-text-decoration);
          }
          .amplify-button--disabled:active {
            background-color: var(--amplify-internal-button-disabled-background-color);
            border-color: var(--amplify-internal-button-disabled-border-color);
            color: var(--amplify-internal-button-disabled-color);
            -webkit-text-decoration: var(--amplify-internal-button-disabled-text-decoration);
            text-decoration: var(--amplify-internal-button-disabled-text-decoration);
          }
          .amplify-button--loading {
            background-color: var(--amplify-internal-button-loading-background-color);
            border-color: var(--amplify-internal-button-loading-border-color);
            color: var(--amplify-components-button-loading-color);
            -webkit-text-decoration: var(--amplify-internal-button-loading-text-decoration);
            text-decoration: var(--amplify-internal-button-loading-text-decoration);
          }
          .amplify-button--loading:hover {
            background-color: var(--amplify-internal-button-loading-background-color);
            border-color: var(--amplify-internal-button-loading-border-color);
            color: var(--amplify-components-button-loading-color);
            -webkit-text-decoration: var(--amplify-internal-button-loading-text-decoration);
            text-decoration: var(--amplify-internal-button-loading-text-decoration);
          }
          .amplify-button--loading:focus {
            background-color: var(--amplify-internal-button-loading-background-color);
            border-color: var(--amplify-internal-button-loading-border-color);
            color: var(--amplify-components-button-loading-color);
            -webkit-text-decoration: var(--amplify-internal-button-loading-text-decoration);
            text-decoration: var(--amplify-internal-button-loading-text-decoration);
          }
          .amplify-button--loading:active {
            background-color: var(--amplify-internal-button-loading-background-color);
            border-color: var(--amplify-internal-button-loading-border-color);
            color: var(--amplify-components-button-loading-color);
            -webkit-text-decoration: var(--amplify-internal-button-loading-text-decoration);
            text-decoration: var(--amplify-internal-button-loading-text-decoration);
          }
          .amplify-button__loader-wrapper {
            align-items: var(--amplify-components-button-loader-wrapper-align-items);
            gap: var(--amplify-components-button-loader-wrapper-gap);
          }

          @media (prefers-reduced-motion: reduce) {
            .amplify-button {
              transition: none;
            }
          }
          .amplify-dropzone {
            display: block;
            background-color: var(--amplify-components-dropzone-background-color);
            border-color: var(--amplify-components-dropzone-border-color);
            border-width: var(--amplify-components-dropzone-border-width);
            border-style: var(--amplify-components-dropzone-border-style);
            border-radius: var(--amplify-components-dropzone-border-radius);
            color: var(--amplify-components-dropzone-color);
            padding-block: var(--amplify-components-dropzone-padding-block);
            padding-inline: var(--amplify-components-dropzone-padding-inline);
            text-align: var(--amplify-components-dropzone-text-align);
          }
          .amplify-dropzone--disabled {
            cursor: not-allowed;
            background-color: var(--amplify-components-dropzone-disabled-background-color);
            border-color: var(--amplify-components-dropzone-disabled-border-color);
            border-width: var(--amplify-components-dropzone-disabled-border-width);
            border-style: var(--amplify-components-dropzone-disabled-border-style);
            border-radius: var(--amplify-components-dropzone-disabled-border-radius);
            color: var(--amplify-components-dropzone-disabled-color);
          }
          .amplify-dropzone--active {
            background-color: var(--amplify-components-dropzone-active-background-color);
            border-color: var(--amplify-components-dropzone-active-border-color);
            border-width: var(--amplify-components-dropzone-active-border-width);
            border-style: var(--amplify-components-dropzone-active-border-style);
            border-radius: var(--amplify-components-dropzone-active-border-radius);
            color: var(--amplify-components-dropzone-active-color);
          }
          .amplify-dropzone--rejected {
            background-color: var(--amplify-components-dropzone-rejected-background-color);
            border-color: var(--amplify-components-dropzone-rejected-border-color);
            border-width: var(--amplify-components-dropzone-rejected-border-width);
            border-style: var(--amplify-components-dropzone-rejected-border-style);
            border-radius: var(--amplify-components-dropzone-rejected-border-radius);
            color: var(--amplify-components-dropzone-rejected-color);
          }
          .amplify-dropzone--accepted {
            background-color: var(--amplify-components-dropzone-accepted-background-color);
            border-color: var(--amplify-components-dropzone-accepted-border-color);
            border-width: var(--amplify-components-dropzone-accepted-border-width);
            border-style: var(--amplify-components-dropzone-accepted-border-style);
            border-radius: var(--amplify-components-dropzone-accepted-border-radius);
            color: var(--amplify-components-dropzone-accepted-color);
          }

          .amplify-field__description {
            color: var(--amplify-components-fieldmessages-description-color);
            font-style: var(--amplify-components-fieldmessages-description-font-style);
            font-size: var(--amplify-components-fieldmessages-description-font-size);
          }

          .amplify-field__error-message {
            color: var(--amplify-components-fieldmessages-error-color);
            font-size: var(--amplify-components-fieldmessages-error-font-size);
          }

          .amplify-heading {
            color: var(--amplify-components-heading-color);
            line-height: var(--amplify-components-heading-line-height);
            display: block;
          }
          .amplify-heading--truncated {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .amplify-heading--1 {
            font-size: var(--amplify-components-heading-1-font-size);
            font-weight: var(--amplify-components-heading-1-font-weight);
          }

          .amplify-heading--2 {
            font-size: var(--amplify-components-heading-2-font-size);
            font-weight: var(--amplify-components-heading-2-font-weight);
          }

          .amplify-heading--3 {
            font-size: var(--amplify-components-heading-3-font-size);
            font-weight: var(--amplify-components-heading-3-font-weight);
          }

          .amplify-heading--4 {
            font-size: var(--amplify-components-heading-4-font-size);
            font-weight: var(--amplify-components-heading-4-font-weight);
          }

          .amplify-heading--5 {
            font-size: var(--amplify-components-heading-5-font-size);
            font-weight: var(--amplify-components-heading-5-font-weight);
          }

          .amplify-heading--6 {
            font-size: var(--amplify-components-heading-6-font-size);
            font-weight: var(--amplify-components-heading-6-font-weight);
          }

          /*
 * Icon base styles
 */
          .amplify-icon {
            display: inline-block;
            vertical-align: middle;
            fill: currentColor;
            height: var(--amplify-components-icon-height);
            line-height: var(--amplify-components-icon-line-height);
          }
          .amplify-icon > svg {
            height: var(--amplify-components-icon-height);
            width: var(--amplify-components-icon-height);
          }

          .amplify-highlightmatch__highlighted {
            font-weight: var(--amplify-components-highlightmatch-highlighted-font-weight);
          }

          .amplify-input {
            box-sizing: border-box;
            color: var(--amplify-components-fieldcontrol-color);
            font-size: var(--amplify-components-fieldcontrol-font-size);
            line-height: var(--amplify-components-fieldcontrol-line-height);
            padding-block-start: var(--amplify-components-fieldcontrol-padding-block-start);
            padding-block-end: var(--amplify-components-fieldcontrol-padding-block-end);
            padding-inline-start: var(--amplify-components-fieldcontrol-padding-inline-start);
            padding-inline-end: var(--amplify-components-fieldcontrol-padding-inline-end);
            transition: all var(--amplify-components-fieldcontrol-transition-duration);
            width: 100%;
            border-color: var(--amplify-components-fieldcontrol-border-color);
            border-radius: var(--amplify-components-fieldcontrol-border-radius);
            border-style: var(--amplify-components-fieldcontrol-border-style);
            border-width: var(--amplify-components-fieldcontrol-border-width);
            outline-color: var(--amplify-components-fieldcontrol-outline-color);
            outline-style: var(--amplify-components-fieldcontrol-outline-style);
            outline-width: var(--amplify-components-fieldcontrol-outline-width);
            outline-offset: var(--amplify-components-fieldcontrol-outline-offset);
            -webkit-user-select: text;
            -moz-user-select: text;
            user-select: text;
            display: inline-block;
            --amplify-components-fieldcontrol-color: var(
              --amplify-components-input-color
            );
            --amplify-components-fieldcontrol-border-color: var(
              --amplify-components-input-border-color
            );
            --amplify-components-fieldcontrol-font-size: var(
              --amplify-components-input-font-size
            );
            --amplify-components-fieldcontrol-focus-border-color: var(
              --amplify-components-input-focus-border-color
            );
          }
          .amplify-input:focus {
            border-color: var(--amplify-components-fieldcontrol-focus-border-color);
            box-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
          }
          .amplify-input--small {
            font-size: var(--amplify-components-fieldcontrol-small-font-size);
            padding-block-start: var(--amplify-components-fieldcontrol-small-padding-block-start);
            padding-block-end: var(--amplify-components-fieldcontrol-small-padding-block-end);
            padding-inline-start: var(--amplify-components-fieldcontrol-small-padding-inline-start);
            padding-inline-end: var(--amplify-components-fieldcontrol-small-padding-inline-end);
          }
          .amplify-input--large {
            font-size: var(--amplify-components-fieldcontrol-large-font-size);
            padding-block-start: var(--amplify-components-fieldcontrol-large-padding-block-start);
            padding-block-end: var(--amplify-components-fieldcontrol-large-padding-block-end);
            padding-inline-start: var(--amplify-components-fieldcontrol-large-padding-inline-start);
            padding-inline-end: var(--amplify-components-fieldcontrol-large-padding-inline-end);
          }
          .amplify-input--error {
            border-color: var(--amplify-components-fieldcontrol-error-border-color);
          }
          .amplify-input--error:focus {
            border-color: var(--amplify-components-fieldcontrol-error-border-color);
            box-shadow: var(--amplify-components-fieldcontrol-error-focus-box-shadow);
          }
          .amplify-input--quiet {
            border-block-start: var(--amplify-components-fieldcontrol-quiet-border-block-start);
            border-inline-start: var(--amplify-components-fieldcontrol-quiet-border-inline-start);
            border-inline-end: var(--amplify-components-fieldcontrol-quiet-border-inline-end);
            border-radius: var(--amplify-components-fieldcontrol-quiet-border-radius);
          }
          .amplify-input--quiet:focus {
            border-block-end-color: var(--amplify-components-fieldcontrol-quiet-focus-border-block-end-color);
            box-shadow: var(--amplify-components-fieldcontrol-quiet-focus-box-shadow);
          }
          .amplify-input--quiet[aria-invalid=true] {
            border-block-end-color: var(--amplify-components-fieldcontrol-quiet-error-border-block-end-color);
          }
          .amplify-input--quiet[aria-invalid=true]:focus {
            border-block-end-color: var(--amplify-components-fieldcontrol-quiet-error-focus-border-block-end-color);
            box-shadow: var(--amplify-components-fieldcontrol-quiet-error-focus-box-shadow);
          }
          .amplify-input[disabled] {
            color: var(--amplify-components-fieldcontrol-disabled-color);
            cursor: var(--amplify-components-fieldcontrol-disabled-cursor);
            border-color: var(--amplify-components-fieldcontrol-disabled-border-color);
            background-color: var(--amplify-components-fieldcontrol-disabled-background-color);
          }

          .amplify-textarea {
            box-sizing: border-box;
            color: var(--amplify-components-fieldcontrol-color);
            font-size: var(--amplify-components-fieldcontrol-font-size);
            line-height: var(--amplify-components-fieldcontrol-line-height);
            padding-block-start: var(--amplify-components-fieldcontrol-padding-block-start);
            padding-block-end: var(--amplify-components-fieldcontrol-padding-block-end);
            padding-inline-start: var(--amplify-components-fieldcontrol-padding-inline-start);
            padding-inline-end: var(--amplify-components-fieldcontrol-padding-inline-end);
            transition: all var(--amplify-components-fieldcontrol-transition-duration);
            width: 100%;
            border-color: var(--amplify-components-fieldcontrol-border-color);
            border-radius: var(--amplify-components-fieldcontrol-border-radius);
            border-style: var(--amplify-components-fieldcontrol-border-style);
            border-width: var(--amplify-components-fieldcontrol-border-width);
            outline-color: var(--amplify-components-fieldcontrol-outline-color);
            outline-style: var(--amplify-components-fieldcontrol-outline-style);
            outline-width: var(--amplify-components-fieldcontrol-outline-width);
            outline-offset: var(--amplify-components-fieldcontrol-outline-offset);
            -webkit-user-select: text;
            -moz-user-select: text;
            user-select: text;
            white-space: pre-wrap;
          }
          .amplify-textarea:focus {
            border-color: var(--amplify-components-fieldcontrol-focus-border-color);
            box-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
          }
          .amplify-textarea--small {
            font-size: var(--amplify-components-fieldcontrol-small-font-size);
            padding-block-start: var(--amplify-components-fieldcontrol-small-padding-block-start);
            padding-block-end: var(--amplify-components-fieldcontrol-small-padding-block-end);
            padding-inline-start: var(--amplify-components-fieldcontrol-small-padding-inline-start);
            padding-inline-end: var(--amplify-components-fieldcontrol-small-padding-inline-end);
          }
          .amplify-textarea--large {
            font-size: var(--amplify-components-fieldcontrol-large-font-size);
            padding-block-start: var(--amplify-components-fieldcontrol-large-padding-block-start);
            padding-block-end: var(--amplify-components-fieldcontrol-large-padding-block-end);
            padding-inline-start: var(--amplify-components-fieldcontrol-large-padding-inline-start);
            padding-inline-end: var(--amplify-components-fieldcontrol-large-padding-inline-end);
          }
          .amplify-textarea--error {
            border-color: var(--amplify-components-fieldcontrol-error-border-color);
          }
          .amplify-textarea--error:focus {
            border-color: var(--amplify-components-fieldcontrol-error-border-color);
            box-shadow: var(--amplify-components-fieldcontrol-error-focus-box-shadow);
          }
          .amplify-textarea--quiet {
            border-block-start: var(--amplify-components-fieldcontrol-quiet-border-block-start);
            border-inline-start: var(--amplify-components-fieldcontrol-quiet-border-inline-start);
            border-inline-end: var(--amplify-components-fieldcontrol-quiet-border-inline-end);
            border-radius: var(--amplify-components-fieldcontrol-quiet-border-radius);
          }
          .amplify-textarea--quiet:focus {
            border-block-end-color: var(--amplify-components-fieldcontrol-quiet-focus-border-block-end-color);
            box-shadow: var(--amplify-components-fieldcontrol-quiet-focus-box-shadow);
          }
          .amplify-textarea--quiet[aria-invalid=true] {
            border-block-end-color: var(--amplify-components-fieldcontrol-quiet-error-border-block-end-color);
          }
          .amplify-textarea--quiet[aria-invalid=true]:focus {
            border-block-end-color: var(--amplify-components-fieldcontrol-quiet-error-focus-border-block-end-color);
            box-shadow: var(--amplify-components-fieldcontrol-quiet-error-focus-box-shadow);
          }
          .amplify-textarea[disabled] {
            color: var(--amplify-components-fieldcontrol-disabled-color);
            cursor: var(--amplify-components-fieldcontrol-disabled-cursor);
            border-color: var(--amplify-components-fieldcontrol-disabled-border-color);
            background-color: var(--amplify-components-fieldcontrol-disabled-background-color);
          }

          .amplify-image {
            height: var(--amplify-components-image-height);
            max-width: var(--amplify-components-image-max-width);
            -o-object-fit: var(--amplify-components-image-object-fit);
            object-fit: var(--amplify-components-image-object-fit);
            -o-object-position: var(--amplify-components-image-object-position);
            object-position: var(--amplify-components-image-object-position);
            overflow: clip;
          }

          .amplify-link {
            color: var(--amplify-components-link-color);
            -webkit-text-decoration: var(--amplify-components-link-text-decoration);
            text-decoration: var(--amplify-components-link-text-decoration);
            cursor: pointer;
          }
          .amplify-link:visited {
            color: var(--amplify-components-link-visited-color);
            -webkit-text-decoration: var(--amplify-components-link-visited-text-decoration);
            text-decoration: var(--amplify-components-link-visited-text-decoration);
          }
          .amplify-link:active {
            color: var(--amplify-components-link-active-color);
            -webkit-text-decoration: var(--amplify-components-link-active-text-decoration);
            text-decoration: var(--amplify-components-link-active-text-decoration);
          }
          .amplify-link:focus {
            color: var(--amplify-components-link-focus-color);
            -webkit-text-decoration: var(--amplify-components-link-focus-text-decoration);
            text-decoration: var(--amplify-components-link-focus-text-decoration);
          }
          .amplify-link:hover {
            color: var(--amplify-components-link-hover-color);
            -webkit-text-decoration: var(--amplify-components-link-hover-text-decoration);
            text-decoration: var(--amplify-components-link-hover-text-decoration);
          }

          .amplify-loader {
            width: var(--amplify-components-loader-width);
            height: var(--amplify-components-loader-height);
            font-size: var(--amplify-components-loader-font-size);
            fill: none;
            stroke: var(--amplify-components-loader-stroke-empty);
            --amplify-internal-loader-linear-font-size: var(
              --amplify-components-loader-linear-font-size
            );
            --amplify-internal-loader-linear-stroke-width: var(
              --amplify-components-loader-linear-stroke-width
            );
          }
          .amplify-loader circle:last-of-type {
            transform-origin: center center;
            animation-name: amplify-loader-circular;
            animation-timing-function: linear;
            animation-iteration-count: infinite;
            animation-duration: var(--amplify-components-loader-animation-duration);
            stroke: var(--amplify-components-loader-stroke-filled);
            stroke-linecap: var(--amplify-components-loader-stroke-linecap);
          }
          @media (prefers-reduced-motion) {
            .amplify-loader circle:last-of-type {
              animation: none;
              stroke-dasharray: 100% 200%;
              stroke-dashoffset: 50%;
            }
          }
          .amplify-loader line:last-of-type {
            stroke: var(--amplify-components-loader-linear-stroke-filled);
            stroke-dasharray: 50% 200%;
            animation-name: amplify-loader-linear;
            animation-duration: var(--amplify-components-loader-linear-animation-duration);
            animation-timing-function: linear;
            animation-iteration-count: infinite;
          }
          @media (prefers-reduced-motion) {
            .amplify-loader line:last-of-type {
              animation: none;
              stroke-dashoffset: -50%;
            }
          }
          .amplify-loader--small {
            width: var(--amplify-components-loader-small-width);
            height: var(--amplify-components-loader-small-height);
            font-size: var(--amplify-components-loader-small-font-size);
            --amplify-internal-loader-linear-stroke-width: var(
              --amplify-components-loader-linear-small-stroke-width
            );
            --amplify-internal-loader-linear-font-size: var(
              --amplify-components-loader-linear-small-font-size
            );
          }
          .amplify-loader--large {
            width: var(--amplify-components-loader-large-width);
            height: var(--amplify-components-loader-large-height);
            font-size: var(--amplify-components-loader-large-font-size);
            --amplify-internal-loader-linear-stroke-width: var(
              --amplify-components-loader-linear-large-stroke-width
            );
            --amplify-internal-loader-linear-font-size: var(
              --amplify-components-loader-linear-large-font-size
            );
          }
          .amplify-loader--linear {
            width: var(--amplify-components-loader-linear-width);
            min-width: var(--amplify-components-loader-linear-min-width);
            stroke: var(--amplify-components-loader-linear-stroke-empty);
            stroke-linecap: var(--amplify-components-loader-linear-stroke-linecap);
            stroke-width: var(--amplify-internal-loader-linear-stroke-width);
            font-size: var(--amplify-internal-loader-linear-font-size);
          }
          .amplify-loader--determinate circle:last-of-type {
            animation: none;
            transform: rotate(-90deg);
          }
          .amplify-loader--determinate line:last-of-type {
            animation: none;
            stroke-dashoffset: 0%;
            stroke-dasharray: none;
          }
          .amplify-loader__label {
            fill: var(--amplify-components-loader-text-fill);
            stroke: none;
          }

          @keyframes amplify-loader-circular {
            0% {
              stroke-dasharray: 100% 200%;
              transform: rotate(120deg);
            }
            50% {
              stroke-dasharray: 20% 400%;
            }
            100% {
              stroke-dasharray: 100% 200%;
              transform: rotate(480deg);
            }
          }
          @keyframes amplify-loader-linear {
            0% {
              stroke-dashoffset: 200%;
            }
            100% {
              stroke-dashoffset: -50%;
            }
          }
          .amplify-placeholder {
            animation-direction: alternate;
            animation-duration: var(--amplify-components-placeholder-transition-duration);
            animation-iteration-count: infinite;
            animation-name: amplify-placeholder-loading;
            border-radius: var(--amplify-components-placeholder-border-radius);
            height: var(--amplify-components-placeholder-default-height);
            width: 100%;
            display: block;
          }
          .amplify-placeholder--small {
            height: var(--amplify-components-placeholder-small-height);
          }
          .amplify-placeholder--large {
            height: var(--amplify-components-placeholder-large-height);
          }

          @keyframes amplify-placeholder-loading {
            0% {
              background-color: var(--amplify-components-placeholder-start-color);
            }
            100% {
              background-color: var(--amplify-components-placeholder-end-color);
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .amplify-placeholder {
              animation: none;
              background-color: var(--amplify-components-placeholder-end-color);
            }
          }
          [data-amplify-copy] {
            display: flex;
            font-size: var(--amplify-components-copy-font-size);
            gap: var(--amplify-components-copy-gap);
            justify-content: center;
            align-items: center;
            word-break: break-all;
          }

          [data-amplify-copy-svg] {
            cursor: pointer;
            position: relative;
          }
          [data-amplify-copy-svg] path {
            fill: var(--amplify-components-copy-svg-path-fill);
          }
          [data-amplify-copy-svg]:hover [data-amplify-copy-tooltip] {
            visibility: visible;
            font-size: var(--amplify-components-copy-tool-tip-font-size);
          }

          [data-amplify-copy-tooltip] {
            visibility: hidden;
            position: absolute;
            bottom: var(--amplify-components-copy-tool-tip-bottom);
            color: var(--amplify-components-copy-tool-tip-color);
          }

          .amplify-accordion {
            display: block;
            background-color: var(--amplify-components-accordion-background-color);
            border-radius: var(--amplify-components-accordion-item-border-radius);
          }

          .amplify-accordion__item {
            display: block;
            position: relative;
            border-width: var(--amplify-components-accordion-item-border-width);
            border-style: var(--amplify-components-accordion-item-border-style);
            border-color: var(--amplify-components-accordion-item-border-color);
          }
          .amplify-accordion__item + .amplify-accordion__item {
            margin-block-start: calc(-1 * var(--amplify-components-accordion-item-border-width));
          }
          .amplify-accordion__item:where(:first-of-type) {
            border-start-end-radius: var(--amplify-components-accordion-item-border-radius);
            border-start-start-radius: var(--amplify-components-accordion-item-border-radius);
          }
          .amplify-accordion__item:where(:last-of-type) {
            border-end-end-radius: var(--amplify-components-accordion-item-border-radius);
            border-end-start-radius: var(--amplify-components-accordion-item-border-radius);
          }
          .amplify-accordion__item__trigger {
            cursor: pointer;
            display: flex;
            position: relative;
            color: var(--amplify-components-accordion-item-trigger-color);
            border-radius: var(--amplify-components-accordion-item-border-radius);
            padding-inline: var(--amplify-components-accordion-item-trigger-padding-inline);
            padding-block: var(--amplify-components-accordion-item-trigger-padding-block);
            gap: var(--amplify-components-accordion-item-trigger-gap);
            align-items: var(--amplify-components-accordion-item-trigger-align-items);
            justify-content: var(--amplify-components-accordion-item-trigger-justify-content);
          }
          .amplify-accordion__item__trigger:hover {
            background-color: var(--amplify-components-accordion-item-trigger-hover-background-color);
            color: var(--amplify-components-accordion-item-trigger-hover-color);
          }
          .amplify-accordion__item__trigger:focus {
            box-shadow: var(--amplify-components-accordion-item-trigger-focus-box-shadow);
            border-color: var(--amplify-components-accordion-item-trigger-focus-border-color);
            z-index: 2;
          }
          .amplify-accordion__item__trigger::-webkit-details-marker {
            display: none;
          }
          .amplify-accordion__item__content {
            display: block;
            color: var(--amplify-components-accordion-item-content-color);
            padding-block-end: var(--amplify-components-accordion-item-content-padding-block-end);
            padding-block-start: var(--amplify-components-accordion-item-content-padding-block-start);
            padding-inline: var(--amplify-components-accordion-item-content-padding-inline);
          }
          .amplify-accordion__item__icon {
            color: var(--amplify-components-accordion-item-icon-color);
            transition-property: transform;
            transition-duration: var(--amplify-components-accordion-item-icon-transition-duration);
            transition-timing-function: var(--amplify-components-accordion-item-icon-transition-timing-function);
          }
          [open] .amplify-accordion__item__icon {
            transform: rotate(180deg);
          }

          .amplify-alert {
            align-items: var(--amplify-components-alert-align-items);
            background-color: var(--amplify-components-alert-background-color);
            color: var(--amplify-components-alert-color);
            justify-content: var(--amplify-components-alert-justify-content);
            padding-block: var(--amplify-components-alert-padding-block);
            padding-inline: var(--amplify-components-alert-padding-inline);
          }
          .amplify-alert--info {
            color: var(--amplify-components-alert-info-color);
            background-color: var(--amplify-components-alert-info-background-color);
          }
          .amplify-alert--error {
            color: var(--amplify-components-alert-error-color);
            background-color: var(--amplify-components-alert-error-background-color);
          }
          .amplify-alert--warning {
            color: var(--amplify-components-alert-warning-color);
            background-color: var(--amplify-components-alert-warning-background-color);
          }
          .amplify-alert--success {
            color: var(--amplify-components-alert-success-color);
            background-color: var(--amplify-components-alert-success-background-color);
          }

          .amplify-alert__icon {
            font-size: var(--amplify-components-alert-icon-size);
            line-height: 1;
          }

          .amplify-alert__heading {
            display: block;
            font-weight: var(--amplify-components-alert-heading-font-weight);
            font-size: var(--amplify-components-alert-heading-font-size);
          }

          .amplify-alert__body {
            color: inherit;
            display: block;
          }

          .amplify-alert__dismiss {
            color: inherit;
          }

          .amplify-autocomplete__menu__option, .amplify-autocomplete__menu--loading, .amplify-autocomplete__menu--empty {
            padding-block: var(--amplify-components-autocomplete-menu-space-shared-padding-block);
            padding-inline: var(--amplify-components-autocomplete-menu-space-shared-padding-inline);
          }

          .amplify-autocomplete {
            position: relative;
            display: block;
          }

          .amplify-autocomplete__menu {
            position: absolute;
            z-index: 999999;
            width: var(--amplify-components-autocomplete-menu-width);
            margin-block-start: var(--amplify-components-autocomplete-menu-margin-block-start);
            background-color: var(--amplify-components-autocomplete-menu-background-color);
            border-color: var(--amplify-components-autocomplete-menu-border-color);
            border-width: var(--amplify-components-autocomplete-menu-border-width);
            border-style: var(--amplify-components-autocomplete-menu-border-style);
            border-radius: var(--amplify-components-autocomplete-menu-border-radius);
          }
          .amplify-autocomplete__menu--empty {
            display: var(--amplify-components-autocomplete-menu-empty-display);
          }
          .amplify-autocomplete__menu--loading {
            display: var(--amplify-components-autocomplete-menu-loading-display);
            align-items: var(--amplify-components-autocomplete-menu-loading-align-items);
            gap: var(--amplify-components-autocomplete-menu-loading-gap);
          }
          .amplify-autocomplete__menu__options {
            position: relative;
            overscroll-behavior: contain;
            display: var(--amplify-components-autocomplete-menu-options-display);
            flex-direction: var(--amplify-components-autocomplete-menu-options-flex-direction);
            max-height: var(--amplify-components-autocomplete-menu-options-max-height);
          }
          .amplify-autocomplete__menu__option {
            background-color: var(--amplify-components-autocomplete-menu-option-background-color);
            color: var(--amplify-components-autocomplete-menu-option-color);
            cursor: var(--amplify-components-autocomplete-menu-option-cursor);
            transition-duration: var(--amplify-components-autocomplete-menu-option-transition-duration);
            transition-property: var(--amplify-components-autocomplete-menu-option-transition-property);
            transition-timing-function: var(--amplify-components-autocomplete-menu-option-transition-timing-function);
          }
          .amplify-autocomplete__menu__option--active {
            background-color: var(--amplify-components-autocomplete-menu-option-active-background-color);
            color: var(--amplify-components-autocomplete-menu-option-active-color);
          }

          /* Center by default */
          [data-amplify-authenticator] {
            display: grid;
          }
          [data-amplify-authenticator][data-variation=modal] {
            overflow-y: auto;
            width: var(--amplify-components-authenticator-modal-width);
            height: var(--amplify-components-authenticator-modal-height);
            background-color: var(--amplify-components-authenticator-modal-background-color);
            position: fixed;
            top: var(--amplify-components-authenticator-modal-top);
            left: var(--amplify-components-authenticator-modal-left);
            /* Having a z-index at least "wins" by default */
            z-index: 1;
          }
          [data-amplify-authenticator] [data-amplify-container] {
            place-self: center;
          }
          @media (min-width: 30rem) {
            [data-amplify-authenticator] [data-amplify-container] {
              width: var(--amplify-components-authenticator-container-width-max);
            }
          }
          [data-amplify-authenticator] [data-amplify-router] {
            background-color: var(--amplify-components-authenticator-router-background-color);
            box-shadow: var(--amplify-components-authenticator-router-box-shadow);
            border-color: var(--amplify-components-authenticator-router-border-color);
            border-width: var(--amplify-components-authenticator-router-border-width);
            border-style: var(--amplify-components-authenticator-router-border-style);
          }
          [data-amplify-authenticator] [data-amplify-footer] {
            padding-bottom: var(--amplify-components-authenticator-footer-padding-bottom);
            text-align: center;
          }
          [data-amplify-authenticator] [data-amplify-form] {
            padding: var(--amplify-components-authenticator-form-padding);
          }
          [data-amplify-authenticator] [data-state=inactive] {
            background-color: var(--amplify-components-authenticator-state-inactive-background-color);
          }
          @media (max-width: 26rem) {
            [data-amplify-authenticator] [data-amplify-sign-up-errors] {
              font-size: 0.688rem;
            }
          }

          .amplify-authenticator__column {
            display: flex;
            flex-direction: column;
          }

          .amplify-authenticator__subtitle {
            margin-bottom: var(--amplify-space-medium);
          }

          .amplify-authenticator__heading {
            font-size: var(--amplify-font-sizes-xl);
          }

          .amplify-authenticator__federated-text {
            align-self: center;
          }

          .amplify-authenticator__federated-buttons {
            flex-direction: column;
            padding-block-end: var(--amplify-space-medium);
          }

          .amplify-authenticator__federated-button {
            font-weight: normal;
            gap: var(--amplify-space-medium);
          }

          .amplify-avatar {
            --avatar-color: var(--amplify-components-avatar-color);
            --avatar-background-color: var(--amplify-components-avatar-background-color);
            --avatar-filled-background-color: var(--amplify-components-avatar-color);
            --avatar-filled-color: var(--amplify-components-avatar-background-color);
            --avatar-border-color: var(--amplify-components-avatar-border-color);
            --avatar-size: var(--amplify-components-avatar-width);
            --amplify-components-icon-height: 100%;
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--avatar-color);
            background-color: var(--avatar-background-color);
            font-weight: var(--amplify-components-avatar-font-weight);
            font-size: var(--amplify-components-avatar-font-size);
            width: var(--amplify-components-avatar-width);
            height: var(--amplify-components-avatar-height);
            overflow: hidden;
            border-radius: var(--amplify-components-avatar-border-radius);
          }
          .amplify-avatar--filled {
            background-color: var(--avatar-filled-background-color);
            color: var(--avatar-filled-color);
          }
          .amplify-avatar--outlined {
            border-width: var(--amplify-components-avatar-border-width);
            border-style: solid;
            padding: var(--amplify-components-avatar-border-width);
            border-color: var(--avatar-border-color);
            background-color: transparent;
            color: var(--avatar-color);
          }
          .amplify-avatar--small {
            --avatar-size: var(--amplify-components-avatar-small-width);
            width: var(--amplify-components-avatar-small-width);
            height: var(--amplify-components-avatar-small-height);
            font-size: var(--amplify-components-avatar-small-font-size);
          }
          .amplify-avatar--large {
            --avatar-size: var(--amplify-components-avatar-large-width);
            width: var(--amplify-components-avatar-large-width);
            height: var(--amplify-components-avatar-large-height);
            font-size: var(--amplify-components-avatar-large-font-size);
          }
          .amplify-avatar--warning {
            --avatar-border-color: var(
              --amplify-components-avatar-warning-border-color
            );
            --avatar-background-color: var(
              --amplify-components-avatar-warning-background-color
            );
            --avatar-color: var(--amplify-components-avatar-warning-color);
            --avatar-filled-background-color: var(
              --amplify-components-avatar-warning-color
            );
            --avatar-filled-color: var(
              --amplify-components-avatar-warning-background-color
            );
            --amplify-components-loader-stroke-filled: var(
              --amplify-components-avatar-warning-color
            );
          }
          .amplify-avatar--error {
            --avatar-border-color: var(--amplify-components-avatar-error-border-color);
            --avatar-background-color: var(
              --amplify-components-avatar-error-background-color
            );
            --avatar-color: var(--amplify-components-avatar-error-color);
            --avatar-filled-background-color: var(
              --amplify-components-avatar-error-color
            );
            --avatar-filled-color: var(
              --amplify-components-avatar-error-background-color
            );
            --amplify-components-loader-stroke-filled: var(
              --amplify-components-avatar-error-color
            );
          }
          .amplify-avatar--info {
            --avatar-border-color: var(--amplify-components-avatar-info-border-color);
            --avatar-background-color: var(
              --amplify-components-avatar-info-background-color
            );
            --avatar-color: var(--amplify-components-avatar-info-color);
            --avatar-filled-background-color: var(
              --amplify-components-avatar-info-color
            );
            --avatar-filled-color: var(
              --amplify-components-avatar-info-background-color
            );
            --amplify-components-loader-stroke-filled: var(
              --amplify-components-avatar-info-color
            );
          }
          .amplify-avatar--success {
            --avatar-border-color: var(
              --amplify-components-avatar-success-border-color
            );
            --avatar-background-color: var(
              --amplify-components-avatar-success-background-color
            );
            --avatar-color: var(--amplify-components-avatar-success-color);
            --avatar-filled-background-color: var(
              --amplify-components-avatar-success-color
            );
            --avatar-filled-color: var(
              --amplify-components-avatar-success-background-color
            );
            --amplify-components-loader-stroke-filled: var(
              --amplify-components-avatar-success-color
            );
          }
          .amplify-avatar__icon {
            display: flex;
            font-size: calc(var(--avatar-size) * 0.6);
          }
          .amplify-avatar__image {
            width: 100%;
            height: 100%;
            -o-object-fit: cover;
            object-fit: cover;
            display: block;
          }
          .amplify-avatar__loader {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            stroke: transparent;
          }

          .amplify-breadcrumbs__list {
            display: flex;
            flex-wrap: var(--amplify-components-breadcrumbs-flex-wrap);
            flex-direction: var(--amplify-components-breadcrumbs-flex-direction);
            gap: var(--amplify-components-breadcrumbs-gap);
            color: var(--amplify-components-breadcrumbs-color);
          }

          .amplify-breadcrumbs__item {
            display: inline-flex;
            flex-direction: var(--amplify-components-breadcrumbs-item-flex-direction);
            align-items: var(--amplify-components-breadcrumbs-item-align-items);
            line-height: var(--amplify-components-breadcrumbs-item-line-height);
            color: var(--amplify-components-breadcrumbs-item-color);
            font-size: var(--amplify-components-breadcrumbs-item-font-size);
          }

          .amplify-breadcrumbs__separator {
            color: var(--amplify-components-breadcrumbs-separator-color);
            font-size: var(--amplify-components-breadcrumbs-separator-font-size);
            padding-inline: var(--amplify-components-breadcrumbs-separator-padding-inline);
          }

          .amplify-breadcrumbs__link {
            color: var(--amplify-components-breadcrumbs-link-color);
            font-size: var(--amplify-components-breadcrumbs-link-font-size);
            font-weight: var(--amplify-components-breadcrumbs-link-font-weight);
            padding-inline: var(--amplify-components-breadcrumbs-link-padding-inline);
            padding-block: var(--amplify-components-breadcrumbs-link-padding-block);
            -webkit-text-decoration: var(--amplify-components-breadcrumbs-link-text-decoration);
            text-decoration: var(--amplify-components-breadcrumbs-link-text-decoration);
          }

          .amplify-breadcrumbs__link--current {
            color: var(--amplify-components-breadcrumbs-link-current-color);
            font-size: var(--amplify-components-breadcrumbs-link-current-font-size);
            font-weight: var(--amplify-components-breadcrumbs-link-current-font-weight);
            -webkit-text-decoration: var(--amplify-components-breadcrumbs-link-current-text-decoration);
            text-decoration: var(--amplify-components-breadcrumbs-link-current-text-decoration);
          }

          .amplify-card {
            background-color: var(--amplify-components-card-background-color);
            border-radius: var(--amplify-components-card-border-radius);
            border-width: var(--amplify-components-card-border-width);
            border-style: var(--amplify-components-card-border-style);
            border-color: var(--amplify-components-card-border-color);
            box-shadow: var(--amplify-components-card-box-shadow);
            display: block;
            padding: var(--amplify-components-card-padding);
          }
          .amplify-card--outlined {
            background-color: var(--amplify-components-card-outlined-background-color);
            border-radius: var(--amplify-components-card-outlined-border-radius);
            border-width: var(--amplify-components-card-outlined-border-width);
            border-style: var(--amplify-components-card-outlined-border-style);
            border-color: var(--amplify-components-card-outlined-border-color);
            box-shadow: var(--amplify-components-card-outlined-box-shadow);
          }
          .amplify-card--elevated {
            background-color: var(--amplify-components-card-elevated-background-color);
            border-radius: var(--amplify-components-card-elevated-border-radius);
            border-width: var(--amplify-components-card-elevated-border-width);
            border-style: var(--amplify-components-card-elevated-border-style);
            border-color: var(--amplify-components-card-elevated-border-color);
            box-shadow: var(--amplify-components-card-elevated-box-shadow);
          }

          .amplify-collection {
            flex-direction: column;
          }
          .amplify-collection__pagination {
            justify-content: center;
            --amplify-components-pagination-current-color: var(
              --amplify-components-collection-pagination-current-color
            );
            --amplify-components-pagination-current-background-color: var(
              --amplify-components-collection-pagination-current-background-color
            );
            --amplify-components-pagination-button-color: var(
              --amplify-components-collection-pagination-button-color
            );
            --amplify-components-pagination-button-hover-color: var(
              --amplify-components-collection-pagination-button-hover-color
            );
            --amplify-components-pagination-button-hover-background-color: var(
              --amplify-components-collection-pagination-button-hover-background-color
            );
            --amplify-components-pagination-button-disabled-color: var(
              --amplify-components-collection-pagination-button-disabled-color
            );
          }
          .amplify-collection__search {
            flex-direction: row;
            justify-content: center;
            --amplify-components-searchfield-input-color: var(
              --amplify-components-collection-search-input-color
            );
            --amplify-components-searchfield-button-color: var(
              --amplify-components-collection-search-button-color
            );
            --amplify-components-searchfield-button-active-background-color: var(
              --amplify-components-collection-search-button-active-background-color
            );
            --amplify-components-searchfield-button-active-border-color: var(
              --amplify-components-collection-search-button-active-border-color
            );
            --amplify-components-searchfield-button-active-color: var(
              --amplify-components-collection-search-button-active-color
            );
            --amplify-components-searchfield-button-disabled-background-color: var(
              --amplify-components-collection-search-button-disabled-background-color
            );
            --amplify-components-searchfield-button-disabled-border-color: var(
              --amplify-components-collection-search-button-disabled-border-color
            );
            --amplify-components-searchfield-button-disabled-color: var(
              --amplify-components-collection-search-button-disabled-color
            );
            --amplify-components-searchfield-button-focus-background-color: var(
              --amplify-components-collection-search-button-focus-background-color
            );
            --amplify-components-searchfield-button-focus-border-color: var(
              --amplify-components-collection-search-button-focus-border-color
            );
            --amplify-components-searchfield-button-focus-color: var(
              --amplify-components-collection-search-button-focus-color
            );
            --amplify-components-searchfield-button-hover-background-color: var(
              --amplify-components-collection-search-button-hover-background-color
            );
            --amplify-components-searchfield-button-hover-border-color: var(
              --amplify-components-collection-search-button-hover-border-color
            );
            --amplify-components-searchfield-button-hover-color: var(
              --amplify-components-collection-search-button-hover-color
            );
          }

          .amplify-checkbox {
            cursor: var(--amplify-components-checkbox-cursor);
            align-items: var(--amplify-components-checkbox-align-items);
            flex-direction: row-reverse;
            gap: inherit;
            position: relative;
          }
          .amplify-checkbox--disabled {
            cursor: var(--amplify-components-checkbox-disabled-cursor);
            color: var(--amplify-components-checkbox-label-disabled-color);
          }

          .amplify-checkbox__button {
            position: var(--amplify-components-checkbox-button-position);
            align-items: var(--amplify-components-checkbox-button-align-items);
            justify-content: var(--amplify-components-checkbox-button-justify-content);
            color: var(--amplify-components-checkbox-button-color);
            --amplify-internal-checkbox_button-focused-before-border-color: var(
              --amplify-components-checkbox-button-focus-border-color
            );
            --amplify-internal-checkbox_button-focused-before-box-shadow: var(
              --amplify-components-checkbox-button-focus-box-shadow
            );
          }
          .amplify-checkbox__button::before {
            content: "";
            display: inline-block;
            position: absolute;
            box-sizing: border-box;
            width: var(--amplify-components-checkbox-button-before-width);
            height: var(--amplify-components-checkbox-button-before-height);
            border-width: var(--amplify-components-checkbox-button-before-border-width);
            border-radius: var(--amplify-components-checkbox-button-before-border-radius);
            border-style: var(--amplify-components-checkbox-button-before-border-style);
            border-color: var(--amplify-components-checkbox-button-before-border-color);
          }
          .amplify-checkbox__button--focused::before {
            outline-color: var(--amplify-components-checkbox-button-focus-outline-color);
            outline-style: var(--amplify-components-checkbox-button-focus-outline-style);
            outline-width: var(--amplify-components-checkbox-button-focus-outline-width);
            outline-offset: var(--amplify-components-checkbox-button-focus-outline-offset);
            border-color: var(--amplify-internal-checkbox_button-focused-before-border-color);
            box-shadow: var(--amplify-internal-checkbox_button-focused-before-box-shadow);
          }
          .amplify-checkbox__button--error {
            --amplify-internal-checkbox_button-focused-before-border-color: var(
              --amplify-components-checkbox-button-error-focus-border-color
            );
            --amplify-internal-checkbox_button-focused-before-box-shadow: var(
              --amplify-components-checkbox-button-error-focus-box-shadow
            );
          }
          .amplify-checkbox__button--error::before {
            border-color: var(--amplify-components-checkbox-button-error-border-color);
          }
          .amplify-checkbox__button--disabled::before {
            border-color: var(--amplify-components-checkbox-button-disabled-border-color);
          }

          .amplify-checkbox__icon {
            line-height: 1;
            width: 1em;
            height: 1em;
            background-color: var(--amplify-components-checkbox-icon-background-color);
            opacity: var(--amplify-components-checkbox-icon-opacity);
            transform: var(--amplify-components-checkbox-icon-transform);
            border-radius: var(--amplify-components-checkbox-icon-border-radius);
            transition-property: var(--amplify-components-checkbox-icon-transition-property);
            transition-duration: var(--amplify-components-checkbox-icon-transition-duration);
            transition-timing-function: var(--amplify-components-checkbox-icon-transition-timing-function);
            --amplify-internal-checkbox-icon-disabled-background-color: var(
              --amplify-components-checkbox-icon-background-color
            );
          }
          .amplify-checkbox__icon--checked {
            opacity: var(--amplify-components-checkbox-icon-checked-opacity);
            transform: var(--amplify-components-checkbox-icon-checked-transform);
            --amplify-internal-checkbox-icon-disabled-background-color: var(
              --amplify-components-checkbox-icon-checked-disabled-background-color
            );
          }
          .amplify-checkbox__icon--indeterminate {
            opacity: var(--amplify-components-checkbox-icon-indeterminate-opacity);
            transform: var(--amplify-components-checkbox-icon-indeterminate-transform);
            --amplify-internal-checkbox-icon-disabled-background-color: var(
              --amplify-components-checkbox-icon-indeterminate-disabled-background-color
            );
          }
          .amplify-checkbox__icon--disabled {
            background-color: var(--amplify-internal-checkbox-icon-disabled-background-color);
          }

          .amplify-checkbox__label {
            color: var(--amplify-components-checkbox-label-color);
          }
          .amplify-checkbox__label--disabled {
            color: var(--amplify-components-checkbox-label-disabled-color);
          }

          .amplify-checkboxfield {
            align-content: var(--amplify-components-checkboxfield-align-content);
            align-items: var(--amplify-components-checkboxfield-align-items);
            flex-direction: var(--amplify-components-checkboxfield-flex-direction);
            justify-content: var(--amplify-components-checkboxfield-justify-content);
          }

          .amplify-dialcodeselect {
            height: var(--amplify-components-countrycodeselect-height);
          }

          .amplify-divider {
            --amplify-internal-divider-size: var(
              --amplify-components-divider-border-width
            );
            border-color: var(--amplify-components-divider-border-color);
            border-style: var(--amplify-components-divider-border-style);
            border-width: 0;
            opacity: var(--amplify-components-divider-opacity);
            padding: 0;
            display: flex;
            position: relative;
            text-align: center;
            justify-content: center;
          }
          .amplify-divider::after {
            content: attr(data-label);
            position: absolute;
            transform: translateY(-50%);
            font-size: var(--amplify-components-divider-label-font-size);
            padding-inline: var(--amplify-components-divider-label-padding-inline);
            background-color: var(--amplify-components-divider-label-background-color);
            color: var(--amplify-components-divider-label-color);
          }
          .amplify-divider--small {
            --amplify-internal-divider-size: var(
              --amplify-components-divider-small-border-width
            );
          }
          .amplify-divider--large {
            --amplify-internal-divider-size: var(
              --amplify-components-divider-large-border-width
            );
          }
          .amplify-divider--horizontal {
            width: 100%;
            border-bottom-width: var(--amplify-internal-divider-size);
          }
          .amplify-divider--vertical {
            border-left-width: var(--amplify-internal-divider-size);
            flex-direction: column;
          }
          .amplify-divider--vertical::after {
            top: auto;
            transform: translateX(-50%);
            padding-block: 0;
            padding-inline: 0;
          }

          .amplify-field {
            font-size: var(--amplify-components-field-font-size);
            gap: var(--amplify-components-field-gap);
            flex-direction: var(--amplify-components-field-flex-direction);
          }
          .amplify-field--small {
            font-size: var(--amplify-components-field-small-font-size);
            gap: var(--amplify-components-field-small-gap);
          }
          .amplify-field--large {
            font-size: var(--amplify-components-field-large-font-size);
            gap: var(--amplify-components-field-large-gap);
          }

          .amplify-label {
            color: var(--amplify-components-field-label-color);
          }

          .amplify-field-group__outer-end .amplify-select__wrapper .amplify-select, .amplify-field-group__outer-end .amplify-field-group__control, .amplify-field-group__outer-start .amplify-select__wrapper:not(:first-child) .amplify-select:not(:first-child), .amplify-field-group__outer-start--quiet .amplify-field-group__control, .amplify-field-group__outer-start .amplify-field-group__control:not(:first-child), .amplify-field-group :not(:first-child) .amplify-input {
            border-start-start-radius: 0;
            border-end-start-radius: 0;
          }
          @supports not (border-start-start-radius: 0) {
            .amplify-field-group__outer-end .amplify-select__wrapper .amplify-select, .amplify-field-group__outer-end .amplify-field-group__control, .amplify-field-group__outer-start .amplify-select__wrapper:not(:first-child) .amplify-select:not(:first-child), .amplify-field-group__outer-start--quiet .amplify-field-group__control, .amplify-field-group__outer-start .amplify-field-group__control:not(:first-child), .amplify-field-group :not(:first-child) .amplify-input {
              border-top-left-radius: 0;
              border-bottom-left-radius: 0;
            }
          }

          .amplify-field-group__outer-end .amplify-select__wrapper:not(:last-child) .amplify-select, .amplify-field-group__outer-end--quiet .amplify-field-group__control, .amplify-field-group__outer-end .amplify-field-group__control:not(:last-child), .amplify-field-group__outer-start .amplify-select__wrapper .amplify-select, .amplify-field-group__outer-start .amplify-field-group__control, .amplify-field-group :not(:last-child) .amplify-input {
            border-end-end-radius: 0;
            border-start-end-radius: 0;
          }
          @supports not (border-end-end-radius: 0) {
            .amplify-field-group__outer-end .amplify-select__wrapper:not(:last-child) .amplify-select, .amplify-field-group__outer-end--quiet .amplify-field-group__control, .amplify-field-group__outer-end .amplify-field-group__control:not(:last-child), .amplify-field-group__outer-start .amplify-select__wrapper .amplify-select, .amplify-field-group__outer-start .amplify-field-group__control, .amplify-field-group :not(:last-child) .amplify-input {
              border-bottom-right-radius: 0;
              border-top-right-radius: 0;
            }
          }

          .amplify-field-group {
            gap: var(--amplify-components-fieldgroup-gap);
            align-self: stretch;
          }
          .amplify-field-group--horizontal {
            flex-direction: row;
          }
          .amplify-field-group--vertical {
            flex-direction: column;
            align-items: var(--amplify-components-fieldgroup-vertical-align-items);
          }
          .amplify-field-group__outer-start,
          .amplify-field-group__outer-end {
            display: flex;
            flex-shrink: 0;
            align-items: var(--amplify-components-fieldgroup-outer-align-items);
          }
          .amplify-field-group__outer-start .amplify-field-group__control,
          .amplify-field-group__outer-end .amplify-field-group__control {
            height: 100%;
          }

          /**
 * Outer field group components
 */
          .amplify-field-group__outer-start .amplify-field-group__control:not(:focus) {
            border-inline-end-color: transparent;
          }
          .amplify-field-group__outer-start .amplify-field-group__control:focus {
            z-index: 1;
          }
          .amplify-field-group__outer-start--quiet .amplify-field-group__control:not(:focus) {
            border-block-start-color: transparent;
            border-inline-start-color: transparent;
          }
          .amplify-field-group__outer-end .amplify-field-group__control:not(:focus) {
            border-inline-start-color: transparent;
          }
          .amplify-field-group__outer-end .amplify-field-group__control:focus {
            z-index: 1;
          }
          .amplify-field-group__outer-end--quiet .amplify-field-group__control:not(:focus) {
            border-block-start-color: transparent;
            border-inline-end-color: transparent;
          }
          /**
 * Inner field group components
 */
          .amplify-field-group__field-wrapper {
            position: relative;
            width: 100%;
          }
          .amplify-field-group__field-wrapper--vertical {
            width: -moz-fit-content;
            width: fit-content;
          }

          .amplify-field-group__inner-end,
          .amplify-field-group__inner-start {
            position: absolute;
            top: 0;
            height: 100%;
            pointer-events: none;
          }
          .amplify-field-group__inner-end .amplify-button,
          .amplify-field-group__inner-start .amplify-button {
            pointer-events: all;
            height: 100%;
          }

          .amplify-field-group__inner-end {
            right: 0;
            left: auto;
          }

          .amplify-field-group__inner-start {
            right: auto;
            left: 0;
          }

          html[dir=rtl] .amplify-field-group__inner-end {
            right: auto;
            left: 0;
          }
          html[dir=rtl] .amplify-field-group__inner-start {
            left: auto;
            right: 0;
          }

          .amplify-field-group--has-inner-end .amplify-input {
            padding-inline-end: calc(var(--amplify-components-fieldcontrol-padding-inline-end) * 3);
          }

          .amplify-field-group--has-inner-start .amplify-input {
            padding-inline-start: calc(var(--amplify-components-fieldcontrol-padding-inline-start) * 3);
          }

          /**
 * Inner icon (non-button) component styling requires additional styling
 */
          .amplify-field-group__icon:not(.amplify-field-group__icon-button) {
            display: flex;
            padding-inline-start: var(--amplify-components-fieldcontrol-padding-inline-start);
            padding-inline-end: var(--amplify-components-fieldcontrol-padding-inline-start);
            flex-direction: column;
            justify-content: center;
            height: 100%;
          }

          .amplify-fieldset {
            background-color: var(--amplify-components-fieldset-background-color);
            border-radius: var(--amplify-components-fieldset-border-radius);
            flex-direction: var(--amplify-components-fieldset-flex-direction);
            gap: var(--amplify-components-fieldset-gap);
            /* Sizes */
            /* Variations */
          }
          .amplify-fieldset--small {
            gap: var(--amplify-components-fieldset-small-gap);
          }
          .amplify-fieldset--large {
            gap: var(--amplify-components-fieldset-large-gap);
          }
          .amplify-fieldset--outlined {
            border: var(--amplify-components-fieldset-outlined-border-width) var(--amplify-components-fieldset-outlined-border-style) var(--amplify-components-fieldset-outlined-border-color);
            padding: var(--amplify-components-fieldset-outlined-padding);
          }
          .amplify-fieldset--outlined.amplify-fieldset--small {
            padding: var(--amplify-components-fieldset-outlined-small-padding);
          }
          .amplify-fieldset--outlined.amplify-fieldset--large {
            padding: var(--amplify-components-fieldset-outlined-large-padding);
          }

          .amplify-fieldset__legend {
            color: var(--amplify-components-fieldset-legend-color);
            font-weight: var(--amplify-components-fieldset-legend-font-weight);
            line-height: var(--amplify-components-fieldset-legend-line-height);
            font-size: var(--amplify-components-fieldset-legend-font-size);
          }
          .amplify-fieldset__legend--small {
            font-size: var(--amplify-components-fieldset-legend-small-font-size);
          }
          .amplify-fieldset__legend--large {
            font-size: var(--amplify-components-fieldset-legend-large-font-size);
          }

          .amplify-liveness-cancel-container {
            z-index: 2;
            position: absolute;
            top: var(--amplify-space-medium);
            right: var(--amplify-space-medium);
          }

          .liveness-detector .amplify-button--primary:focus {
            box-shadow: unset;
            outline: var(--amplify-components-button-focus-color) solid 2px;
            outline-offset: 2px;
          }

          .amplify-liveness-cancel-button {
            background-color: #fff;
            color: hsl(190, 95%, 30%);
          }

          .amplify-liveness-fade-out {
            animation-name: amplify-liveness-animation-fadeout;
            animation-duration: 1s;
            animation-fill-mode: forwards;
          }

          @keyframes amplify-liveness-animation-fadeout {
            from {
              opacity: 1;
            }
            to {
              opacity: 0;
            }
          }
          .amplify-liveness-camera-module {
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background-color: var(--amplify-components-liveness-camera-module-background-color);
            border: 1px solid var(--amplify-colors-neutral-40);
            position: relative;
          }

          .amplify-liveness-camera-module--mobile {
            position: fixed;
            top: 0;
            left: 0;
            height: 100%;
            width: 100%;
            z-index: 2;
          }

          .amplify-liveness-video {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            transform: scaleX(-1);
          }

          .amplify-liveness-freshness-canvas {
            height: 100%;
            width: 100%;
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 1;
          }

          .amplify-liveness-loader {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
          }

          .amplify-liveness-oval-canvas {
            flex-direction: column;
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            align-items: center;
            justify-content: center;
          }

          .amplify-liveness-oval-canvas--mobile {
            position: fixed;
          }

          .amplify-liveness-video-anchor {
            position: relative;
            width: 100%;
          }

          .amplify-liveness-recording-icon-container {
            z-index: 1;
            position: absolute;
            top: var(--amplify-space-medium);
            left: var(--amplify-space-medium);
          }

          .amplify-liveness-recording-icon {
            flex-direction: column;
            align-items: center;
            background-color: #fff;
            padding: var(--amplify-space-xxs);
            gap: var(--amplify-space-xxs);
            border-radius: var(--amplify-radii-small);
          }

          .amplify-liveness-recording-icon .amplify-text {
            color: var(--amplify-colors-black);
          }

          .amplify-liveness-instruction-overlay {
            z-index: 2;
          }

          .amplify-liveness-countdown-container {
            background-color: var(--amplify-colors-background-primary);
            border-radius: 100%;
            padding: var(--amplify-space-xs);
          }

          .amplify-liveness-instruction-list {
            flex-direction: column;
          }
          .amplify-liveness-instruction-list li {
            display: flex;
          }

          .amplify-liveness-toast {
            background-color: var(--amplify-colors-background-primary);
            padding: var(--amplify-space-small);
            max-width: 100%;
          }

          .amplify-liveness-toast__message {
            color: var(--amplify-colors-font-primary);
            text-align: center;
            flex-direction: column;
          }

          .amplify-liveness-toast--medium {
            border-radius: var(--amplify-radii-medium);
          }

          .amplify-liveness-toast--large {
            font-size: var(--amplify-font-sizes-xxl);
            padding: 0 var(--amplify-space-xs);
          }

          .amplify-liveness-toast--primary {
            background-color: var(--amplify-colors-primary-80);
          }
          .amplify-liveness-toast--primary .amplify-liveness-toast__message {
            color: var(--amplify-colors-font-inverse);
            text-align: center;
            flex-direction: column;
          }

          .amplify-liveness-toast__container {
            gap: var(--amplify-space-xs);
            flex-direction: column;
            align-items: center;
          }

          .amplify-liveness-toast--error {
            background-color: var(--amplify-colors-red-80);
          }
          .amplify-liveness-toast--error .amplify-liveness-toast__message {
            color: var(--amplify-colors-font-inverse);
          }

          .amplify-liveness-match-indicator {
            display: block;
            width: min(70%, 200px);
            position: relative;
            --amplify-liveness-match-indicator-transition: transform 0.2s linear;
          }

          .amplify-liveness-match-indicator__bar {
            --percentage: 0;
            display: block;
            width: 100%;
            height: var(--amplify-space-medium);
            border-radius: var(--amplify-radii-medium);
            background: var(--amplify-colors-white);
            position: relative;
            overflow: hidden;
            /*
    This translateZ transform fixes in issue in Safari where the bar::after
    element doesn't appear clipped from overflow: hidden here */
            transform: translateZ(0);
            border: 1px solid var(--amplify-colors-border-tertiary);
          }

          .amplify-liveness-match-indicator__pin {
            --percentage: 0;
            display: block;
            width: 100%;
            position: absolute;
            top: 50%;
            left: 0;
            transform: translate(var(--percentage), 0);
            transition: var(--amplify-liveness-match-indicator-transition);
          }

          .amplify-liveness-match-indicator__bar:after {
            position: absolute;
            content: "";
            width: 100%;
            height: 100%;
            background: var(--amplify-colors-primary-80);
            left: -100%;
            transform: translate(var(--percentage), 0);
            transition: var(--amplify-liveness-match-indicator-transition);
          }

          .amplify-liveness-match-indicator__pin:after {
            --height: var(--amplify-space-xl);
            position: absolute;
            content: "";
            width: var(--amplify-space-small);
            height: var(--height);
            border-radius: var(--amplify-radii-medium);
            background: var(--amplify-colors-primary-80);
            left: 0;
            top: 0;
            transform: translate(-50%, calc(var(--height) / 2 * -1));
          }

          .amplify-liveness-figures {
            flex-wrap: wrap;
          }

          .amplify-liveness-figure {
            flex-direction: column;
            gap: 0;
          }

          .amplify-liveness-figure__caption {
            padding: var(--amplify-space-xxs);
          }

          .amplify-liveness-figure__caption--success {
            background-color: var(--amplify-colors-background-success);
            color: var(--amplify-colors-font-success);
          }

          .amplify-liveness-figure__caption--error {
            background-color: var(--amplify-colors-background-error);
            color: var(--amplify-colors-font-error);
          }

          .amplify-liveness-figure__image {
            background-color: #fff;
            border: 1px solid var(--amplify-colors-border-primary);
            position: relative;
            display: flex;
            justify-content: center;
          }
          .amplify-liveness-figure__image svg {
            display: block;
          }

          .amplify-liveness-figure__image--success {
            border-color: var(--amplify-colors-green-90);
          }

          .amplify-liveness-figure__image--error {
            border-color: var(--amplify-colors-border-error);
          }

          .amplify-liveness-figure__icon {
            position: absolute;
            left: 0;
            top: 0;
          }

          .amplify-liveness-landscape-error-modal {
            background-color: var(--amplify-colors-background-primary);
            flex-direction: column;
            text-align: center;
            align-items: center;
            justify-content: center;
            width: 100%;
          }

          .amplify-liveness-landscape-error-modal__header {
            font-size: large;
            font-weight: var(--amplify-font-weights-bold);
          }

          .amplify-liveness-landscape-error-modal__button {
            justify-content: center;
          }

          .amplify-liveness-start-screen-header {
            display: flex;
            flex-direction: column;
          }

          .amplify-liveness-start-screen-header__heading {
            color: var(--amplify-colors-font-primary);
            font-weight: var(--amplify-font-weights-bold);
          }

          .amplify-liveness-start-screen-header__body {
            color: var(--amplify-colors-font-primary);
          }

          .amplify-liveness-start-screen-warning {
            color: var(--amplify-colors-blue-90);
            background-color: var(--amplify-colors-blue-10);
            align-items: center;
            z-index: 3;
          }

          .amplify-liveness-start-screen-instructions__heading {
            color: var(--amplify-colors-font-primary);
            font-weight: var(--amplify-font-weights-bold);
          }

          .amplify-liveness-overlay-opaque {
            background-color: var(--amplify-colors-overlay-40);
          }

          .amplify-liveness-overlay {
            flex-direction: column;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            padding: var(--amplify-space-large);
          }

          .amplify-liveness-error-modal {
            gap: var(--amplify-space-xs);
            align-items: center;
            justify-content: center;
            color: var(--amplify-colors-font-error);
          }

          .amplify-liveness-error-modal__heading {
            font-weight: var(--amplify-font-weights-bold);
          }

          .amplify-liveness-hint--mobile {
            margin-top: var(--amplify-space-xxxl);
          }

          .amplify-liveness-hint__text {
            align-items: center;
            gap: var(--amplify-space-xs);
          }

          .amplify-liveness-popover {
            position: relative;
          }

          .amplify-liveness-popover__anchor {
            position: absolute;
            top: 26px;
            left: 20px;
            z-index: 3;
            border-style: solid;
            border-width: 0 9px 9px 9px;
            border-color: transparent transparent var(--amplify-colors-background-primary) transparent;
          }

          .amplify-liveness-popover__anchor-secondary {
            position: absolute;
            top: 24px;
            left: 19px;
            z-index: 2;
            border-style: solid;
            border-width: 0 10px 10px 10px;
            border-color: transparent transparent var(--amplify-colors-border-secondary) transparent;
          }

          .amplify-liveness-popover__container {
            position: absolute;
            background-color: var(--amplify-colors-background-primary);
            color: var(--amplify-colors-font-primary);
            flex-direction: row;
            font-size: var(--amplify-font-sizes-xs);
            font-weight: var(--amplify-font-weights-normal);
            padding: var(--amplify-space-small);
            top: 33px;
            width: 240px;
            border: 1px solid var(--amplify-colors-border-secondary);
            border-radius: 2px;
            z-index: 4;
          }

          .amplify-liveness-start-screen-camera-select {
            flex-direction: column;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            padding: var(--amplify-space-xl);
            align-items: center;
            justify-content: flex-end;
            display: flex;
            z-index: 2;
          }

          .amplify-liveness-start-screen-camera-select__container {
            display: flex;
            justify-content: space-between;
            align-items: inherit;
            gap: var(--amplify-space-xs);
          }

          .amplify-liveness-start-screen-camera-select__label,
          .amplify-liveness-start-screen-camera-select .amplify-select,
          .amplify-liveness-start-screen-camera-select .amplify-select__wrapper,
          .amplify-liveness-start-screen-camera-select .amplify-select__icon-wrapper {
            background-color: var(--amplify-colors-background-primary);
            color: var(--amplify-colors-font-primary);
          }

          .amplify-liveness-start-screen-camera-waiting {
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            height: 480px;
          }

          .amplify-menu__wrapper {
            z-index: 999999;
          }

          .amplify-menu__trigger {
            display: flex;
            justify-content: center;
            align-items: center;
          }

          .amplify-menu__content {
            background-color: var(--amplify-components-menu-background-color);
            border-radius: var(--amplify-components-menu-border-radius);
            box-shadow: var(--amplify-components-menu-box-shadow);
            flex-direction: var(--amplify-components-menu-flex-direction);
            gap: var(--amplify-components-menu-gap);
            min-width: var(--amplify-components-menu-min-width);
            max-width: var(--amplify-components-menu-max-width);
            border-color: var(--amplify-components-menu-border-color);
            border-width: var(--amplify-components-menu-border-width);
            border-style: var(--amplify-components-menu-border-style);
          }

          .amplify-menu__content__item {
            min-height: var(--amplify-components-menu-item-min-height);
            padding-inline-start: var(--amplify-components-menu-item-padding-inline-start);
            padding-inline-end: var(--amplify-components-menu-item-padding-inline-end);
          }

          .amplify-menu__content__item:not(:first-child):not(:last-child) {
            border-radius: 0;
          }

          .amplify-menu__content__item:first-child {
            border-end-end-radius: 0;
            border-end-start-radius: 0;
          }
          @supports not (border-end-end-radius: 0) {
            .amplify-menu__content__item:first-child {
              border-bottom-right-radius: 0;
              border-bottom-left-radius: 0;
            }
          }

          .amplify-menu__content__item:last-child {
            border-start-end-radius: 0;
            border-start-start-radius: 0;
          }
          @supports not (border-end-end-radius: 0) {
            .amplify-menu__content__item:last-child {
              border-top-right-radius: 0;
              border-top-left-radius: 0;
            }
          }

          .amplify-message {
            align-items: var(--amplify-components-message-align-items);
            background-color: var(--amplify-components-message-background-color);
            color: var(--amplify-components-message-color);
            justify-content: var(--amplify-components-message-justify-content);
            padding-block: var(--amplify-components-message-padding-block);
            padding-inline: var(--amplify-components-message-padding-inline);
            border-color: var(--amplify-components-message-border-color);
            border-radius: var(--amplify-components-message-border-radius);
            border-style: var(--amplify-components-message-border-style);
            border-width: var(--amplify-components-message-border-width);
            line-height: var(--amplify-components-message-line-height);
          }
          .amplify-message--plain {
            background-color: var(--amplify-components-message-plain-background-color);
            border-color: var(--amplify-components-message-plain-border-color);
            color: var(--amplify-components-message-plain-color);
          }
          .amplify-message--plain.amplify-message--info {
            background-color: var(--amplify-components-message-plain-info-background-color);
            border-color: var(--amplify-components-message-plain-info-border-color);
            color: var(--amplify-components-message-plain-info-color);
          }
          .amplify-message--plain.amplify-message--error {
            background-color: var(--amplify-components-message-plain-error-background-color);
            border-color: var(--amplify-components-message-plain-error-border-color);
            color: var(--amplify-components-message-plain-error-color);
          }
          .amplify-message--plain.amplify-message--warning {
            background-color: var(--amplify-components-message-plain-warning-background-color);
            border-color: var(--amplify-components-message-plain-warning-border-color);
            color: var(--amplify-components-message-plain-warning-color);
          }
          .amplify-message--plain.amplify-message--success {
            background-color: var(--amplify-components-message-plain-success-background-color);
            border-color: var(--amplify-components-message-plain-success-border-color);
            color: var(--amplify-components-message-plain-success-color);
          }
          .amplify-message--outlined {
            background-color: var(--amplify-components-message-outlined-background-color);
            border-color: var(--amplify-components-message-outlined-border-color);
            color: var(--amplify-components-message-outlined-color);
          }
          .amplify-message--outlined.amplify-message--info {
            background-color: var(--amplify-components-message-outlined-info-background-color);
            border-color: var(--amplify-components-message-outlined-info-border-color);
            color: var(--amplify-components-message-outlined-info-color);
          }
          .amplify-message--outlined.amplify-message--error {
            background-color: var(--amplify-components-message-outlined-error-background-color);
            border-color: var(--amplify-components-message-outlined-error-border-color);
            color: var(--amplify-components-message-outlined-error-color);
          }
          .amplify-message--outlined.amplify-message--warning {
            background-color: var(--amplify-components-message-outlined-warning-background-color);
            border-color: var(--amplify-components-message-outlined-warning-border-color);
            color: var(--amplify-components-message-outlined-warning-color);
          }
          .amplify-message--outlined.amplify-message--success {
            background-color: var(--amplify-components-message-outlined-success-background-color);
            border-color: var(--amplify-components-message-outlined-success-border-color);
            color: var(--amplify-components-message-outlined-success-color);
          }
          .amplify-message--filled {
            background-color: var(--amplify-components-message-filled-background-color);
            border-color: var(--amplify-components-message-filled-border-color);
            color: var(--amplify-components-message-filled-color);
          }
          .amplify-message--filled.amplify-message--info {
            background-color: var(--amplify-components-message-filled-info-background-color);
            border-color: var(--amplify-components-message-filled-info-border-color);
            color: var(--amplify-components-message-filled-info-color);
          }
          .amplify-message--filled.amplify-message--error {
            background-color: var(--amplify-components-message-filled-error-background-color);
            border-color: var(--amplify-components-message-filled-error-border-color);
            color: var(--amplify-components-message-filled-error-color);
          }
          .amplify-message--filled.amplify-message--warning {
            background-color: var(--amplify-components-message-filled-warning-background-color);
            border-color: var(--amplify-components-message-filled-warning-border-color);
            color: var(--amplify-components-message-filled-warning-color);
          }
          .amplify-message--filled.amplify-message--success {
            background-color: var(--amplify-components-message-filled-success-background-color);
            border-color: var(--amplify-components-message-filled-success-border-color);
            color: var(--amplify-components-message-filled-success-color);
          }

          .amplify-message__icon {
            font-size: var(--amplify-components-message-icon-size);
          }
          .amplify-message__icon > * {
            display: block;
          }

          .amplify-message__heading {
            font-weight: var(--amplify-components-message-heading-font-weight);
            font-size: var(--amplify-components-message-heading-font-size);
          }

          .amplify-message__content {
            flex: 1;
            flex-direction: column;
            gap: var(--amplify-space-xxxs);
          }

          .amplify-message__dismiss {
            margin-inline-start: auto;
            gap: var(--amplify-components-message-dismiss-gap);
          }

          .amplify-pagination {
            list-style-type: none;
          }
          .amplify-pagination__item {
            height: var(--amplify-components-pagination-item-shared-height);
            min-width: var(--amplify-components-pagination-item-shared-min-width);
            border-radius: var(--amplify-components-pagination-item-shared-border-radius);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: initial;
            color: var(--amplify-components-pagination-button-color);
            margin-inline-start: var(--amplify-components-pagination-item-container-margin-left);
            margin-inline-end: var(--amplify-components-pagination-item-container-margin-right);
            padding-inline-start: var(--amplify-components-pagination-button-padding-inline-start);
            padding-inline-end: var(--amplify-components-pagination-button-padding-inline-end);
            transition-property: var(--amplify-components-pagination-button-transition-property);
            transition-duration: var(--amplify-components-pagination-button-transition-duration);
          }
          .amplify-pagination__item:hover {
            text-decoration: none;
            color: var(--amplify-components-pagination-button-hover-color);
            background-color: var(--amplify-components-pagination-button-hover-background-color);
          }
          .amplify-pagination__item--disabled {
            color: var(--amplify-components-pagination-button-disabled-color);
            pointer-events: none;
          }
          .amplify-pagination__item--current {
            align-items: var(--amplify-components-pagination-current-align-items);
            justify-content: var(--amplify-components-pagination-current-justify-content);
            color: var(--amplify-components-pagination-current-color);
            font-size: var(--amplify-components-pagination-current-font-size);
            background-color: var(--amplify-components-pagination-current-background-color);
          }
          .amplify-pagination__item--ellipsis {
            align-items: var(--amplify-components-pagination-ellipsis-align-items);
            justify-content: var(--amplify-components-pagination-ellipsis-justify-content);
            padding-inline-start: var(--amplify-components-pagination-ellipsis-padding-inline-start);
            padding-inline-end: var(--amplify-components-pagination-ellipsis-padding-inline-end);
          }

          .amplify-passwordfield {
            --amplify-components-fieldcontrol-color: var(
              --amplify-components-passwordfield-color
            );
            --amplify-components-button-color: var(
              --amplify-components-passwordfield-button-color
            );
            --amplify-components-button-active-background-color: var(
              --amplify-components-passwordfield-button-active-background-color
            );
            --amplify-components-button-active-border-color: var(
              --amplify-components-passwordfield-button-active-border-color
            );
            --amplify-components-button-active-color: var(
              --amplify-components-passwordfield-button-active-color
            );
            --amplify-components-button-disabled-background-color: var(
              --amplify-components-passwordfield-button-disabled-background-color
            );
            --amplify-components-button-disabled-border-color: var(
              --amplify-components-passwordfield-button-disabled-border-color
            );
            --amplify-components-button-disabled-color: var(
              --amplify-components-passwordfield-button-disabled-color
            );
            --amplify-components-button-focus-background-color: var(
              --amplify-components-passwordfield-button-focus-background-color
            );
            --amplify-components-button-focus-border-color: var(
              --amplify-components-passwordfield-button-focus-border-color
            );
            --amplify-components-button-focus-color: var(
              --amplify-components-passwordfield-button-focus-color
            );
            --amplify-components-button-hover-background-color: var(
              --amplify-components-passwordfield-button-hover-background-color
            );
            --amplify-components-button-hover-border-color: var(
              --amplify-components-passwordfield-button-hover-border-color
            );
            --amplify-components-button-hover-color: var(
              --amplify-components-passwordfield-button-hover-color
            );
            --amplify-components-button-outlined-error-color: var(
              --amplify-components-passwordfield-button-error-color
            );
            --amplify-components-button-outlined-error-border-color: var(
              --amplify-components-passwordfield-button-error-border-color
            );
            --amplify-components-button-outlined-error-background-color: var(
              --amplify-components-passwordfield-button-error-background-color
            );
            --amplify-components-button-outlined-error-active-color: var(
              --amplify-components-passwordfield-button-error-active-color
            );
            --amplify-components-button-outlined-error-active-border-color: var(
              --amplify-components-passwordfield-button-error-active-border-color
            );
            --amplify-components-button-outlined-error-active-background-color: var(
              --amplify-components-passwordfield-button-error-active-background-color
            );
            --amplify-components-button-outlined-error-hover-color: var(
              --amplify-components-passwordfield-button-error-hover-color
            );
            --amplify-components-button-outlined-error-hover-border-color: var(
              --amplify-components-passwordfield-button-error-hover-border-color
            );
            --amplify-components-button-outlined-error-hover-background-color: var(
              --amplify-components-passwordfield-button-error-hover-background-color
            );
            --amplify-components-button-outlined-error-focus-color: var(
              --amplify-components-passwordfield-button-error-focus-color
            );
            --amplify-components-button-outlined-error-focus-box-shadow: var(
              --amplify-components-passwordfield-button-error-focus-box-shadow
            );
            --amplify-components-button-outlined-error-focus-border-color: var(
              --amplify-components-passwordfield-button-error-focus-border-color
            );
            --amplify-components-button-outlined-error-focus-background-color: var(
              --amplify-components-passwordfield-button-error-focus-background-color
            );
          }

          .amplify-phonenumberfield select:not(:focus) {
            border-right: none;
          }

          .amplify-phonenumberfield {
            --amplify-components-selectfield-color: var(
              --amplify-components-phonenumberfield-color
            );
            --amplify-components-selectfield-border-color: var(
              --amplify-components-phonenumberfield-border-color
            );
            --amplify-components-selectfield-font-size: var(
              --amplify-components-phonenumberfield-font-size
            );
            --amplify-components-selectfield-focus-border-color: var(
              --amplify-components-phonenumberfield-focus-border-color
            );
            --amplify-components-textfield-color: var(
              --amplify-components-phonenumberfield-color
            );
            --amplify-components-textfield-border-color: var(
              --amplify-components-phonenumberfield-border-color
            );
            --amplify-components-textfield-font-size: var(
              --amplify-components-phonenumberfield-font-size
            );
            --amplify-components-textfield-focus-border-color: var(
              --amplify-components-phonenumberfield-focus-border-color
            );
          }

          .amplify-rating {
            display: flex;
            position: relative;
            text-align: left;
            font-size: var(--amplify-components-rating-default-size);
            line-height: var(--amplify-components-rating-default-size);
          }
          .amplify-rating--small {
            font-size: var(--amplify-components-rating-small-size);
            line-height: var(--amplify-components-rating-small-size);
          }
          .amplify-rating--large {
            font-size: var(--amplify-components-rating-large-size);
            line-height: var(--amplify-components-rating-large-size);
          }
          .amplify-rating__item {
            position: relative;
            height: 1em;
            width: 1em;
          }
          .amplify-rating__icon {
            width: 1em;
            height: 1em;
            display: block;
            position: absolute;
            overflow: hidden;
          }
          .amplify-rating__icon--filled {
            color: var(--amplify-components-rating-filled-color);
          }
          .amplify-rating__icon--empty {
            color: var(--amplify-components-rating-empty-color);
          }

          .amplify-radio {
            align-items: var(--amplify-components-radio-align-items);
            justify-content: var(--amplify-components-radio-justify-content);
            gap: inherit;
            flex-direction: row-reverse;
            position: relative;
          }
          .amplify-radio--disabled {
            cursor: var(--amplify-components-radio-disabled-cursor);
          }

          .amplify-radio__button {
            flex-shrink: 0;
            align-items: var(--amplify-components-radio-button-align-items);
            justify-content: var(--amplify-components-radio-button-justify-content);
            padding: var(--amplify-components-radio-button-padding);
            box-sizing: var(--amplify-components-radio-button-box-sizing);
            border-width: var(--amplify-components-radio-button-border-width);
            border-style: var(--amplify-components-radio-button-border-style);
            border-radius: var(--amplify-components-radio-button-border-radius);
            border-color: var(--amplify-components-radio-button-border-color);
            color: var(--amplify-components-radio-button-color);
            background-color: var(--amplify-components-radio-button-background-color);
            transition-property: var(--amplify-components-radio-button-transition-property);
            transition-duration: var(--amplify-components-radio-button-transition-duration);
            width: var(--amplify-components-radio-button-width);
            height: var(--amplify-components-radio-button-height);
            outline-color: var(--amplify-components-radio-button-outline-color);
            outline-style: var(--amplify-components-radio-button-outline-style);
            outline-width: var(--amplify-components-radio-button-outline-width);
            outline-offset: var(--amplify-components-radio-button-outline-offset);
          }
          .amplify-radio__button::before {
            content: "";
            display: inline-block;
            width: 100%;
            height: 100%;
            border-radius: var(--amplify-components-radio-button-before-border-radius);
            background-color: currentColor;
            border-radius: 50%;
          }
          .amplify-radio__button--small {
            width: var(--amplify-components-radio-button-small-width);
            height: var(--amplify-components-radio-button-small-height);
          }
          .amplify-radio__button--large {
            width: var(--amplify-components-radio-button-large-width);
            height: var(--amplify-components-radio-button-large-height);
          }

          .amplify-radio__input:checked + .amplify-radio__button {
            color: var(--amplify-components-radio-button-checked-color);
          }

          .amplify-radio__input:checked:disabled + .amplify-radio__button {
            color: var(--amplify-components-radio-button-checked-disabled-color);
          }

          .amplify-radio__input:focus + .amplify-radio__button {
            border-color: var(--amplify-components-radio-button-focus-border-color);
            box-shadow: var(--amplify-components-radio-button-focus-box-shadow);
          }

          .amplify-radio__input[aria-invalid=true] + .amplify-radio__button {
            border-color: var(--amplify-components-radio-button-error-border-color);
          }

          .amplify-radio__input[aria-invalid=true]:focus + .amplify-radio__button {
            box-shadow: var(--amplify-components-radio-button-error-focus-box-shadow);
          }

          .amplify-radio__input:disabled + .amplify-radio__button {
            border-color: var(--amplify-components-radio-button-disabled-border-color);
            background-color: var(--amplify-components-radio-button-disabled-background-color);
          }

          .amplify-radio__label {
            color: var(--amplify-components-radio-label-color);
          }
          .amplify-radio__label--disabled {
            color: var(--amplify-components-radio-label-disabled-color);
          }

          .amplify-radiogroup {
            gap: inherit;
            flex-direction: inherit;
            align-items: inherit;
          }

          .amplify-radiogroupfield {
            flex-direction: column;
            align-items: flex-start;
            --amplify-components-fieldset-legend-color: var(
              --amplify-components-radiogroup-legend-color
            );
            --amplify-components-fieldset-legend-font-weight: var(
              --amplify-components-radiogroup-legend-font-weight
            );
            --amplify-components-radio-button-border-width: var(
              --amplify-components-radiogroup-radio-border-width
            );
            --amplify-components-radio-button-border-color: var(
              --amplify-components-radiogroup-radio-border-color
            );
            --amplify-components-radio-button-background-color: var(
              --amplify-components-radiogroup-radio-background-color
            );
            --amplify-components-radio-label-color: var(
              --amplify-components-radiogroup-radio-label-color
            );
            --amplify-components-radio-button-checked-color: var(
              --amplify-components-radiogroup-radio-checked-color
            );
          }

          .amplify-searchfield {
            --amplify-components-fieldcontrol-color: var(
              --amplify-components-searchfield-input-color
            );
          }
          .amplify-searchfield__search {
            color: var(--amplify-components-searchfield-button-color);
            background-color: var(--amplify-components-searchfield-button-background-color);
          }
          .amplify-searchfield__search:active {
            background-color: var(--amplify-components-button-active-background-color);
            border-color: var(--amplify-components-button-active-border-color);
            color: var(--amplify-components-button-active-color);
          }
          .amplify-searchfield__search:focus {
            background-color: var(--amplify-components-searchfield-button-focus-background-color);
            border-color: var(--amplify-components-searchfield-button-focus-border-color);
            color: var(--amplify-components-searchfield-button-focus-color);
          }
          .amplify-searchfield__search:hover {
            background-color: var(--amplify-components-searchfield-button-hover-background-color);
            border-color: var(--amplify-components-searchfield-button-hover-border-color);
            color: var(--amplify-components-searchfield-button-hover-color);
          }
          .amplify-searchfield__search:disabled {
            background-color: var(--amplify-components-searchfield-button-disabled-background-color);
            border-color: var(--amplify-components-searchfield-button-disabled-border-color);
            color: var(--amplify-components-searchfield-button-disabled-color);
          }

          .amplify-select__wrapper {
            flex: var(--amplify-components-select-wrapper-flex);
            display: var(--amplify-components-select-wrapper-display);
            position: var(--amplify-components-select-wrapper-position);
            cursor: var(--amplify-components-select-wrapper-cursor);
            align-self: stretch;
          }

          .amplify-select__icon {
            color: var(--amplify-components-fieldcontrol-color);
            align-items: var(--amplify-components-select-icon-wrapper-align-items);
            position: var(--amplify-components-select-icon-wrapper-position);
            top: var(--amplify-components-select-icon-wrapper-top);
            right: var(--amplify-components-select-icon-wrapper-right);
            transform: var(--amplify-components-select-icon-wrapper-transform);
            pointer-events: var(--amplify-components-select-icon-wrapper-pointer-events);
          }
          .amplify-select__icon--small {
            right: var(--amplify-components-select-icon-wrapper-small-right);
          }
          .amplify-select__icon--large {
            right: var(--amplify-components-select-icon-wrapper-large-right);
          }

          .amplify-select {
            box-sizing: border-box;
            color: var(--amplify-components-fieldcontrol-color);
            font-size: var(--amplify-components-fieldcontrol-font-size);
            line-height: var(--amplify-components-fieldcontrol-line-height);
            padding-block-start: var(--amplify-components-fieldcontrol-padding-block-start);
            padding-block-end: var(--amplify-components-fieldcontrol-padding-block-end);
            padding-inline-start: var(--amplify-components-fieldcontrol-padding-inline-start);
            padding-inline-end: var(--amplify-components-fieldcontrol-padding-inline-end);
            transition: all var(--amplify-components-fieldcontrol-transition-duration);
            width: 100%;
            border-color: var(--amplify-components-fieldcontrol-border-color);
            border-radius: var(--amplify-components-fieldcontrol-border-radius);
            border-style: var(--amplify-components-fieldcontrol-border-style);
            border-width: var(--amplify-components-fieldcontrol-border-width);
            outline-color: var(--amplify-components-fieldcontrol-outline-color);
            outline-style: var(--amplify-components-fieldcontrol-outline-style);
            outline-width: var(--amplify-components-fieldcontrol-outline-width);
            outline-offset: var(--amplify-components-fieldcontrol-outline-offset);
            background-color: var(--amplify-components-select-background-color);
            color: var(--amplify-components-select-color);
            min-width: var(--amplify-components-select-min-width);
            padding-inline-end: var(--amplify-components-select-padding-inline-end);
            white-space: var(--amplify-components-select-white-space);
          }
          .amplify-select:focus {
            border-color: var(--amplify-components-fieldcontrol-focus-border-color);
            box-shadow: var(--amplify-components-fieldcontrol-focus-box-shadow);
          }
          .amplify-select--small {
            font-size: var(--amplify-components-fieldcontrol-small-font-size);
            padding-block-start: var(--amplify-components-fieldcontrol-small-padding-block-start);
            padding-block-end: var(--amplify-components-fieldcontrol-small-padding-block-end);
            padding-inline-start: var(--amplify-components-fieldcontrol-small-padding-inline-start);
            padding-inline-end: var(--amplify-components-fieldcontrol-small-padding-inline-end);
          }
          .amplify-select--large {
            font-size: var(--amplify-components-fieldcontrol-large-font-size);
            padding-block-start: var(--amplify-components-fieldcontrol-large-padding-block-start);
            padding-block-end: var(--amplify-components-fieldcontrol-large-padding-block-end);
            padding-inline-start: var(--amplify-components-fieldcontrol-large-padding-inline-start);
            padding-inline-end: var(--amplify-components-fieldcontrol-large-padding-inline-end);
          }
          .amplify-select--error {
            border-color: var(--amplify-components-fieldcontrol-error-border-color);
          }
          .amplify-select--error:focus {
            border-color: var(--amplify-components-fieldcontrol-error-border-color);
            box-shadow: var(--amplify-components-fieldcontrol-error-focus-box-shadow);
          }
          .amplify-select--quiet {
            border-block-start: var(--amplify-components-fieldcontrol-quiet-border-block-start);
            border-inline-start: var(--amplify-components-fieldcontrol-quiet-border-inline-start);
            border-inline-end: var(--amplify-components-fieldcontrol-quiet-border-inline-end);
            border-radius: var(--amplify-components-fieldcontrol-quiet-border-radius);
          }
          .amplify-select--quiet:focus {
            border-block-end-color: var(--amplify-components-fieldcontrol-quiet-focus-border-block-end-color);
            box-shadow: var(--amplify-components-fieldcontrol-quiet-focus-box-shadow);
          }
          .amplify-select--quiet[aria-invalid=true] {
            border-block-end-color: var(--amplify-components-fieldcontrol-quiet-error-border-block-end-color);
          }
          .amplify-select--quiet[aria-invalid=true]:focus {
            border-block-end-color: var(--amplify-components-fieldcontrol-quiet-error-focus-border-block-end-color);
            box-shadow: var(--amplify-components-fieldcontrol-quiet-error-focus-box-shadow);
          }
          .amplify-select[disabled] {
            color: var(--amplify-components-fieldcontrol-disabled-color);
            cursor: var(--amplify-components-fieldcontrol-disabled-cursor);
            border-color: var(--amplify-components-fieldcontrol-disabled-border-color);
            background-color: var(--amplify-components-fieldcontrol-disabled-background-color);
          }
          .amplify-select option {
            background-color: var(--amplify-components-select-option-background-color);
            color: var(--amplify-components-select-option-color);
          }
          .amplify-select option[disabled=""] {
            background-color: var(--amplify-components-select-option-disabled-background-color);
            color: var(--amplify-components-select-option-disabled-color);
            cursor: var(--amplify-components-fieldcontrol-disabled-cursor);
          }
          .amplify-select[disabled] {
            background-color: var(--amplify-components-select-disabled-background-color);
            color: var(--amplify-components-select-disabled-color);
          }
          .amplify-select[disabled] option {
            color: inherit;
            background-color: inherit;
          }
          .amplify-select--small {
            min-width: var(--amplify-components-select-small-min-width);
            padding-inline-end: var(--amplify-components-select-small-padding-inline-end);
          }
          .amplify-select--large {
            min-width: var(--amplify-components-select-large-min-width);
            padding-inline-end: var(--amplify-components-select-large-padding-inline-end);
          }
          .amplify-select--expanded {
            overflow: auto;
            padding: var(--amplify-components-select-expanded-padding-block) var(--amplify-components-select-expanded-padding-inline);
          }
          .amplify-select--expanded option {
            padding: var(--amplify-components-select-expanded-option-padding-block) var(--amplify-components-select-expanded-option-padding-inline);
          }

          .amplify-selectfield {
            flex-direction: var(--amplify-components-selectfield-flex-direction);
            --amplify-components-fieldcontrol-border-color: var(
              --amplify-components-selectfield-border-color
            );
            --amplify-components-fieldcontrol-color: var(
              --amplify-components-selectfield-color
            );
            --amplify-components-fieldcontrol-font-size: var(
              --amplify-components-selectfield-font-size
            );
            --amplify-components-fieldcontrol-focus-border-color: var(
              --amplify-components-selectfield-focus-border-color
            );
            --amplify-components-field-label-color: var(
              --amplify-components-selectfield-label-color
            );
          }

          .amplify-sliderfield {
            flex-direction: column;
          }

          .amplify-sliderfield__label {
            display: flex;
            justify-content: space-between;
          }

          .amplify-sliderfield__root {
            align-items: center;
            box-sizing: content-box;
            display: flex;
            padding-block: var(--amplify-components-sliderfield-padding-block);
            position: relative;
            touch-action: none;
            -webkit-user-select: none;
            -moz-user-select: none;
            user-select: none;
            --amplify-internal-sliderfield-root-height: var(
              --amplify-components-sliderfield-thumb-height
            );
            --amplify-internal-sliderfield-root-width: var(
              --amplify-components-sliderfield-thumb-height
            );
          }
          .amplify-sliderfield__root--disabled {
            cursor: not-allowed;
          }
          .amplify-sliderfield__root--horizontal {
            height: var(--amplify-internal-sliderfield-root-height);
          }
          .amplify-sliderfield__root--vertical {
            flex-direction: column;
            width: var(--amplify-internal-sliderfield-root-width);
          }
          .amplify-sliderfield__root--large {
            --amplify-internal-sliderfield-root-height: var(
              --amplify-components-sliderfield-large-thumb-height
            );
            --amplify-internal-sliderfield-root-width: var(
              --amplify-components-sliderfield-large-thumb-height
            );
          }
          .amplify-sliderfield__root--small {
            --amplify-internal-sliderfield-root-height: var(
              --amplify-components-sliderfield-small-thumb-height
            );
            --amplify-internal-sliderfield-root-width: var(
              --amplify-components-sliderfield-small-thumb-height
            );
          }

          .amplify-sliderfield__track {
            position: relative;
            flex-grow: 1;
            border-radius: var(--amplify-components-sliderfield-track-border-radius);
            background-color: var(--amplify-components-sliderfield-track-background-color);
            --amplify-internal-sliderfield-track-height: var(
              --amplify-components-sliderfield-track-height
            );
            --amplify-internal-sliderfield-track-min-width: var(
              --amplify-components-sliderfield-track-min-width
            );
            --amplify-internal-sliderfield-track-width: var(
              --amplify-components-sliderfield-track-height
            );
            --amplify-internal-sliderfield-track-min-height: var(
              --amplify-components-sliderfield-track-min-width
            );
          }
          .amplify-sliderfield__track--horizontal {
            height: var(--amplify-internal-sliderfield-track-height);
            min-width: var(--amplify-internal-sliderfield-track-min-width);
          }
          .amplify-sliderfield__track--vertical {
            width: var(--amplify-internal-sliderfield-track-width);
            min-height: var(--amplify-internal-sliderfield-track-min-height);
          }
          .amplify-sliderfield__track--large {
            --amplify-internal-sliderfield-track-height: var(
              --amplify-components-sliderfield-large-track-height
            );
            --amplify-internal-sliderfield-track-width: var(
              --amplify-components-sliderfield-large-track-height
            );
          }
          .amplify-sliderfield__track--small {
            --amplify-internal-sliderfield-track-height: var(
              --amplify-components-sliderfield-small-track-height
            );
            --amplify-internal-sliderfield-track-width: var(
              --amplify-components-sliderfield-small-track-height
            );
          }

          .amplify-sliderfield__range {
            position: absolute;
            border-radius: var(--amplify-components-sliderfield-range-border-radius);
            background-color: var(--amplify-components-sliderfield-range-background-color);
          }
          .amplify-sliderfield__range--disabled {
            background-color: var(--amplify-components-sliderfield-range-disabled-background-color);
          }
          .amplify-sliderfield__range--horizontal {
            height: 100%;
          }
          .amplify-sliderfield__range--vertical {
            width: 100%;
          }

          .amplify-sliderfield__thumb {
            display: block;
            width: var(--amplify-components-sliderfield-thumb-width);
            height: var(--amplify-components-sliderfield-thumb-height);
            background-color: var(--amplify-components-sliderfield-thumb-background-color);
            box-shadow: var(--amplify-components-sliderfield-thumb-box-shadow);
            border-radius: var(--amplify-components-sliderfield-thumb-border-radius);
            border-width: var(--amplify-components-sliderfield-thumb-border-width);
            border-color: var(--amplify-components-sliderfield-thumb-border-color);
            border-style: var(--amplify-components-sliderfield-thumb-border-style);
          }
          .amplify-sliderfield__thumb:hover {
            background-color: var(--amplify-components-sliderfield-thumb-hover-background-color);
            border-color: var(--amplify-components-sliderfield-thumb-hover-border-color);
          }
          .amplify-sliderfield__thumb:focus {
            border-color: var(--amplify-components-sliderfield-thumb-focus-border-color);
            box-shadow: var(--amplify-components-sliderfield-thumb-focus-box-shadow);
          }
          .amplify-sliderfield__thumb--disabled {
            background-color: var(--amplify-components-sliderfield-thumb-disabled-background-color);
            border-color: var(--amplify-components-sliderfield-thumb-disabled-border-color);
            box-shadow: var(--amplify-components-sliderfield-thumb-disabled-box-shadow);
          }
          .amplify-sliderfield__thumb--large {
            width: var(--amplify-components-sliderfield-large-thumb-width);
            height: var(--amplify-components-sliderfield-large-thumb-height);
          }
          .amplify-sliderfield__thumb--small {
            width: var(--amplify-components-sliderfield-small-thumb-width);
            height: var(--amplify-components-sliderfield-small-thumb-height);
          }

          .amplify-stepperfield {
            flex-direction: var(--amplify-components-stepperfield-flex-direction);
            --amplify-components-fieldcontrol-border-color: var(
              --amplify-components-stepperfield-border-color
            );
            --amplify-components-button-border-color: var(
              --amplify-components-stepperfield-border-color
            );
            --amplify-components-fieldcontrol-color: var(
              --amplify-components-stepperfield-input-color
            );
            --amplify-components-fieldcontrol-font-size: var(
              --amplify-components-stepperfield-input-font-size
            );
            --amplify-components-button-color: var(
              --amplify-components-stepperfield-button-color
            );
            --amplify-components-button-active-color: var(
              --amplify-components-stepperfield-button-active-color
            );
            --amplify-components-button-active-background-color: var(
              --amplify-components-stepperfield-button-active-background-color
            );
            --amplify-components-button-focus-color: var(
              --amplify-components-stepperfield-button-focus-color
            );
            --amplify-components-button-focus-background-color: var(
              --amplify-components-stepperfield-button-focus-background-color
            );
            --amplify-components-button-disabled-color: var(
              --amplify-components-stepperfield-button-disabled-color
            );
            --amplify-components-button-disabled-background-color: var(
              --amplify-components-stepperfield-button-disabled-background-color
            );
            --amplify-components-button-hover-color: var(
              --amplify-components-stepperfield-button-hover-color
            );
            --amplify-components-button-hover-background-color: var(
              --amplify-components-stepperfield-button-hover-background-color
            );
          }

          .amplify-stepperfield__button--decrease,
          .amplify-stepperfield__button--increase {
            background-color: var(--amplify-components-stepperfield-button-background-color);
          }
          .amplify-stepperfield__button--decrease--disabled,
          .amplify-stepperfield__button--increase--disabled {
            background-color: var(--amplify-components-stepperfield-button-disabled-background-color);
          }
          .amplify-stepperfield__button--decrease--quiet,
          .amplify-stepperfield__button--increase--quiet {
            border-width: 0 0 var(--amplify-components-button-border-width) 0;
            border-radius: 0;
          }

          .amplify-stepperfield__button--decrease[data-invalid=true] {
            border-inline-end: none;
          }

          .amplify-stepperfield__button--increase[data-invalid=true] {
            border-inline-start: none;
          }

          .amplify-stepperfield__input {
            -moz-appearance: textfield;
            text-align: var(--amplify-components-stepperfield-input-text-align);
          }
          .amplify-stepperfield__input::-webkit-outer-spin-button, .amplify-stepperfield__input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
          .amplify-stepperfield__input:not(:focus, [aria-invalid=true]) {
            border-inline-start: none;
            border-inline-end: none;
          }

          .amplify-switchfield {
            display: inline-block;
            font-size: var(--amplify-components-switchfield-font-size);
            cursor: pointer;
          }
          .amplify-switchfield--small {
            font-size: var(--amplify-components-switchfield-small-font-size);
          }
          .amplify-switchfield--large {
            font-size: var(--amplify-components-switchfield-large-font-size);
          }

          .amplify-switch__wrapper {
            display: inline-flex;
            align-items: center;
          }
          .amplify-switch__wrapper--start {
            flex-direction: row;
          }
          .amplify-switch__wrapper--end {
            flex-direction: row-reverse;
          }
          .amplify-switch__wrapper--top {
            flex-direction: column;
          }
          .amplify-switch__wrapper--bottom {
            flex-direction: column-reverse;
          }

          .amplify-switch__track {
            display: inline-flex;
            justify-content: flex-start;
            box-sizing: content-box;
            border-radius: var(--amplify-components-switchfield-track-border-radius);
            padding: var(--amplify-components-switchfield-track-padding);
            width: var(--amplify-components-switchfield-track-width);
            height: var(--amplify-components-switchfield-track-height);
            transition-duration: var(--amplify-components-switchfield-track-transition-duration);
            background-color: var(--amplify-components-switchfield-track-background-color);
          }
          .amplify-switch__track--checked {
            background-color: var(--amplify-components-switchfield-track-checked-background-color);
          }
          .amplify-switch__track--disabled {
            opacity: var(--amplify-components-switchfield-disabled-opacity);
            cursor: not-allowed;
          }
          .amplify-switch__track--focused {
            box-shadow: var(--amplify-components-switchfield-focused-shadow);
          }
          .amplify-switch__track--error {
            background-color: var(--amplify-components-switchfield-track-error-background-color);
          }

          .amplify-switch__thumb {
            background-color: var(--amplify-components-switchfield-thumb-background-color);
            transition-duration: var(--amplify-components-switchfield-thumb-transition-duration);
            border-radius: var(--amplify-components-switchfield-thumb-border-radius);
            width: var(--amplify-components-switchfield-thumb-width);
            height: var(--amplify-components-switchfield-thumb-width);
            border-width: var(--amplify-components-switchfield-thumb-border-width);
            border-style: var(--amplify-components-switchfield-thumb-border-style);
            border-color: var(--amplify-components-switchfield-thumb-border-color);
            overflow-wrap: break-word;
          }
          .amplify-switch__thumb--checked {
            transform: var(--amplify-components-switchfield-thumb-checked-transform);
          }
          .amplify-switch__thumb--disabled {
            cursor: not-allowed;
          }

          .amplify-switch__label {
            padding: var(--amplify-components-switchfield-label-padding);
            cursor: pointer;
          }

          .amplify-table {
            /**
   * Default Table primitive stylings
   */
            border-collapse: var(--amplify-components-table-border-collapse);
            display: var(--amplify-components-table-display);
            width: var(--amplify-components-table-width);
            --amplify-internal-table-caption-font-size: var(
              --amplify-components-table-caption-font-size
            );
            --amplify-internal-table-th-font-size: var(
              --amplify-components-table-header-font-size
            );
            --amplify-internal-table-th-padding: var(
              --amplify-components-table-header-padding
            );
            --amplify-internal-table-td-font-size: var(
              --amplify-components-table-data-font-size
            );
            --amplify-internal-table-td-padding: var(
              --amplify-components-table-data-padding
            );
            --amplify-internal-table-td-border-width: var(
              --amplify-components-table-data-border-width
            )
            0px var(--amplify-components-table-data-border-width) 0px;
            --amplify-internal-table-th-border-width: var(
              --amplify-components-table-header-border-width
            )
            0px var(--amplify-components-table-header-border-width) 0px;
            /**
   * Data attribute stylings
   */
          }
          .amplify-table--small {
            --amplify-internal-table-caption-font-size: var(
              --amplify-components-table-caption-small-font-size
            );
            --amplify-internal-table-th-font-size: var(
              --amplify-components-table-header-small-font-size
            );
            --amplify-internal-table-th-padding: var(
              --amplify-components-table-header-small-padding
            );
            --amplify-internal-table-td-font-size: var(
              --amplify-components-table-data-small-font-size
            );
            --amplify-internal-table-td-padding: var(
              --amplify-components-table-data-small-padding
            );
          }
          .amplify-table--large {
            --amplify-internal-table-caption-font-size: var(
              --amplify-components-table-caption-large-font-size
            );
            --amplify-internal-table-th-font-size: var(
              --amplify-components-table-header-large-font-size
            );
            --amplify-internal-table-th-padding: var(
              --amplify-components-table-header-large-padding
            );
            --amplify-internal-table-td-font-size: var(
              --amplify-components-table-data-large-font-size
            );
            --amplify-internal-table-td-padding: var(
              --amplify-components-table-data-large-padding
            );
          }
          .amplify-table--bordered {
            --amplify-internal-table-td-border-width: var(
              --amplify-components-table-data-border-width
            )
            var(--amplify-components-table-data-border-width)
            var(--amplify-components-table-data-border-width)
            var(--amplify-components-table-data-border-width);
            --amplify-internal-table-th-border-width: var(
              --amplify-components-table-header-border-width
            )
            var(--amplify-components-table-header-border-width)
            var(--amplify-components-table-header-border-width)
            var(--amplify-components-table-header-border-width);
          }
          .amplify-table--striped .amplify-table__row:not(.amplify-table__head *):nth-child(odd) {
            background-color: var(--amplify-components-table-row-striped-background-color);
          }
          .amplify-table__caption {
            caption-side: var(--amplify-components-table-caption-caption-side);
            color: var(--amplify-components-table-caption-color);
            display: var(--amplify-components-table-caption-display);
            font-size: var(--amplify-internal-table-caption-font-size);
            text-align: var(--amplify-components-table-caption-text-align);
            word-break: var(--amplify-components-table-caption-word-break);
          }
          .amplify-table__head {
            display: var(--amplify-components-table-head-display);
            vertical-align: var(--amplify-components-table-head-vertical-align);
          }
          .amplify-table__body {
            display: var(--amplify-components-table-body-display);
            vertical-align: var(--amplify-components-table-body-vertical-align);
          }
          .amplify-table__foot {
            display: var(--amplify-components-table-foot-display);
            vertical-align: var(--amplify-components-table-foot-vertical-align);
          }
          .amplify-table__row {
            display: var(--amplify-components-table-row-display);
            vertical-align: var(--amplify-components-table-row-vertical-align);
          }
          .amplify-table__th {
            border-color: var(--amplify-components-table-header-border-color);
            border-style: var(--amplify-components-table-header-border-style);
            border-width: var(--amplify-internal-table-th-border-width);
            color: var(--amplify-components-table-header-color);
            display: var(--amplify-components-table-header-display);
            font-size: var(--amplify-internal-table-th-font-size);
            font-weight: var(--amplify-components-table-header-font-weight);
            padding: var(--amplify-internal-table-th-padding);
            vertical-align: var(--amplify-components-table-header-vertical-align);
          }
          .amplify-table__th:first-child {
            border-left-width: var(--amplify-components-table-header-border-width);
          }
          .amplify-table__th:last-child {
            border-right-width: var(--amplify-components-table-header-border-width);
          }
          .amplify-table__td {
            border-color: var(--amplify-components-table-data-border-color);
            border-style: var(--amplify-components-table-data-border-style);
            border-width: var(--amplify-internal-table-td-border-width);
            color: var(--amplify-components-table-data-color);
            display: var(--amplify-components-table-data-display);
            font-size: var(--amplify-internal-table-td-font-size);
            font-weight: var(--amplify-components-table-data-font-weight);
            padding: var(--amplify-internal-table-td-padding);
            vertical-align: var(--amplify-components-table-data-vertical-align);
          }
          .amplify-table__td:first-child {
            border-left-width: var(--amplify-components-table-data-border-width);
          }
          .amplify-table__td:last-child {
            border-right-width: var(--amplify-components-table-data-border-width);
          }
          .amplify-table[data-highlightonhover=true] .amplify-table__row:not(.amplify-table__head *):hover {
            background-color: var(--amplify-components-table-row-hover-background-color);
          }

          .amplify-tabs__list {
            --internal-item-margin-start: 0;
            --internal-item-margin-end: calc(
              -1 * var(--amplify-components-tabs-item-border-width)
            );
            --internal-item-border-width: 0 0
            var(--amplify-components-tabs-border-width) 0;
            --internal-item-flex: initial;
            display: flex;
            flex-direction: row;
            background-color: var(--amplify-components-tabs-background-color);
            box-shadow: var(--amplify-components-tabs-box-shadow);
            border-width: var(--internal-item-border-width);
            border-style: var(--amplify-components-tabs-border-style);
            border-color: var(--amplify-components-tabs-border-color);
            gap: var(--amplify-components-tabs-gap);
          }
          .amplify-tabs__list--top {
            --internal-item-border-width: var(--amplify-components-tabs-border-width)
            0 0 0;
            --internal-item-margin-start: calc(
              -1 * var(--amplify-components-tabs-item-border-width)
            );
            --internal-item-margin-end: 0;
          }
          .amplify-tabs__list--equal {
            --internal-item-flex: 1 1 0;
          }
          .amplify-tabs__list--relative {
            --internal-item-flex: 1 1 auto;
          }
          .amplify-tabs__panel {
            display: none;
            background-color: var(--amplify-components-tabs-panel-background-color);
            padding-inline: var(--amplify-components-tabs-panel-padding-inline);
            padding-block: var(--amplify-components-tabs-panel-padding-block);
          }
          .amplify-tabs__panel--active {
            display: block;
          }
          .amplify-tabs__item {
            position: relative;
            background-color: var(--amplify-components-tabs-item-background-color);
            box-sizing: border-box;
            color: var(--amplify-components-tabs-item-color);
            font-size: var(--amplify-components-tabs-item-font-size);
            font-weight: var(--amplify-components-tabs-item-font-weight);
            padding: var(--amplify-components-tabs-item-padding-vertical) var(--amplify-components-tabs-item-padding-horizontal);
            text-align: var(--amplify-components-tabs-item-text-align);
            transition: all var(--amplify-components-tabs-item-transition-duration);
            border-width: var(--internal-item-border-width);
            border-style: var(--amplify-components-tabs-item-border-style);
            border-color: var(--amplify-components-tabs-item-border-color);
            flex: var(--internal-item-flex);
            margin-block-start: var(--internal-item-margin-start);
            margin-block-end: var(--internal-item-margin-end);
          }
          .amplify-tabs__item--active {
            color: var(--amplify-components-tabs-item-active-color);
            border-color: var(--amplify-components-tabs-item-active-border-color);
            background-color: var(--amplify-components-tabs-item-active-background-color);
            transition-property: none;
          }
          .amplify-tabs__item:hover {
            color: var(--amplify-components-tabs-item-hover-color);
            cursor: pointer;
          }
          .amplify-tabs__item:focus-visible {
            z-index: 2;
            color: var(--amplify-components-tabs-item-focus-color);
            background-color: var(--amplify-components-tabs-item-focus-background-color);
            border-color: var(--amplify-components-tabs-item-focus-border-color);
            box-shadow: var(--amplify-components-tabs-item-focus-box-shadow);
          }
          .amplify-tabs__item:active {
            background-color: var(--amplify-components-tabs-item-active-background-color);
            border-color: var(--amplify-components-tabs-item-active-border-color);
            box-shadow: var(--amplify-components-tabs-item-active-box-shadow);
            color: var(--amplify-components-tabs-item-active-color);
          }
          .amplify-tabs__item[disabled] {
            background-color: var(--amplify-components-tabs-item-disabled-background-color);
            border-color: var(--amplify-components-tabs-item-disabled-border-color);
            box-shadow: var(--amplify-components-tabs-item-disabled-box-shadow);
            color: var(--amplify-components-tabs-item-disabled-color);
            cursor: not-allowed;
          }

          .amplify-textareafield {
            flex-direction: column;
            --amplify-components-fieldcontrol-color: var(
              --amplify-components-textareafield-color
            );
            --amplify-components-fieldcontrol-border-color: var(
              --amplify-components-textareafield-border-color
            );
            --amplify-components-fieldcontrol-focus-border-color: var(
              --amplify-components-textareafield-focus-border-color
            );
          }

          .amplify-textfield {
            --amplify-components-fieldcontrol-color: var(
              --amplify-components-textfield-color
            );
            --amplify-components-fieldcontrol-border-color: var(
              --amplify-components-textfield-border-color
            );
            --amplify-components-fieldcontrol-font-size: var(
              --amplify-components-textfield-font-size
            );
            --amplify-components-fieldcontrol-focus-border-color: var(
              --amplify-components-textfield-focus-border-color
            );
          }

          .amplify-togglebutton {
            --amplify-internal-togglebutton-background-color: initial;
            --amplify-internal-togglebutton-border-color: var(
              --amplify-components-togglebutton-border-color
            );
            --amplify-internal-togglebutton-color: var(
              --amplify-components-togglebutton-color
            );
            background-color: var(--amplify-internal-togglebutton-background-color);
            border-color: var(--amplify-internal-togglebutton-border-color);
            color: var(--amplify-internal-togglebutton-color);
            --amplify-internal-togglebutton-focus-background-color: var(
              --amplify-internal-togglebutton-background-color
            );
            --amplify-internal-togglebutton-focus-border-color: var(
              --amplify-components-togglebutton-focus-border-color
            );
            --amplify-internal-togglebutton-focus-color: var(
              --amplify-components-togglebutton-focus-color
            );
            --amplify-internal-togglebutton-hover-background-color: var(
              --amplify-components-togglebutton-hover-background-color
            );
            --amplify-internal-togglebutton-hover-border-color: var(
              --amplify-internal-togglebutton-border-color
            );
            --amplify-internal-togglebutton-hover-color: var(
              --amplify-internal-togglebutton-color
            );
            --amplify-internal-togglebutton-active-background-color: var(
              --amplify-components-togglebutton-active-background-color
            );
            --amplify-internal-togglebutton-disabled-background-color: var(
              --amplify-components-togglebutton-disabled-background-color
            );
            --amplify-internal-togglebutton-disabled-border-color: var(
              --amplify-components-togglebutton-disabled-border-color
            );
            --amplify-internal-togglebutton-disabled-color: var(
              --amplify-components-togglebutton-disabled-color
            );
          }
          .amplify-togglebutton:focus {
            background-color: var(--amplify-internal-togglebutton-focus-background-color);
            border-color: var(--amplify-internal-togglebutton-focus-border-color);
            color: var(--amplify-internal-togglebutton-focus-color);
          }
          .amplify-togglebutton:hover {
            background-color: var(--amplify-internal-togglebutton-hover-background-color);
            border-color: var(--amplify-internal-togglebutton-hover-border-color);
            color: var(--amplify-internal-togglebutton-hover-color);
          }
          .amplify-togglebutton:active {
            background-color: var(--amplify-internal-togglebutton-active-background-color);
          }
          .amplify-togglebutton:disabled {
            background-color: var(--amplify-internal-togglebutton-disabled-background-color);
            border-color: var(--amplify-internal-togglebutton-disabled-border-color);
            color: var(--amplify-internal-togglebutton-disabled-color);
          }
          .amplify-togglebutton--pressed {
            --amplify-internal-togglebutton-border-color: var(
              --amplify-components-togglebutton-pressed-border-color
            );
            --amplify-internal-togglebutton-background-color: var(
              --amplify-components-togglebutton-pressed-background-color
            );
            --amplify-internal-togglebutton-color: var(
              --amplify-components-togglebutton-pressed-color
            );
            --amplify-internal-togglebutton-hover-background-color: var(
              --amplify-components-togglebutton-pressed-hover-background-color
            );
            --amplify-internal-togglebutton-disabled-background-color: var(
              --amplify-components-togglebutton-pressed-background-color
            );
            --amplify-internal-togglebutton-disabled-border-color: var(
              --amplify-components-togglebutton-pressed-border-color
            );
            --amplify-internal-togglebutton-disabled-color: var(
              --amplify-components-togglebutton-pressed-color
            );
          }
          .amplify-togglebutton--primary {
            --amplify-internal-togglebutton-primary-background-color: var(
              --amplify-components-togglebutton-primary-background-color
            );
            --amplify-internal-togglebutton-background-color: var(
              --amplify-internal-togglebutton-primary-background-color
            );
            --amplify-internal-togglebutton-primary-border-color: var(
              --amplify-components-togglebutton-border-color
            );
            --amplify-internal-togglebutton-border-color: var(
              --amplify-internal-togglebutton-primary-border-color
            );
            --amplify-internal-togglebutton-primary-color: var(
              --amplify-components-togglebutton-color
            );
            --amplify-internal-togglebutton-color: var(
              --amplify-internal-togglebutton-primary-color
            );
            border-width: var(--amplify-components-togglebutton-primary-border-width);
            --amplify-internal-togglebutton-primary-focus-background-color: var(
              --amplify-components-togglebutton-primary-focus-background-color
            );
            --amplify-internal-togglebutton-primary-focus-border-color: var(
              --amplify-components-togglebutton-primary-focus-border-color
            );
            --amplify-internal-togglebutton-primary-focus-color: var(
              --amplify-components-togglebutton-primary-focus-color
            );
            --amplify-internal-togglebutton-primary-focus-box-shadow: var(
              --amplify-components-togglebutton-primary-focus-box-shadow
            );
            --amplify-internal-togglebutton-focus-background-color: var(
              --amplify-internal-togglebutton-primary-focus-background-color
            );
            --amplify-internal-togglebutton-focus-border-color: var(
              --amplify-internal-togglebutton-primary-focus-border-color
            );
            --amplify-internal-togglebutton-focus-color: var(
              --amplify-internal-togglebutton-primary-focus-color
            );
            --amplify-internal-togglebutton-primary-hover-background-color: var(
              --amplify-components-togglebutton-primary-hover-background-color
            );
            --amplify-internal-togglebutton-primary-hover-border-color: var(
              --amplify-internal-togglebutton-primary-border-color
            );
            --amplify-internal-togglebutton-primary-hover-color: var(
              --amplify-components-togglebutton-primary-hover-color
            );
            --amplify-internal-togglebutton-hover-background-color: var(
              --amplify-internal-togglebutton-primary-hover-background-color
            );
            --amplify-internal-togglebutton-hover-border-color: var(
              --amplify-internal-togglebutton-primary-hover-border-color
            );
            --amplify-internal-togglebutton-hover-color: var(
              --amplify-internal-togglebutton-primary-hover-color
            );
            --amplify-internal-togglebutton-primary-disabled-background-color: var(
              --amplify-components-togglebutton-primary-disabled-background-color
            );
            --amplify-internal-togglebutton-primary-disabled-border-color: var(
              --amplify-components-togglebutton-primary-disabled-border-color
            );
            --amplify-internal-togglebutton-primary-disabled-color: var(
              --amplify-components-togglebutton-primary-disabled-color
            );
            --amplify-internal-togglebutton-disabled-background-color: var(
              --amplify-internal-togglebutton-primary-disabled-background-color
            );
            --amplify-internal-togglebutton-disabled-border-color: var(
              --amplify-internal-togglebutton-primary-disabled-border-color
            );
            --amplify-internal-togglebutton-disabled-color: var(
              --amplify-internal-togglebutton-primary-disabled-color
            );
          }
          .amplify-togglebutton--primary:focus {
            box-shadow: var(--amplify-internal-togglebutton-primary-focus-box-shadow);
          }
          .amplify-togglebutton--pressed {
            --amplify-internal-togglebutton-primary-background-color: var(
              --amplify-components-togglebutton-primary-pressed-background-color
            );
            --amplify-internal-togglebutton-primary-border-color: var(
              --amplify-components-togglebutton-primary-pressed-border-color
            );
            --amplify-internal-togglebutton-primary-color: var(
              --amplify-components-togglebutton-primary-pressed-color
            );
            --amplify-internal-togglebutton-primary-focus-background-color: var(
              --amplify-components-togglebutton-primary-pressed-focus-background-color
            );
            --amplify-internal-togglebutton-primary-focus-border-color: var(
              --amplify-components-togglebutton-primary-pressed-focus-border-color
            );
            --amplify-internal-togglebutton-primary-focus-color: var(
              --amplify-components-togglebutton-primary-pressed-focus-color
            );
            --amplify-internal-togglebutton-primary-hover-background-color: var(
              --amplify-components-togglebutton-primary-pressed-hover-background-color
            );
            --amplify-internal-togglebutton-primary-hover-border-color: var(
              --amplify-components-togglebutton-primary-pressed-hover-border-color
            );
            --amplify-internal-togglebutton-primary-hover-color: var(
              --amplify-components-togglebutton-primary-pressed-hover-color
            );
            --amplify-internal-togglebutton-primary-disabled-background-color: var(
              --amplify-components-togglebutton-primary-pressed-background-color
            );
            --amplify-internal-togglebutton-primary-disabled-border-color: var(
              --amplify-components-togglebutton-primary-pressed-border-color
            );
            --amplify-internal-togglebutton-primary-disabled-color: var(
              --amplify-components-togglebutton-primary-pressed-color
            );
          }
          .amplify-togglebutton--pressed:hover {
            --amplify-internal-togglebutton-primary-focus-box-shadow: var(
              --amplify-components-togglebutton-primary-pressed-hover-box-shadow
            );
          }
          .amplify-togglebutton--link {
            --amplify-internal-togglebutton-link-background-color: var(
              --amplify-components-togglebutton-link-background-color
            );
            --amplify-internal-togglebutton-link-color: var(
              --amplify-components-togglebutton-link-color
            );
            --amplify-internal-togglebutton-background-color: var(
              --amplify-internal-togglebutton-link-background-color
            );
            --amplify-internal-togglebutton-color: var(
              --amplify-internal-togglebutton-link-color
            );
            --amplify-internal-togglebutton-link-focus-background-color: var(
              --amplify-components-togglebutton-link-focus-background-color
            );
            --amplify-internal-togglebutton-link-focus-color: var(
              --amplify-components-togglebutton-link-focus-color
            );
            --amplify-internal-togglebutton-focus-background-color: var(
              --amplify-internal-togglebutton-link-focus-background-color
            );
            --amplify-internal-togglebutton-focus-color: var(
              --amplify-internal-togglebutton-link-focus-color
            );
            --amplify-internal-togglebutton-link-hover-background-color: var(
              --amplify-components-togglebutton-link-hover-background-color
            );
            --amplify-internal-togglebutton-link-hover-color: var(
              --amplify-components-togglebutton-link-hover-color
            );
            --amplify-internal-togglebutton-hover-background-color: var(
              --amplify-internal-togglebutton-link-hover-background-color
            );
            --amplify-internal-togglebutton-hover-color: var(
              --amplify-internal-togglebutton-link-hover-color
            );
            --amplify-internal-togglebutton-link-disabled-color: var(
              --amplify-components-togglebutton-link-disabled-color
            );
            --amplify-internal-togglebutton-link-disabled-background-color: var(
              --amplify-components-togglebutton-link-disabled-background-color
            );
            --amplify-internal-togglebutton-disabled-color: var(
              --amplify-internal-togglebutton-link-disabled-color
            );
            --amplify-internal-togglebutton-disabled-background-color: var(
              --amplify-internal-togglebutton-link-disabled-background-color
            );
          }
          .amplify-togglebutton--pressed {
            --amplify-internal-togglebutton-link-color: var(
              --amplify-components-togglebutton-link-pressed-color
            );
            --amplify-internal-togglebutton-link-background-color: var(
              --amplify-components-togglebutton-link-pressed-background-color
            );
            --amplify-internal-togglebutton-link-focus-background-color: var(
              --amplify-components-togglebutton-link-pressed-focus-background-color
            );
            --amplify-internal-togglebutton-link-focus-color: var(
              --amplify-components-togglebutton-link-pressed-focus-color
            );
            --amplify-internal-togglebutton-link-hover-background-color: var(
              --amplify-components-togglebutton-link-pressed-hover-background-color
            );
            --amplify-internal-togglebutton-link-hover-color: var(
              --amplify-components-togglebutton-link-pressed-hover-color
            );
            --amplify-internal-togglebutton-link-disabled-color: var(
              --amplify-components-togglebutton-link-pressed-color
            );
          }

          .amplify-togglebuttongroup {
            align-items: var(--amplify-components-togglebuttongroup-align-items);
            align-content: var(--amplify-components-togglebuttongroup-align-content);
            justify-content: var(--amplify-components-togglebuttongroup-justify-content);
            gap: 0;
          }

          .amplify-togglebuttongroup .amplify-togglebutton:focus, .amplify-togglebuttongroup .amplify-togglebutton.amplify-togglebutton--pressed {
            z-index: 2;
          }
          .amplify-togglebuttongroup .amplify-togglebutton:not(:first-of-type) {
            margin-inline-start: calc(-1 * var(--amplify-components-button-border-width));
            border-start-start-radius: 0;
            border-end-start-radius: 0;
          }
          @supports not (border-start-start-radius: 0) {
            .amplify-togglebuttongroup .amplify-togglebutton:not(:first-of-type) {
              border-top-left-radius: 0;
              border-bottom-left-radius: 0;
            }
          }
          .amplify-togglebuttongroup .amplify-togglebutton:not(:last-of-type) {
            border-start-end-radius: 0;
            border-end-end-radius: 0;
          }
          @supports not (border-end-end-radius: 0) {
            .amplify-togglebuttongroup .amplify-togglebutton:not(:last-of-type) {
              border-bottom-right-radius: 0;
              border-top-right-radius: 0;
            }
          }

          .amplify-fileuploader__dropzone {
            background-color: var(--amplify-components-fileuploader-dropzone-background-color);
            border-color: var(--amplify-components-fileuploader-dropzone-border-color);
            border-radius: var(--amplify-components-fileuploader-dropzone-border-radius);
            border-style: var(--amplify-components-fileuploader-dropzone-border-style);
            border-width: var(--amplify-components-fileuploader-dropzone-border-width);
            text-align: var(--amplify-components-fileuploader-dropzone-text-align);
            padding-block: var(--amplify-components-fileuploader-dropzone-padding-block);
            padding-inline: var(--amplify-components-fileuploader-dropzone-padding-inline);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: var(--amplify-components-fileuploader-dropzone-gap);
          }
          .amplify-fileuploader__dropzone--small {
            flex-direction: row;
            justify-content: center;
          }
          .amplify-fileuploader__dropzone--active {
            border-color: var(--amplify-components-fileuploader-dropzone-active-border-color);
            border-width: var(--amplify-components-fileuploader-dropzone-active-border-width);
            background-color: var(--amplify-components-fileuploader-dropzone-active-background-color);
          }
          .amplify-fileuploader__dropzone__icon {
            font-size: var(--amplify-components-fileuploader-dropzone-icon-font-size);
            color: var(--amplify-components-fileuploader-dropzone-icon-color);
          }
          .amplify-fileuploader__dropzone__text {
            color: var(--amplify-components-fileuploader-dropzone-text-color);
            font-size: var(--amplify-components-fileuploader-dropzone-text-font-size);
            font-weight: var(--amplify-components-fileuploader-dropzone-text-font-weight);
          }
          .amplify-fileuploader__file__list {
            display: flex;
            flex-direction: var(--amplify-components-fileuploader-filelist-flex-direction);
            gap: var(--amplify-components-fileuploader-filelist-gap);
          }
          .amplify-fileuploader__file {
            position: relative;
            border-width: var(--amplify-components-fileuploader-file-border-width);
            border-style: var(--amplify-components-fileuploader-file-border-style);
            border-color: var(--amplify-components-fileuploader-file-border-color);
            border-radius: var(--amplify-components-fileuploader-file-border-radius);
            display: flex;
            flex-direction: column;
            padding-inline: var(--amplify-components-fileuploader-file-padding-inline);
            padding-block: var(--amplify-components-fileuploader-file-padding-block);
            align-items: var(--amplify-components-fileuploader-file-align-items);
          }
          .amplify-fileuploader__file__wrapper {
            width: 100%;
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: var(--amplify-components-fileuploader-file-gap);
          }
          .amplify-fileuploader__file__name {
            text-overflow: ellipsis;
            overflow: hidden;
            font-weight: var(--amplify-components-fileuploader-file-name-font-weight);
            font-size: var(--amplify-components-fileuploader-file-name-font-size);
            color: var(--amplify-components-fileuploader-file-name-color);
          }
          .amplify-fileuploader__file__size {
            font-weight: var(--amplify-components-fileuploader-file-size-font-weight);
            font-size: var(--amplify-components-fileuploader-file-size-font-size);
            color: var(--amplify-components-fileuploader-file-size-color);
          }
          .amplify-fileuploader__file__main {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
          }
          .amplify-fileuploader__file__image {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: var(--amplify-components-fileuploader-file-image-width);
            height: var(--amplify-components-fileuploader-file-image-height);
            background-color: var(--amplify-components-fileuploader-file-image-background-color);
            border-radius: var(--amplify-components-fileuploader-file-image-border-radius);
            color: var(--amplify-components-fileuploader-file-image-color);
          }
          .amplify-fileuploader__file__image img {
            max-height: 100%;
          }
          .amplify-fileuploader__file__status--error {
            color: var(--amplify-colors-font-error);
            font-size: var(--amplify-components-fileuploader-file-size-font-size);
          }
          .amplify-fileuploader__file__status--success {
            color: var(--amplify-colors-font-success);
          }
          .amplify-fileuploader__loader {
            stroke-linecap: var(--amplify-components-fileuploader-loader-stroke-linecap);
            stroke: var(--amplify-components-fileuploader-loader-stroke-empty);
            stroke-width: var(--amplify-components-fileuploader-loader-stroke-width);
            height: var(--amplify-components-fileuploader-loader-stroke-width);
            --amplify-components-loader-linear-stroke-filled: var(
              --amplify-components-fileuploader-loader-stroke-filled
            );
            overflow: hidden;
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
          }
          .amplify-fileuploader__previewer {
            display: flex;
            flex-direction: column;
            max-width: var(--amplify-components-fileuploader-previewer-max-width);
            max-height: var(--amplify-components-fileuploader-previewer-max-height);
            overflow: auto;
            gap: var(--amplify-components-fileuploader-previewer-body-gap);
            padding-inline: var(--amplify-components-fileuploader-previewer-body-padding-inline);
            padding-block: var(--amplify-components-fileuploader-previewer-body-padding-block);
            background-color: var(--amplify-components-fileuploader-previewer-background-color);
            border-width: var(--amplify-components-fileuploader-previewer-border-width);
            border-style: var(--amplify-components-fileuploader-previewer-border-style);
            border-color: var(--amplify-components-fileuploader-previewer-border-color);
            border-radius: var(--amplify-components-fileuploader-previewer-border-radius);
          }
          .amplify-fileuploader__previewer__text {
            font-weight: var(--amplify-components-fileuploader-previewer-text-font-weight);
            font-size: var(--amplify-components-fileuploader-previewer-text-font-size);
            color: var(--amplify-components-fileuploader-previewer-text-color);
          }
          .amplify-fileuploader__previewer__footer {
            display: flex;
            flex-direction: row;
            justify-content: var(--amplify-components-fileuploader-previewer-footer-justify-content);
          }
          .amplify-fileuploader__previewer__actions {
            display: flex;
            flex-direction: row;
            gap: var(--amplify-space-small);
          }

          .amplify-inappmessaging-backdrop {
            background-color: var(--amplify-colors-overlay-50);
            inset: 0;
            position: fixed;
            z-index: 1000;
          }

          .amplify-inappmessaging-backdrop-content-container {
            align-items: center;
            inset: 0;
            justify-content: center;
            pointer-events: none;
            position: fixed;
            z-index: 1001;
          }

          .amplify-inappmessaging-backdrop-content {
            pointer-events: auto;
          }

          .amplify-inappmessaging-bannermessage {
            box-shadow: var(--amplify-shadows-medium);
            height: var(--amplify-components-inappmessaging-banner-height);
            margin: var(--amplify-space-small);
            max-width: 50%;
            position: fixed;
            width: var(--amplify-components-inappmessaging-banner-width);
          }
          .amplify-inappmessaging-bannermessage--top {
            top: 0;
          }
          .amplify-inappmessaging-bannermessage--middle {
            bottom: 0;
            margin: auto var(--amplify-space-small);
            top: 0;
          }
          .amplify-inappmessaging-bannermessage--bottom {
            bottom: 0;
          }
          .amplify-inappmessaging-bannermessage--left {
            left: 0;
          }
          .amplify-inappmessaging-bannermessage--center {
            left: 0;
            margin: var(--amplify-space-small) auto;
            right: 0;
          }
          .amplify-inappmessaging-bannermessage--right {
            right: 0;
          }
          .amplify-inappmessaging-bannermessage--center-middle {
            inset: 0;
            margin: auto;
          }
          .amplify-inappmessaging-bannermessage--full-width {
            max-width: initial;
            width: calc(100% - 2 * var(--amplify-space-small));
          }

          .amplify-inappmessaging-fullscreenmessage {
            height: var(--amplify-components-inappmessaging-dialog-height);
            min-height: var(--amplify-components-inappmessaging-dialog-min-height);
            min-width: var(--amplify-components-inappmessaging-dialog-min-width);
            width: var(--amplify-components-inappmessaging-dialog-width);
          }
          .amplify-inappmessaging-fullscreenmessage--fullscreen {
            height: auto;
            inset: 0;
            position: fixed;
            width: auto;
            z-index: 1000;
          }

          .amplify-inappmessaging-messagelayout {
            background-color: var(--amplify-colors-background-primary);
            flex-direction: column;
            flex-grow: 1;
            gap: var(--amplify-space-xxxs);
            max-width: 100%;
            padding: var(--amplify-space-medium);
          }
          .amplify-inappmessaging-messagelayout__button {
            border-width: 0;
            width: 100%;
          }
          .amplify-inappmessaging-messagelayout__button, .amplify-inappmessaging-messagelayout__button:active, .amplify-inappmessaging-messagelayout__button:visited, .amplify-inappmessaging-messagelayout__button:hover, .amplify-inappmessaging-messagelayout__button:focus {
            background-color: var(--amplify-components-inappmessaging-button-background-color);
            border-radius: var(--amplify-components-inappmessaging-button-border-radius);
            color: var(--amplify-components-inappmessaging-button-color);
          }
          .amplify-inappmessaging-messagelayout__button--dark:active, .amplify-inappmessaging-messagelayout__button--dark:visited, .amplify-inappmessaging-messagelayout__button--light:active, .amplify-inappmessaging-messagelayout__button--light:visited {
            filter: brightness(100%);
          }
          .amplify-inappmessaging-messagelayout__button--dark:hover, .amplify-inappmessaging-messagelayout__button--dark:focus {
            filter: brightness(120%);
          }
          .amplify-inappmessaging-messagelayout__button--light:hover, .amplify-inappmessaging-messagelayout__button--light:focus {
            filter: brightness(80%);
          }
          .amplify-inappmessaging-messagelayout__close-button {
            color: var(--amplify-colors-neutral-80);
          }
          .amplify-inappmessaging-messagelayout__close-button:active, .amplify-inappmessaging-messagelayout__close-button:visited {
            color: var(--amplify-colors-neutral-80);
          }
          .amplify-inappmessaging-messagelayout__close-button:hover, .amplify-inappmessaging-messagelayout__close-button:focus {
            color: var(--amplify-colors-neutral-100);
          }
          .amplify-inappmessaging-messagelayout__content {
            flex-grow: 1;
            overflow: hidden;
          }
          .amplify-inappmessaging-messagelayout__content--horizontal {
            flex-direction: row;
          }
          .amplify-inappmessaging-messagelayout__content--vertical {
            flex-direction: column;
            justify-content: center;
          }
          .amplify-inappmessaging-messagelayout__header {
            flex-shrink: 0;
            font-size: var(--amplify-components-inappmessaging-header-font-size);
            font-weight: var(--amplify-components-inappmessaging-header-font-weight);
          }
          .amplify-inappmessaging-messagelayout__image-container {
            align-items: center;
            display: flex;
            justify-content: center;
            position: relative;
          }
          .amplify-inappmessaging-messagelayout__image-container img {
            max-height: 100%;
            max-width: 100%;
            -o-object-fit: contain;
            object-fit: contain;
            position: absolute;
          }
          .amplify-inappmessaging-messagelayout__image-container--horizontal {
            max-width: 15%;
            min-width: 15%;
          }
          .amplify-inappmessaging-messagelayout__image-container--vertical {
            max-height: 40%;
            min-height: 40%;
          }
          .amplify-inappmessaging-messagelayout__text-container {
            flex-direction: column;
            overflow-y: auto;
            gap: var(--amplify-space-xxxs);
          }
          .amplify-inappmessaging-messagelayout__text-container--horizontal {
            flex-grow: 1;
          }
          .amplify-inappmessaging-messagelayout__text-container--vertical {
            flex-grow: 0;
          }

          .amplify-inappmessaging-modalmessage {
            align-items: center;
            height: initial;
            inset: 0;
            justify-content: center;
            pointer-events: none;
            position: fixed;
            width: initial;
            z-index: 1000;
          }
          .amplify-inappmessaging-modalmessage__dialog {
            box-shadow: var(--amplify-shadows-medium);
            height: var(--amplify-components-inappmessaging-dialog-height);
            min-height: var(--amplify-components-inappmessaging-dialog-min-height);
            min-width: var(--amplify-components-inappmessaging-dialog-min-width);
            pointer-events: auto;
            width: var(--amplify-components-inappmessaging-dialog-width);
          }
          .amplify-inappmessaging-modalmessage__dialog--full-width {
            width: 100%;
            margin: var(--amplify-space-small);
          }

          .amplify-storagemanager__dropzone {
            background-color: var(--amplify-components-storagemanager-dropzone-background-color);
            border-color: var(--amplify-components-storagemanager-dropzone-border-color);
            border-radius: var(--amplify-components-storagemanager-dropzone-border-radius);
            border-style: var(--amplify-components-storagemanager-dropzone-border-style);
            border-width: var(--amplify-components-storagemanager-dropzone-border-width);
            text-align: var(--amplify-components-storagemanager-dropzone-text-align);
            padding-block: var(--amplify-components-storagemanager-dropzone-padding-block);
            padding-inline: var(--amplify-components-storagemanager-dropzone-padding-inline);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: var(--amplify-components-storagemanager-dropzone-gap);
          }
          .amplify-storagemanager__dropzone--small {
            flex-direction: row;
            justify-content: center;
          }
          .amplify-storagemanager__dropzone--active {
            border-color: var(--amplify-components-storagemanager-dropzone-active-border-color);
            border-width: var(--amplify-components-storagemanager-dropzone-active-border-width);
            background-color: var(--amplify-components-storagemanager-dropzone-active-background-color);
          }
          .amplify-storagemanager__dropzone__icon {
            font-size: var(--amplify-components-storagemanager-dropzone-icon-font-size);
            color: var(--amplify-components-storagemanager-dropzone-icon-color);
          }
          .amplify-storagemanager__dropzone__text {
            color: var(--amplify-components-storagemanager-dropzone-text-color);
            font-size: var(--amplify-components-storagemanager-dropzone-text-font-size);
            font-weight: var(--amplify-components-storagemanager-dropzone-text-font-weight);
          }
          .amplify-storagemanager__file__list {
            display: flex;
            flex-direction: var(--amplify-components-storagemanager-filelist-flex-direction);
            gap: var(--amplify-components-storagemanager-filelist-gap);
          }
          .amplify-storagemanager__file {
            position: relative;
            border-width: var(--amplify-components-storagemanager-file-border-width);
            border-style: var(--amplify-components-storagemanager-file-border-style);
            border-color: var(--amplify-components-storagemanager-file-border-color);
            border-radius: var(--amplify-components-storagemanager-file-border-radius);
            display: flex;
            flex-direction: column;
            padding-inline: var(--amplify-components-storagemanager-file-padding-inline);
            padding-block: var(--amplify-components-storagemanager-file-padding-block);
            align-items: var(--amplify-components-storagemanager-file-align-items);
          }
          .amplify-storagemanager__file__wrapper {
            width: 100%;
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: var(--amplify-components-storagemanager-file-gap);
          }
          .amplify-storagemanager__file__name {
            text-overflow: ellipsis;
            overflow: hidden;
            font-weight: var(--amplify-components-storagemanager-file-name-font-weight);
            font-size: var(--amplify-components-storagemanager-file-name-font-size);
            color: var(--amplify-components-storagemanager-file-name-color);
          }
          .amplify-storagemanager__file__size {
            font-weight: var(--amplify-components-storagemanager-file-size-font-weight);
            font-size: var(--amplify-components-storagemanager-file-size-font-size);
            color: var(--amplify-components-storagemanager-file-size-color);
          }
          .amplify-storagemanager__file__main {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
          }
          .amplify-storagemanager__file__image {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: var(--amplify-components-storagemanager-file-image-width);
            height: var(--amplify-components-storagemanager-file-image-height);
            background-color: var(--amplify-components-storagemanager-file-image-background-color);
            border-radius: var(--amplify-components-storagemanager-file-image-border-radius);
            color: var(--amplify-components-storagemanager-file-image-color);
          }
          .amplify-storagemanager__file__image img {
            max-height: 100%;
          }
          .amplify-storagemanager__file__status--error {
            color: var(--amplify-colors-font-error);
            font-size: var(--amplify-components-storagemanager-file-size-font-size);
          }
          .amplify-storagemanager__file__status--success {
            color: var(--amplify-colors-font-success);
          }
          .amplify-storagemanager__loader {
            stroke-linecap: var(--amplify-components-storagemanager-loader-stroke-linecap);
            stroke: var(--amplify-components-storagemanager-loader-stroke-empty);
            stroke-width: var(--amplify-components-storagemanager-loader-stroke-width);
            height: var(--amplify-components-storagemanager-loader-stroke-width);
            --amplify-components-loader-linear-stroke-filled: var(
              --amplify-components-storagemanager-loader-stroke-filled
            );
            overflow: hidden;
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
          }
          .amplify-storagemanager__previewer {
            display: flex;
            flex-direction: column;
            max-width: var(--amplify-components-storagemanager-previewer-max-width);
            max-height: var(--amplify-components-storagemanager-previewer-max-height);
            overflow: auto;
            gap: var(--amplify-components-storagemanager-previewer-body-gap);
            padding-inline: var(--amplify-components-storagemanager-previewer-body-padding-inline);
            padding-block: var(--amplify-components-storagemanager-previewer-body-padding-block);
            background-color: var(--amplify-components-storagemanager-previewer-background-color);
            border-width: var(--amplify-components-storagemanager-previewer-border-width);
            border-style: var(--amplify-components-storagemanager-previewer-border-style);
            border-color: var(--amplify-components-storagemanager-previewer-border-color);
            border-radius: var(--amplify-components-storagemanager-previewer-border-radius);
          }
          .amplify-storagemanager__previewer__text {
            font-weight: var(--amplify-components-storagemanager-previewer-text-font-weight);
            font-size: var(--amplify-components-storagemanager-previewer-text-font-size);
            color: var(--amplify-components-storagemanager-previewer-text-color);
          }
          .amplify-storagemanager__previewer__footer {
            display: flex;
            flex-direction: row;
            justify-content: var(--amplify-components-storagemanager-previewer-footer-justify-content);
          }
          .amplify-storagemanager__previewer__actions {
            display: flex;
            flex-direction: row;
            gap: var(--amplify-space-small);
          }

          .amplify-ai-conversation {
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          .amplify-ai-conversation__message {
            --content-bg: transparent;
            display: flex;
            flex-direction: var(--flex-direction);
            gap: var(--amplify-space-small);
            padding: var(--amplify-space-small);
          }
          .amplify-ai-conversation__message__list {
            display: flex;
            flex-direction: column;
          }
          .amplify-ai-conversation__message__avatar {
            flex-shrink: 0;
          }
          .amplify-ai-conversation__message__sender {
            display: flex;
            flex-direction: var(--flex-direction);
            align-items: center;
            height: var(--amplify-components-avatar-height);
            gap: var(--amplify-space-small);
          }
          .amplify-ai-conversation__message__sender__username {
            font-weight: bold;
          }
          .amplify-ai-conversation__message__sender__timestamp {
            color: var(--amplify-colors-font-tertiary);
            font-size: var(--amplify-font-sizes-small);
          }
          .amplify-ai-conversation__message__body {
            display: flex;
            flex-direction: column;
            align-items: var(--body-align-items);
            gap: var(--amplify-space-xs);
          }
          .amplify-ai-conversation__message__content {
            background-color: var(--content-bg);
            border-radius: var(--amplify-radii-medium);
            padding: var(--content-padding);
          }
          .amplify-ai-conversation__message__actions {
            display: flex;
            flex-direction: row;
          }
          .amplify-ai-conversation__message--bubble {
            --content-bg: var(--bg-color);
            --content-padding: var(--amplify-space-xxs) var(--amplify-space-xs);
            --flex-direction: row-reverse;
            --body-align-items: flex-end;
          }
          .amplify-ai-conversation__message--user {
            --bg-color: var(--amplify-colors-background-secondary);
          }
          .amplify-ai-conversation__message--assistant {
            --bg-color: var(--amplify-colors-primary-10);
            --flex-direction: row;
            --body-align-items: flex-start;
          }
          .amplify-ai-conversation__form {
            display: flex;
            flex-direction: row;
            align-items: flex-start;
            gap: var(--amplify-space-small);
          }
          .amplify-ai-conversation__form__dropzone {
            text-align: initial;
            border: none;
            padding: var(--amplify-space-xs);
          }
          .amplify-ai-conversation__attachment {
            display: flex;
            flex-direction: row;
            padding-block: var(--amplify-space-xxxs);
            padding-inline: var(--amplify-space-xs);
            border-width: var(--amplify-border-widths-small);
            border-style: solid;
            border-color: var(--amplify-colors-border-secondary);
            border-radius: var(--amplify-radii-small);
            align-items: center;
            gap: var(--amplify-space-xs);
            font-size: var(--amplify-font-sizes-small);
          }
          .amplify-ai-conversation__attachment__list {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            gap: var(--amplify-space-small);
            padding-block-start: var(--amplify-space-small);
          }
          .amplify-ai-conversation__attachment__image {
            width: 1rem;
            height: 1rem;
            -o-object-fit: cover;
            object-fit: cover;
          }
          .amplify-ai-conversation__attachment__size {
            color: var(--amplify-colors-font-tertiary);
          }
          .amplify-ai-conversation__attachment__remove {
            padding: var(--amplify-space-xxs);
          }
          .amplify-ai-conversation__prompt {
            font-weight: normal;
          }

          .amplify-label-start {
            flex-direction: row;
          }

          .amplify-label-end {
            flex-direction: row-reverse;
          }

          .amplify-label-top {
            flex-direction: column;
          }

          .amplify-label-bottom {
            flex-direction: column-reverse;
          }

          .amplify-visually-hidden {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            fill: transparent;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border-width: 0;
          }
        `}
      />
    </>
  );
}
