import { adjustColor, alignmentMap } from './formHelperFunctions';
import Delta from 'quill-delta';

const bootstrapStyles = {
    padding: '0.375rem 0.75rem',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out',
    outline: 'none'
};

const mobileIndices = {
    gridColumnStart: 'mobile_column_index',
    gridColumnEnd: 'mobile_column_index_end',
    gridRowStart: 'mobile_row_index',
    gridRowEnd: 'mobile_row_index_end'
};

/**
 * Handles the translation of server-side properties into responsive CSS
 * attributes
 */
class ApplyStyles {
    constructor(element, targets) {
        this.element = element;
        this.styles = element.styles;
        this.mobileStyles = element.mobile_styles;
        this.targets = Object.fromEntries(targets.map((t) => [t, {}]));
        this.mobileTargets = Object.fromEntries(targets.map((t) => [t, {}]));
    }

    // Return CSS for the step dimensions / layout
    getLayout() {
        const layout = {
            gridColumnStart: this.element.column_index + 1,
            gridRowStart: this.element.row_index + 1,
            gridColumnEnd: this.element.column_index_end + 2,
            gridRowEnd: this.element.row_index_end + 2
        };

        if (
            Object.values(mobileIndices).some(
                (index) => !isNaN(parseInt(this.element[index]))
            )
        ) {
            const mobileLayout = {};
            Object.entries(mobileIndices).forEach(([key, i]) => {
                let mVal = parseInt(this.element[i]);
                if (isNaN(mVal)) mobileLayout[key] = layout[key];
                else {
                    if (['gridColumnEnd', 'gridRowEnd'].includes(key)) {
                        mVal += 2;
                    } else mVal++;
                    mobileLayout[key] = mVal;
                }
            });
            layout['@media (max-width: 478px)'] = mobileLayout;
        }

        return layout;
    }

    addTargets(...targets) {
        targets.forEach((target) => {
            this.targets[target] = {};
            this.mobileTargets[target] = {};
        });
    }

    // Return CSS for a particular target HTML element
    getTarget(target) {
        return {
            ...this.targets[target],
            '@media (max-width: 478px)': this.mobileTargets[target]
        };
    }

    setStyle(target, key, val) {
        this.targets[target][key] = val;
    }

    // Translate a set of server-side properties into CSS for a particular
    // target
    apply(target, properties, get) {
        // if not array, assume user passed in 1 element
        if (!Array.isArray(properties)) properties = [properties];

        const styles = properties.map((p) => this.styles[p]);
        this.targets[target] = { ...this.targets[target], ...get(...styles) };

        let mobileStyles = properties.map((p) => this.mobileStyles[p]);
        // If no mobile overrides, don't set breakpoint style
        if (mobileStyles.every((s) => s === undefined)) return;
        // Fall back to default style if a mobile style doesn't exist
        mobileStyles = properties.map((p) => {
            const ms = this.mobileStyles[p];
            return ms !== undefined ? ms : this.styles[p];
        });
        this.mobileTargets[target] = {
            ...this.mobileTargets[target],
            ...get(...mobileStyles)
        };
    }

    applyBorders(target, prefix = '', important = true) {
        // If color isn't defined on one of the sides, that means there's no border
        if (!this.styles[`${prefix}border_top_color`]) return;
        const i = prefix && important ? '!important' : '';
        this.apply(
            target,
            [
                `${prefix}border_top_color`,
                `${prefix}border_right_color`,
                `${prefix}border_bottom_color`,
                `${prefix}border_left_color`
            ],
            (a, b, c, d) => ({ borderColor: `#${a} #${b} #${c} #${d} ${i}` })
        );
        this.apply(
            target,
            [
                `${prefix}border_top_width`,
                `${prefix}border_right_width`,
                `${prefix}border_bottom_width`,
                `${prefix}border_left_width`
            ],
            (a, b, c, d) => ({
                borderWidth: `${a}px ${b}px ${c}px ${d}px ${i}`
            })
        );
        this.apply(
            target,
            [
                `${prefix}border_top_pattern`,
                `${prefix}border_right_pattern`,
                `${prefix}border_bottom_pattern`,
                `${prefix}border_left_pattern`
            ],
            (a, b, c, d) => ({ borderStyle: `${a} ${b} ${c} ${d} ${i}` })
        );
    }

    applySelectorStyles(target, prefix) {
        this.applyBorders(target, prefix);
        if (this.styles[`${prefix}background_color`]) {
            this.apply(target, `${prefix}background_color`, (a) => ({
                backgroundColor: `#${a} !important`
            }));
        }
        if (this.styles[`${prefix}font_color`]) {
            this.apply(target, `${prefix}font_color`, (a) => ({
                color: `#${a} !important`
            }));
        }
    }

