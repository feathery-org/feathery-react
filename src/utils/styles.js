const bootstrapStyles = {
    padding: '0.375rem 0.75rem',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out',
    outline: 'none'
};

function borderStyleFromField(field, p = '', important = true) {
    // If color isn't defined on one of the sides, that means there's no border
    if (!field.styles[`${p}border_top_color`]) {
        return {};
    }

    const i = p && important ? '!important' : '';

    const borderColor = `#${field.styles[`${p}border_top_color`]} #${
        field.styles[`${p}border_right_color`]
    } #${field.styles[`${p}border_bottom_color`]} #${
        field.styles[`${p}border_left_color`]
    } ${i}`;
    const borderWidth = `${field.styles[`${p}border_top_width`]}px ${
        field.styles[`${p}border_right_width`]
    }px ${field.styles[`${p}border_bottom_width`]}px ${
        field.styles[`${p}border_left_width`]
    }px ${i}`;
    const borderStyle = `${field.styles[`${p}border_top_pattern`]} ${
        field.styles[`${p}border_right_pattern`]
    } ${field.styles[`${p}border_bottom_pattern`]} ${
        field.styles[`${p}border_left_pattern`]
    } ${i}`;
    return { borderColor, borderWidth, borderStyle };
}

function marginStyleFromField(field) {
    return {
        marginBottom: `${field.styles.padding_bottom}px`,
        marginTop: `${field.styles.padding_top}px`,
        marginLeft: `${field.styles.padding_left}px`,
        marginRight: `${field.styles.padding_right}px`
    };
}

function fontStyles(styles, placeholder = false) {
    return {
        fontStyle: (
            placeholder ? styles.placeholder_italic : styles.font_italic
        )
            ? 'italic'
            : 'normal',
        fontWeight: styles.font_weight,
        fontFamily: styles.font_family,
        fontSize: `${styles.font_size}px`,
        color: `#${placeholder ? styles.placeholder_color : styles.font_color}`
    };
}

export {
    borderStyleFromField,
    marginStyleFromField,
    fontStyles,
    bootstrapStyles
};
