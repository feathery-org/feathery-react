function borderStyleFromField(field, p = '') {
    // If color isn't defined on one of the sides, that means there's no border
    if (!field[`${p}border_top_color`]) {
        return {};
    }

    const i = p ? '!important' : '';

    const borderColor = `#${field[`${p}border_top_color`]} #${
        field[`${p}border_right_color`]
    } #${field[`${p}border_bottom_color`]} #${
        field[`${p}border_left_color`]
    } ${i}`;
    const borderWidth = `${field[`${p}border_top_width`]}px ${
        field[`${p}border_right_width`]
    }px ${field[`${p}border_bottom_width`]}px ${
        field[`${p}border_left_width`]
    }px ${i}`;
    const borderStyle = `${field[`${p}border_top_pattern`]} ${
        field[`${p}border_right_pattern`]
    } ${field[`${p}border_bottom_pattern`]} ${
        field[`${p}border_left_pattern`]
    } ${i}`;
    return { borderColor, borderWidth, borderStyle };
}

function marginStyleFromField(field) {
    return {
        marginBottom: `${field.padding_bottom}px`,
        marginTop: `${field.padding_top}px`,
        marginLeft: `${field.padding_left}px`,
        marginRight: `${field.padding_right}px`
    };
}

export { borderStyleFromField, marginStyleFromField };