    applyMargin(target) {
        this.apply(
            target,
            ['padding_top', 'padding_right', 'padding_bottom', 'padding_left'],
            (a, b, c, d) => ({
                margin: `${a}px ${b}px ${c}px ${d}px`
            })
        );
    }

    applyCorners(target) {
        this.apply(
            target,
            [
                'corner_top_left_radius',
                'corner_top_right_radius',
                'corner_bottom_right_radius',
                'corner_bottom_left_radius'
            ],
            (a, b, c, d) => ({
                borderRadius: `${a}px ${b}px ${c}px ${d}px`
            })
        );
    }

    applyBoxShadow(target) {
        this.apply(
            target,
            [
                'shadow_x_offset',
                'shadow_y_offset',
                'shadow_blur_radius',
                'shadow_color'
            ],
            (a, b, c, d) => ({
                boxShadow: `${a}px ${b}px ${c}px #${d}`
            })
        );
    }

    applyHeight(target) {
        this.apply(target, ['height', 'height_unit'], (a, b) => ({
            height: `${a}${b}`
        }));
    }

    applyWidth(target) {
        this.apply(target, ['width', 'width_unit'], (a, b) => ({
            width: `${a}${b}`
        }));
    }

    applyFontStyles(target, placeholder = false) {
        this.apply(target, 'font_weight', (a) => ({ fontWeight: a }));
        this.apply(target, 'font_family', (a) => ({ fontFamily: a }));
        this.apply(target, 'font_size', (a) => ({ fontSize: `${a}px` }));
        this.apply(
            target,
            placeholder ? 'placeholder_italic' : 'font_italic',
            (a) => ({ fontStyle: a ? 'italic' : 'normal' })
        );
        this.apply(
            target,
            placeholder ? 'placeholder_color' : 'font_color',
            (a) => ({ color: `#${a}` })
        );
    }

    applyRichFontStyles() {
        this.element.richFontStyles = {};
        const delta = new Delta(this.element.text_formatted);
        delta
            .filter((op) => op.insert)
            .forEach((op, i) => {
                const attrs = op.attributes;
                if (!attrs) return;

                const desktop = this._applyRichFontScreenStyles(attrs);
                if (attrs.start && attrs.end) desktop.cursor = 'pointer';
                const mobile = this._applyRichFontScreenStyles(
                    attrs,
                    'mobile_'
                );

                this.element.richFontStyles[i] = {
                    ...desktop,
                    '@media (max-width: 478px)': mobile
                };
            });
    }

    _applyRichFontScreenStyles(attrs, p = '') {
        const styles = {};

        if (attrs[`${p}size`]) styles.fontSize = `${attrs[`${p}size`]}px`;
        if (attrs[`${p}family`])
            styles.fontFamily = attrs[`${p}family`].replace(/"/g, "'");
        if (attrs[`${p}color`]) styles.color = `#${attrs[`${p}color`]}`;
        if (attrs[`${p}weight`]) styles.fontWeight = attrs[`${p}weight`];
        if (attrs[`${p}italic`]) styles.fontStyle = 'italic';

        const lines = [];
        if (attrs[`${p}strike`]) lines.push('line-through');
        if (attrs[`${p}underline`]) lines.push('underline');
        if (lines.length > 0) styles.textDecoration = lines.join(' ');

        return styles;
    }
}

function getImageStyles(element) {
    const as = new ApplyStyles(element, ['container', 'image']);
    as.apply('container', 'layout', (a) => ({
        justifyContent: a
    }));
    as.apply('container', 'vertical_layout', (a) => ({
        alignItems: a
    }));

    as.applyMargin('image');
    as.applyWidth('image');

    if (element.styles.line_height) {
        as.apply('text', 'line_height', (a) => ({
            lineHeight: `${a}px`
        }));
    }

    element.applyStyles = as;
}

function getProgressBarStyles(element) {
    const as = new ApplyStyles(element, ['container', 'barContainer', 'bar']);
    as.apply('container', 'vertical_layout', (a) => ({
        justifyContent: a
    }));
    as.apply('container', 'layout', (a) => ({
        alignItems: a
    }));
    as.applyFontStyles('container');

    as.apply('barContainer', 'vertical_layout', (a) => ({
        justifyContent: a
    }));
    as.apply('barContainer', 'layout', (a) => ({
        alignItems: a
    }));
    as.apply('barContainer', 'width', (a) => ({
        width: `${a}%`
    }));
    as.applyMargin('barContainer');

    as.apply('bar', 'bar_color', (a) => ({
        backgroundColor: `#${a}`
    }));

    element.applyStyles = as;
}

function getTextStyles(element) {
    const as = new ApplyStyles(element, ['container', 'text']);
    as.apply('container', 'layout', (a) => ({
        alignItems: alignmentMap[a],
        textAlign: a
    }));
    as.apply('container', 'vertical_layout', (a) => ({
        justifyContent: a
    }));
    if (element.styles.border_color) {
        as.apply('container', 'border_color', (a) => ({
            border: `1px solid #${a}`
        }));
    }
    as.applyMargin('text');
    if (element.styles.line_height) {
        as.apply('text', 'line_height', (a) => ({
            lineHeight: `${a}px`
        }));
    }
    as.applyRichFontStyles();

    element.applyStyles = as;
}

function getButtonStyles(element) {
    const as = new ApplyStyles(element, [
        'container',
        'button',
        'buttonActive',
        'buttonHover',
        'spinner'
    ]);

    as.apply('container', 'layout', (a) => ({
        alignItems: alignmentMap[a],
        textAlign: a
    }));
    as.apply('container', 'vertical_layout', (a) => ({
        justifyContent: a
    }));

    as.apply('button', 'background_color', (a) => ({
        backgroundColor: `#${a}`
    }));
    as.applyHeight('button');
    as.applyWidth('button');
    as.applyCorners('button');
    as.applyBorders('button');
    as.applyMargin('button');

    as.applyBorders('buttonHover', 'hover_');
    if (element.link !== 'none') {
        as.apply('buttonHover', 'background_color', (a) => {
            const color = `${adjustColor(a, -30)} !important`;
            return {
                backgroundColor: color,
                borderColor: color,
                transition: 'background 0.3s !important'
            };
        });
    }
    if (element.styles.hover_background_color) {
        as.apply('buttonHover', 'hover_background_color', (a) => ({
            backgroundColor: `#${a} !important`
        }));
    }

    as.applyBorders('buttonActive', 'selected_');
    if (element.styles.selected_background_color) {
        as.apply('buttonHover', 'selected_background_color', (a) => ({
            backgroundColor: `#${a} !important`
        }));
    }

    as.apply('spinner', 'show_spinner_on_submit', (a) => ({
        display: a ? 'default' : 'none'
    }));
    as.apply('spinner', ['height', 'height_unit'], (a, b) => {
        const thirdHeight = Math.round(a / 3);
        return {
            right: `-${a}${b}`,
            width: `${thirdHeight}${b}`,
            height: `${thirdHeight}${b}`
        };
    });
    as.applyRichFontStyles();

    element.applyStyles = as;
}

function getFieldStyles(field) {
    const targets = ['container', 'fc', 'field', 'error', 'active', 'hover'];
    const styles = new ApplyStyles(field, targets);

    styles.applyFontStyles('container');
    styles.apply('container', 'layout', (a) => ({
        alignItems: a
    }));
    styles.apply('container', 'vertical_layout', (a) => ({
        justifyContent: a
    }));
    styles.applyMargin('fc');
    styles.applySelectorStyles('active', 'selected_');
    styles.applySelectorStyles('hover', 'hover_');
    styles.apply('error', 'font_family', (a) => ({
        fontFamily: `#${a}`
    }));
    styles.apply('error', 'font_size', (a) => ({
        fontSize: `${a}px`
    }));

    const type = field.servar.type;
    switch (type) {
        case 'signature':
            styles.apply('fc', 'width', (a) => ({
                width: `${a}px`
            }));
            styles.apply('field', 'background_color', (a) => ({
                backgroundColor: `#${a}`
            }));
            styles.applyCorners('field');
            styles.applyBorders('field');
            styles.applyBoxShadow('field');
            break;
        case 'rich_file_upload':
            styles.applyHeight('fc');
            styles.applyWidth('fc');
            styles.apply(
                'field',
                [
                    'cta_padding_top',
                    'cta_padding_right',
                    'cta_padding_bottom',
                    'cta_padding_left'
                ],
                (a, b, c, d) => ({
                    padding: `${a}px ${b}px ${c}px ${d}px`
                })
            );
            styles.apply('field', 'background_color', (a) => ({
                backgroundColor: `#${a}`
            }));
            break;
        case 'rich_multi_file_upload':
            styles.addTargets('ac', 'add');
            styles.applyHeight('field');
            styles.applyWidth('field');
            styles.applyHeight('ac');
            styles.applyWidth('ac');
            styles.apply(
                'ac',
                [
                    'uploader_padding_top',
                    'uploader_padding_right',
                    'uploader_padding_bottom',
                    'uploader_padding_left'
                ],
                (a, b, c, d) => ({
                    padding: `${a}px ${b}px ${c}px ${d}px`
                })
            );
            styles.apply(
                'add',
                [
                    'cta_padding_top',
                    'cta_padding_right',
                    'cta_padding_bottom',
                    'cta_padding_left'
                ],
                (a, b, c, d) => ({
                    padding: `${a}px ${b}px ${c}px ${d}px`
                })
            );
            styles.apply('add', 'background_color', (a) => ({
                backgroundColor: `#${a}`
            }));
            break;
        case 'button_group':
            styles.apply('fc', 'layout', (a) => ({
                alignItems: `#${a}`
            }));
            styles.apply('fc', 'vertical_layout', (a) => ({
                justifyContent: a
            }));
            styles.applyHeight('field');
            styles.applyWidth('field');
            styles.apply('field', 'background_color', (a) => ({
                backgroundColor: `#${a}`
            }));
            styles.applyBoxShadow('field');
            styles.applyCorners('field');
            styles.applyBorders('field');
            styles.applyMargin('field');
            break;
        case 'checkbox':
            styles.applyMargin('fc');
            break;
        case 'dropdown':
        case 'gmap_state':
            styles.applyMargin('fc');
            styles.applyWidth('fc');
            styles.applyBorders('field');
            styles.applyCorners('field');
            styles.applyHeight('field');
            styles.applyBoxShadow('field');
            styles.apply('field', 'background_color', (a) => ({
                backgroundColor: `#${a}`
            }));
            break;
        case 'pin_input':
            styles.applyMargin('fc');
            styles.applyWidth('field');
            styles.applyHeight('field');
            styles.applyBoxShadow('field');
            styles.applyCorners('field');
            styles.apply('field', 'background_color', (a) => ({
                backgroundColor: `#${a}`
            }));
            styles.apply('field', 'font_size', (a) => ({
                fontSize: `${a}px`
            }));
            styles.apply('field', 'font_color', (a) => ({
                color: `#${a}`
            }));
            break;
        case 'multiselect':
            styles.applyMargin('fc');
            styles.applyCorners('field');
            styles.applyBorders('field');
            styles.applyBoxShadow('field');
            styles.applyFontStyles('field');
            styles.apply('field', 'background_color', (a) => ({
                backgroundColor: `#${a}`
            }));
            styles.apply('field', 'font_size', (a) => ({
                height: `${parseInt(a) + 4}px`
            }));
            break;
        case 'select':
            styles.applyMargin('fc');
            styles.applyCorners('field');
            styles.applyBorders('field');
            styles.applyBoxShadow('field');
            styles.applyFontStyles('field');
            styles.apply('field', 'background_color', (a) => ({
                backgroundColor: `#${a}`
            }));
            styles.apply('field', 'font_size', (a) => ({
                height: `${parseInt(a) + 4}px`
            }));
            break;
        case 'hex_color':
            styles.applyMargin('fc');
            styles.applyCorners('field');
            styles.applyBorders('field');
            break;
        default:
            styles.addTargets(
                'sub-fc',
                'placeholder',
                'placeholderActive',
                'placeholderFocus',
                'tooltip'
            );
            styles.applyMargin('fc');
            styles.applyWidth('fc');
            styles.applyHeight('sub-fc');
            styles.applyBoxShadow('field');
            styles.applyCorners('field');
            styles.applyBorders('field');
            styles.applyFontStyles('field');
            styles.apply('field', 'background_color', (a) => ({
                backgroundColor: `#${a}`
            }));
            styles.applyFontStyles('placeholder', true);
            styles.apply('placeholder', 'font_size', (a) => ({
                lineHeight: `${a}px`
            }));
            if (type !== 'text_area') {
                styles.apply('placeholder', 'font_size', (a) => ({
                    marginTop: `-${a / 2}px`
                }));
            }
            if (field.styles.placeholder_transition === 'shrink_top') {
                styles.apply('placeholderFocus', 'font_size', (a) => {
                    const minFontSize = Math.min(a, 10);
                    return {
                        top: 0,
                        marginTop: `${minFontSize / 2}px`,
                        fontSize: `${minFontSize}px`
                    };
                });
                if (styles.selected_placeholder_color) {
                    styles.apply(
                        'placeholderActive',
                        'selected_placeholder_color',
                        (a) => ({
                            color: `#${a}`
                        })
                    );
                }
                styles.apply('field', ['height', 'height_unit'], (a, b) => ({
                    paddingTop: `${a / 3}${b}`
                }));
            } else {
                styles.setStyle('placeholderFocus', 'display', 'none');
            }

            styles.apply('tooltip', 'font_size', (a) => ({
                width: `${a}px`
            }));
            break;
    }

    field.applyStyles = styles;
}

function applyStepStyles(step) {
    step.images.forEach((e) => getImageStyles(e));
    step.texts.forEach((e) => getTextStyles(e));
    step.buttons.forEach((e) => getButtonStyles(e));
    step.servar_fields.forEach((e) => getFieldStyles(e));
    const pb = step.progress_bar;
    if (pb) getProgressBarStyles(pb);
    return step;
}

export {
    ApplyStyles,
    bootstrapStyles,
    applyStepStyles,
    getImageStyles,
    getTextStyles,
    getButtonStyles,
    getFieldStyles,
    getProgressBarStyles
};
